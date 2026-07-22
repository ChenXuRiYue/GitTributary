use gt_flow::FlowRunStatus;

use super::{RunJournalEventKind, RunJournalRecord, RunJournalSummary, SCHEMA_VERSION};
use crate::{DataError, Result};

pub(super) fn validate_lifecycle(records: &[RunJournalRecord]) -> Result<()> {
    let Some(first) = records.first() else {
        return Ok(());
    };
    if first.kind != RunJournalEventKind::RunStarted || first.status != FlowRunStatus::Running {
        return Err(DataError::RunJournal(
            "运行日志必须以 running 状态的 run_started 开始".to_string(),
        ));
    }
    let mut terminal_seen = false;
    let mut active_job: Option<&str> = None;
    let mut active_node: Option<&str> = None;
    for (index, record) in records.iter().enumerate() {
        if record.schema_version != SCHEMA_VERSION
            || record.seq != index as u64 + 1
            || record.run_id != first.run_id
            || record.flow_id != first.flow_id
            || (index > 0 && record.kind == RunJournalEventKind::RunStarted)
            || terminal_seen
        {
            return Err(DataError::RunJournal(format!(
                "运行日志生命周期无效: {}",
                first.run_id
            )));
        }
        validate_record_shape(record)?;
        match record.kind {
            RunJournalEventKind::RunStarted => {}
            RunJournalEventKind::JobStarted if active_job.is_none() => {
                active_job = record.job_id.as_deref();
            }
            RunJournalEventKind::NodeStarted
                if active_job == record.job_id.as_deref() && active_node.is_none() =>
            {
                active_node = record.node_id.as_deref();
            }
            RunJournalEventKind::NodeFinished
                if active_job == record.job_id.as_deref()
                    && active_node == record.node_id.as_deref() =>
            {
                active_node = None;
            }
            RunJournalEventKind::JobFinished
                if active_job == record.job_id.as_deref() && active_node.is_none() =>
            {
                active_job = None;
            }
            RunJournalEventKind::RunCompleted if active_job.is_none() && active_node.is_none() => {}
            RunJournalEventKind::RunAbandoned => {}
            _ => {
                return Err(DataError::RunJournal(format!(
                    "运行日志 job/node 生命周期无效: {} seq {}",
                    first.run_id, record.seq
                )));
            }
        }
        if is_terminal(record.kind) {
            let valid_status = match record.kind {
                RunJournalEventKind::RunCompleted => matches!(
                    record.status,
                    FlowRunStatus::Succeeded | FlowRunStatus::Failed | FlowRunStatus::Skipped
                ),
                RunJournalEventKind::RunAbandoned => record.status == FlowRunStatus::Failed,
                RunJournalEventKind::RunStarted
                | RunJournalEventKind::JobStarted
                | RunJournalEventKind::JobFinished
                | RunJournalEventKind::NodeStarted
                | RunJournalEventKind::NodeFinished => false,
            };
            if !valid_status {
                return Err(DataError::RunJournal(format!(
                    "运行日志终态 status 无效: {}",
                    first.run_id
                )));
            }
            terminal_seen = true;
        }
    }
    Ok(())
}

fn validate_record_shape(record: &RunJournalRecord) -> Result<()> {
    let valid = match record.kind {
        RunJournalEventKind::RunStarted => {
            record.status == FlowRunStatus::Running
                && record.job_id.is_none()
                && record.node_id.is_none()
        }
        RunJournalEventKind::JobStarted => {
            record.status == FlowRunStatus::Running
                && record.job_id.is_some()
                && record.node_id.is_none()
        }
        RunJournalEventKind::JobFinished => {
            is_finished_status(record.status) && record.job_id.is_some() && record.node_id.is_none()
        }
        RunJournalEventKind::NodeStarted => {
            record.status == FlowRunStatus::Running
                && record.job_id.is_some()
                && record.node_id.is_some()
        }
        RunJournalEventKind::NodeFinished => {
            is_finished_status(record.status) && record.job_id.is_some() && record.node_id.is_some()
        }
        RunJournalEventKind::RunCompleted => {
            is_finished_status(record.status) && record.job_id.is_none() && record.node_id.is_none()
        }
        RunJournalEventKind::RunAbandoned => {
            record.status == FlowRunStatus::Failed
                && record.job_id.is_none()
                && record.node_id.is_none()
        }
    };
    if valid {
        Ok(())
    } else {
        Err(DataError::RunJournal(format!(
            "运行日志事件字段无效: {} seq {}",
            record.run_id, record.seq
        )))
    }
}

fn is_finished_status(status: FlowRunStatus) -> bool {
    matches!(
        status,
        FlowRunStatus::Succeeded | FlowRunStatus::Failed | FlowRunStatus::Skipped
    )
}

pub(super) fn summary_from_records(records: &[RunJournalRecord]) -> Result<RunJournalSummary> {
    validate_lifecycle(records)?;
    let first = records
        .first()
        .ok_or_else(|| DataError::RunJournal("运行日志为空".to_string()))?;
    let terminal = records.iter().find(|record| is_terminal(record.kind));
    Ok(RunJournalSummary {
        run_id: first.run_id.clone(),
        flow_id: first.flow_id.clone(),
        status: terminal.map(|record| record.status).unwrap_or(first.status),
        started_at: first.occurred_at.clone(),
        finished_at: terminal.map(|record| record.occurred_at.clone()),
    })
}

pub(super) fn is_terminal(kind: RunJournalEventKind) -> bool {
    matches!(
        kind,
        RunJournalEventKind::RunCompleted | RunJournalEventKind::RunAbandoned
    )
}
