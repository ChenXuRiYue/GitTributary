use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use na_flow::{FlowRunReport, FlowRunStatus};
use serde::{Deserialize, Serialize};

use crate::{DataError, Result};

const SCHEMA_VERSION: u16 = 1;
const RESULT_FILE: &str = "result.json";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy)]
pub struct RunResultStoreConfig {
    pub max_result_bytes: usize,
    pub max_completed_results: usize,
}

impl Default for RunResultStoreConfig {
    fn default() -> Self {
        Self {
            max_result_bytes: 1024 * 1024,
            max_completed_results: 1000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SafeFlowRunResult {
    pub schema_version: u16,
    pub run_id: String,
    pub flow_id: String,
    pub status: FlowRunStatus,
    pub started_at: String,
    pub finished_at: String,
    pub jobs: Vec<SafeFlowJobResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SafeFlowJobResult {
    pub job_id: String,
    pub status: FlowRunStatus,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub nodes: Vec<SafeFlowNodeResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SafeFlowNodeResult {
    pub node_id: String,
    pub status: FlowRunStatus,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

impl SafeFlowRunResult {
    pub fn from_report(report: &FlowRunReport) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            run_id: report.run_id.clone(),
            flow_id: report.flow_id.clone(),
            status: report.status,
            started_at: report.started_at.clone(),
            finished_at: report.finished_at.clone(),
            jobs: report
                .jobs
                .iter()
                .map(|job| SafeFlowJobResult {
                    job_id: job.job_id.clone(),
                    status: job.status,
                    started_at: job.started_at.clone(),
                    finished_at: job.finished_at.clone(),
                    nodes: job
                        .nodes
                        .iter()
                        .map(|node| SafeFlowNodeResult {
                            node_id: node.node_id.clone(),
                            status: node.status,
                            started_at: node.started_at.clone(),
                            finished_at: node.finished_at.clone(),
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

/// 不可变、可替代完整 `FlowRunReport` 的安全结果投影。
#[derive(Clone)]
pub struct RunResultStore {
    root: PathBuf,
    config: RunResultStoreConfig,
}

impl RunResultStore {
    pub fn new(base_dir: &Path) -> Self {
        Self::with_config(base_dir, RunResultStoreConfig::default())
    }

    pub fn with_config(base_dir: &Path, config: RunResultStoreConfig) -> Self {
        Self {
            root: base_dir.join("runtime").join("flow-results").join("v1"),
            config,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn write(&self, report: &FlowRunReport) -> Result<SafeFlowRunResult> {
        self.validate_config()?;
        if !is_terminal(report.status) || report.finished_at.is_empty() {
            return Err(DataError::RunResult(
                "只能持久化具有完成时间的 Flow 终态结果".to_string(),
            ));
        }
        let result = SafeFlowRunResult::from_report(report);
        let bytes = serde_json::to_vec(&result)?;
        if bytes.len() > self.config.max_result_bytes {
            return Err(DataError::RunResult(format!(
                "安全运行结果超过限制: {} bytes",
                bytes.len()
            )));
        }

        let run_dir = self.run_dir(&report.run_id)?;
        let destination = run_dir.join(RESULT_FILE);
        if destination.exists() {
            return Err(DataError::RunResult(format!(
                "运行结果已存在，不能覆盖: {}",
                report.run_id
            )));
        }
        let root_existed = self.root.exists();
        fs::create_dir_all(&run_dir)?;
        if !root_existed {
            sync_existing_parents(&self.root, 4)?;
        } else {
            sync_directory(&self.root)?;
        }

        let temp = self.root.join(format!(
            ".result-{}-{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let publish_result = (|| -> Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::hard_link(&temp, &destination).map_err(|error| {
                DataError::RunResult(format!("原子发布运行结果失败 {}: {error}", report.run_id))
            })?;
            sync_directory(&run_dir)?;
            Ok(())
        })();
        let _ = fs::remove_file(&temp);
        let _ = sync_directory(&self.root);
        publish_result?;
        // Publication is the durable operation. Retention is maintenance and must
        // not report a false write failure after the new result is already visible.
        if let Err(error) = self.enforce_retention() {
            eprintln!("flow_run_result_retention_failed: {error}");
        }
        Ok(result)
    }

    pub fn read(&self, run_id: &str) -> Result<Option<SafeFlowRunResult>> {
        let path = self.run_dir(run_id)?.join(RESULT_FILE);
        if !path.exists() {
            return Ok(None);
        }
        let metadata = path.metadata()?;
        if metadata.len() > self.config.max_result_bytes as u64 {
            return Err(DataError::RunResult(format!(
                "安全运行结果超过读取限制: {run_id}"
            )));
        }
        let result: SafeFlowRunResult = serde_json::from_slice(&fs::read(path)?)?;
        if result.schema_version != SCHEMA_VERSION || result.run_id != run_id {
            return Err(DataError::RunResult(format!(
                "安全运行结果身份或版本无效: {run_id}"
            )));
        }
        Ok(Some(result))
    }

    fn validate_config(&self) -> Result<()> {
        if self.config.max_result_bytes == 0 {
            return Err(DataError::RunResult(
                "运行结果大小限制必须大于 0".to_string(),
            ));
        }
        Ok(())
    }

    fn run_dir(&self, run_id: &str) -> Result<PathBuf> {
        let bytes = run_id.as_bytes();
        if bytes.is_empty() || bytes.len() > 96 {
            return Err(DataError::RunResult(
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

    fn enforce_retention(&self) -> Result<()> {
        let mut results = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let path = entry?.path();
            if !path.is_dir() {
                continue;
            }
            let result_path = path.join(RESULT_FILE);
            if !result_path.exists() {
                continue;
            }
            let decoded = fs::read(&result_path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<SafeFlowRunResult>(&bytes).ok());
            match decoded {
                Some(result) => results.push((result.finished_at, result.run_id, path)),
                None => {
                    // A corrupt old projection must not prevent new results from
                    // being published or retention from making progress.
                    let name = path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default()
                        .to_string();
                    results.push((String::new(), name, path));
                }
            }
        }
        results.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        let remove_count = results
            .len()
            .saturating_sub(self.config.max_completed_results);
        for (_, _, path) in results.into_iter().take(remove_count) {
            fs::remove_dir_all(path)?;
        }
        if remove_count > 0 {
            sync_directory(&self.root)?;
        }
        Ok(())
    }
}

fn is_terminal(status: FlowRunStatus) -> bool {
    matches!(
        status,
        FlowRunStatus::Succeeded | FlowRunStatus::Failed | FlowRunStatus::Skipped
    )
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> std::io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn sync_existing_parents(path: &Path, depth: usize) -> std::io::Result<()> {
    let mut current = Some(path);
    for _ in 0..depth {
        let Some(directory) = current else { break };
        if directory.exists() {
            sync_directory(directory)?;
        }
        current = directory.parent();
    }
    Ok(())
}
