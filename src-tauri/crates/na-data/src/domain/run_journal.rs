use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use na_flow::{
    FlowLifecycleEvent, FlowLifecycleEventKind, FlowRunObserver, FlowRunReport, FlowRunStatus,
};
use serde::{Deserialize, Serialize};

use crate::{DataError, Result};

mod storage;
mod validation;

use storage::{
    read_run_dir, repair_torn_tail, segment_name, segment_number, segment_paths, sync_directory,
    sync_directory_chain,
};
use validation::{is_terminal, summary_from_records, validate_lifecycle};

const SCHEMA_VERSION: u16 = 1;
const SEGMENT_PREFIX: &str = "segment-";
const SEGMENT_SUFFIX: &str = ".jsonl";

#[derive(Debug, Clone, Copy)]
pub struct RunJournalConfig {
    pub max_segment_bytes: u64,
    pub max_record_bytes: usize,
    pub max_completed_runs: usize,
}

impl Default for RunJournalConfig {
    fn default() -> Self {
        Self {
            max_segment_bytes: 4 * 1024 * 1024,
            max_record_bytes: 1024 * 1024,
            max_completed_runs: 1000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunJournalEventKind {
    RunStarted,
    JobStarted,
    JobFinished,
    NodeStarted,
    NodeFinished,
    RunCompleted,
    RunAbandoned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunJournalRecord {
    pub schema_version: u16,
    pub seq: u64,
    pub run_id: String,
    pub flow_id: String,
    pub occurred_at: String,
    pub kind: RunJournalEventKind,
    pub status: FlowRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunJournalSummary {
    pub run_id: String,
    pub flow_id: String,
    pub status: FlowRunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JournalFrame {
    checksum_crc32: u32,
    event: RunJournalRecord,
}

#[derive(Clone)]
pub struct RunJournal {
    root: PathBuf,
    config: RunJournalConfig,
}

impl RunJournal {
    pub fn new(base_dir: &Path) -> Self {
        Self::with_config(base_dir, RunJournalConfig::default())
    }

    pub fn with_config(base_dir: &Path, config: RunJournalConfig) -> Self {
        Self {
            root: base_dir.join("runtime").join("flow-runs").join("v1"),
            config,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn start_run(
        &self,
        run_id: &str,
        flow_id: &str,
        occurred_at: &str,
    ) -> Result<RunJournalRecord> {
        let run_dir = self.run_dir(run_id)?;
        if run_dir.exists() {
            repair_torn_tail(&run_dir)?;
        }
        if !self.read_run(run_id)?.is_empty() {
            return Err(DataError::RunJournal(format!(
                "run 已存在，不能重复开始: {run_id}"
            )));
        }
        self.append(RunJournalRecord {
            schema_version: SCHEMA_VERSION,
            seq: 1,
            run_id: run_id.to_string(),
            flow_id: flow_id.to_string(),
            occurred_at: occurred_at.to_string(),
            kind: RunJournalEventKind::RunStarted,
            status: FlowRunStatus::Running,
            job_id: None,
            node_id: None,
        })
    }

    /// 追加执行器产生的安全生命周期事件。run 级终态仍由 `complete_run` 负责。
    pub fn record_lifecycle(&self, event: &FlowLifecycleEvent) -> Result<RunJournalRecord> {
        let kind = match event.kind {
            FlowLifecycleEventKind::JobStarted => RunJournalEventKind::JobStarted,
            FlowLifecycleEventKind::JobFinished => RunJournalEventKind::JobFinished,
            FlowLifecycleEventKind::NodeStarted => RunJournalEventKind::NodeStarted,
            FlowLifecycleEventKind::NodeFinished => RunJournalEventKind::NodeFinished,
            FlowLifecycleEventKind::RunStarted | FlowLifecycleEventKind::RunFinished => {
                return Err(DataError::RunJournal(
                    "run 级生命周期必须通过 start_run/complete_run 写入".to_string(),
                ));
            }
        };
        let run_dir = self.run_dir(&event.run_id)?;
        if run_dir.exists() {
            repair_torn_tail(&run_dir)?;
        }
        let records = self.read_run(&event.run_id)?;
        let first = records.first().ok_or_else(|| {
            DataError::RunJournal(format!("run 缺少 started 记录: {}", event.run_id))
        })?;
        if first.flow_id != event.flow_id || records.iter().any(|record| is_terminal(record.kind)) {
            return Err(DataError::RunJournal(format!(
                "生命周期事件与 run 状态不一致: {}",
                event.run_id
            )));
        }
        let record = RunJournalRecord {
            schema_version: SCHEMA_VERSION,
            seq: records.last().map(|record| record.seq + 1).unwrap_or(1),
            run_id: event.run_id.clone(),
            flow_id: event.flow_id.clone(),
            occurred_at: event.occurred_at.clone(),
            kind,
            status: event.status,
            job_id: event.job_id.clone(),
            node_id: event.node_id.clone(),
        };
        let mut candidate = records;
        candidate.push(record.clone());
        validate_lifecycle(&candidate)?;
        self.append(record)
    }

    pub fn complete_run(&self, report: &FlowRunReport) -> Result<RunJournalRecord> {
        let run_dir = self.run_dir(&report.run_id)?;
        if run_dir.exists() {
            repair_torn_tail(&run_dir)?;
        }
        let records = self.read_run(&report.run_id)?;
        if records.first().map(|record| record.kind) != Some(RunJournalEventKind::RunStarted) {
            return Err(DataError::RunJournal(format!(
                "run 缺少 started 记录: {}",
                report.run_id
            )));
        }
        if records.iter().any(|record| is_terminal(record.kind)) {
            return Err(DataError::RunJournal(format!(
                "run 已有 completed 记录: {}",
                report.run_id
            )));
        }
        if records[0].flow_id != report.flow_id {
            return Err(DataError::RunJournal(format!(
                "completed report 的 flow_id 与 started 不一致: {}",
                report.run_id
            )));
        }
        let record = RunJournalRecord {
            schema_version: SCHEMA_VERSION,
            seq: records.last().map(|record| record.seq + 1).unwrap_or(1),
            run_id: report.run_id.clone(),
            flow_id: report.flow_id.clone(),
            occurred_at: report.finished_at.clone(),
            kind: RunJournalEventKind::RunCompleted,
            status: report.status,
            job_id: None,
            node_id: None,
        };
        let mut candidate = records;
        candidate.push(record.clone());
        validate_lifecycle(&candidate)?;
        let record = self.append(record)?;
        self.enforce_retention()?;
        Ok(record)
    }

    pub fn list_runs(&self, limit: usize) -> Result<Vec<RunJournalSummary>> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut summaries = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let path = entry?.path();
            if !path.is_dir() {
                return Err(DataError::RunJournal(format!(
                    "运行日志根目录包含非法文件: {}",
                    path.display()
                )));
            }
            let records = read_run_dir(&path)?;
            if records.is_empty() {
                return Err(DataError::RunJournal(format!(
                    "运行日志目录为空: {}",
                    path.display()
                )));
            }
            summaries.push(summary_from_records(&records)?);
        }
        summaries.sort_by(|left, right| {
            right
                .started_at
                .cmp(&left.started_at)
                .then_with(|| right.run_id.cmp(&left.run_id))
        });
        summaries.truncate(limit);
        Ok(summaries)
    }

    pub fn reconcile_incomplete(&self, occurred_at: &str) -> Result<usize> {
        if self.root.exists() {
            for entry in fs::read_dir(&self.root)? {
                let path = entry?.path();
                if path.is_dir() {
                    repair_torn_tail(&path)?;
                }
            }
        }
        let running = self
            .list_runs(usize::MAX)?
            .into_iter()
            .filter(|summary| summary.status == FlowRunStatus::Running)
            .collect::<Vec<_>>();
        for summary in &running {
            let records = self.read_run(&summary.run_id)?;
            self.append(RunJournalRecord {
                schema_version: SCHEMA_VERSION,
                seq: records.last().map(|record| record.seq + 1).unwrap_or(1),
                run_id: summary.run_id.clone(),
                flow_id: summary.flow_id.clone(),
                occurred_at: occurred_at.to_string(),
                kind: RunJournalEventKind::RunAbandoned,
                status: FlowRunStatus::Failed,
                job_id: None,
                node_id: None,
            })?;
        }
        self.enforce_retention()?;
        Ok(running.len())
    }

    pub fn read_run(&self, run_id: &str) -> Result<Vec<RunJournalRecord>> {
        let run_dir = self.run_dir(run_id)?;
        if !run_dir.exists() {
            return Ok(Vec::new());
        }
        let records = read_run_dir(&run_dir)?;
        if records.iter().any(|record| record.run_id != run_id) {
            return Err(DataError::RunJournal(format!(
                "运行日志目录与 run_id 不一致: {run_id}"
            )));
        }
        Ok(records)
    }

    fn append(&self, record: RunJournalRecord) -> Result<RunJournalRecord> {
        self.validate_config()?;
        let event_bytes = serde_json::to_vec(&record)?;
        let frame = JournalFrame {
            checksum_crc32: crc32fast::hash(&event_bytes),
            event: record.clone(),
        };
        let mut line = serde_json::to_vec(&frame)?;
        line.push(b'\n');
        if line.len() > self.config.max_record_bytes
            || line.len() as u64 > self.config.max_segment_bytes
        {
            return Err(DataError::RunJournal(format!(
                "单条运行日志超过限制: {} bytes",
                line.len()
            )));
        }

        let run_dir = self.run_dir(&record.run_id)?;
        let run_dir_existed = run_dir.exists();
        fs::create_dir_all(&run_dir)?;
        if !run_dir_existed {
            sync_directory_chain(&run_dir, 5)?;
        }
        repair_torn_tail(&run_dir)?;

        let segments = segment_paths(&run_dir)?;
        let segment_path = match segments.last() {
            Some(path)
                if path.metadata()?.len() + line.len() as u64 <= self.config.max_segment_bytes =>
            {
                path.clone()
            }
            Some(path) => run_dir.join(segment_name(segment_number(path)? + 1)),
            None => run_dir.join(segment_name(1)),
        };
        let mut options = OpenOptions::new();
        options.write(true).append(true);
        let segment_existed = segment_path.exists();
        let mut file = if segment_existed {
            options.open(&segment_path)?
        } else {
            options.create_new(true).open(&segment_path)?
        };
        file.write_all(&line)?;
        file.sync_data()?;
        if !segment_existed {
            sync_directory(&run_dir)?;
        }

        Ok(record)
    }

    fn run_dir(&self, run_id: &str) -> Result<PathBuf> {
        let bytes = run_id.as_bytes();
        if bytes.is_empty() || bytes.len() > 96 {
            return Err(DataError::RunJournal(
                "run_id 长度必须在 1..=96 bytes".to_string(),
            ));
        }
        let mut encoded = String::with_capacity(bytes.len() * 2 + 4);
        encoded.push_str("run-");
        for byte in bytes {
            use std::fmt::Write as _;
            write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
        }
        Ok(self.root.join(encoded))
    }

    fn validate_config(&self) -> Result<()> {
        if self.config.max_record_bytes == 0 || self.config.max_segment_bytes == 0 {
            return Err(DataError::RunJournal(
                "运行日志大小限制必须大于 0".to_string(),
            ));
        }
        Ok(())
    }

    fn enforce_retention(&self) -> Result<()> {
        let summaries = self.list_runs(usize::MAX)?;
        let mut completed = summaries
            .into_iter()
            .filter(|summary| summary.finished_at.is_some())
            .collect::<Vec<_>>();
        completed.sort_by(|left, right| {
            left.finished_at
                .cmp(&right.finished_at)
                .then_with(|| left.run_id.cmp(&right.run_id))
        });
        let remove_count = completed
            .len()
            .saturating_sub(self.config.max_completed_runs);
        for summary in completed.into_iter().take(remove_count) {
            fs::remove_dir_all(self.run_dir(&summary.run_id)?)?;
        }
        if remove_count > 0 {
            sync_directory(&self.root)?;
        }
        Ok(())
    }
}

/// 将执行器生命周期事件追加到 `RunJournal`，同时把写入失败留给调用方检查。
pub struct RunJournalObserver<'a> {
    journal: &'a RunJournal,
    first_error: Option<String>,
}

impl<'a> RunJournalObserver<'a> {
    pub fn new(journal: &'a RunJournal) -> Self {
        Self {
            journal,
            first_error: None,
        }
    }

    pub fn first_error(&self) -> Option<&str> {
        self.first_error.as_deref()
    }

    pub fn take_error(&mut self) -> Option<String> {
        self.first_error.take()
    }
}

impl FlowRunObserver for RunJournalObserver<'_> {
    fn observe(&mut self, event: &FlowLifecycleEvent) {
        if self.first_error.is_some()
            || matches!(
                event.kind,
                FlowLifecycleEventKind::RunStarted | FlowLifecycleEventKind::RunFinished
            )
        {
            return;
        }
        if let Err(error) = self.journal.record_lifecycle(event) {
            self.first_error = Some(error.to_string());
        }
    }
}
