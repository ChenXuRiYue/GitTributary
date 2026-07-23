use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{FlowNodeSpec, FlowRunIntent, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowRunRequest {
    #[serde(default)]
    pub intent: Option<FlowRunIntent>,
    #[serde(default)]
    pub inputs: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowExecutionContext {
    #[serde(default)]
    pub event: Value,
    #[serde(default)]
    pub inputs: Value,
    #[serde(default)]
    pub workspace: Value,
    pub now: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowActionOutcome {
    #[serde(default)]
    pub outputs: Value,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default)]
    pub message: Option<String>,
}

pub trait FlowActionExecutor {
    fn execute(
        &mut self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> Result<FlowActionOutcome>;
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FlowRunStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FlowLifecycleEventKind {
    RunStarted,
    RunFinished,
    JobStarted,
    JobFinished,
    NodeStarted,
    NodeFinished,
}

/// 可持久化的 Flow 生命周期元数据。这里刻意不包含业务输入、事件、输出或错误文本。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowLifecycleEvent {
    pub kind: FlowLifecycleEventKind,
    pub run_id: String,
    pub flow_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub status: FlowRunStatus,
    pub occurred_at: String,
}

pub trait FlowRunObserver {
    /// 观察行为不能改变 Flow 的业务执行结果；需要上报写入错误的实现应自行记录错误。
    fn observe(&mut self, event: &FlowLifecycleEvent);
}

#[derive(Default)]
pub(super) struct NoopFlowRunObserver;

impl FlowRunObserver for NoopFlowRunObserver {
    fn observe(&mut self, _event: &FlowLifecycleEvent) {}
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowNodeRun {
    pub run_id: String,
    pub flow_id: String,
    pub job_id: String,
    pub node_id: String,
    pub uses: String,
    pub status: FlowRunStatus,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
    #[serde(default)]
    pub outputs: Value,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowJobRun {
    pub run_id: String,
    pub flow_id: String,
    pub job_id: String,
    pub status: FlowRunStatus,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub nodes: Vec<FlowNodeRun>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowRunReport {
    pub run_id: String,
    pub flow_id: String,
    pub flow_name: String,
    pub status: FlowRunStatus,
    pub trigger: String,
    pub reason: String,
    pub started_at: String,
    pub finished_at: String,
    pub jobs: Vec<FlowJobRun>,
    pub event: Value,
    pub inputs: Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct DryRunActionExecutor;

impl FlowActionExecutor for DryRunActionExecutor {
    fn execute(
        &mut self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        _context: &FlowExecutionContext,
    ) -> Result<FlowActionOutcome> {
        let outputs = match node.uses.as_str() {
            "noteaura/files/assert-exists@v1" => json!({
                "path": inputs.get("path").cloned().unwrap_or_default(),
            }),
            "noteaura/files/sync-dir@v1" => json!({
                "changed_count": 0,
            }),
            "noteaura/git/commit-all@v1" => json!({
                "commit": "dry-run",
                "branch": "dry-run",
            }),
            "noteaura/git/push@v1" => json!({
                "remote": inputs.get("remote").cloned().unwrap_or_else(|| "origin".to_string()),
                "branch": inputs.get("branch").cloned().unwrap_or_else(|| "main".to_string()),
            }),
            _ => Value::Object(Map::new()),
        };

        Ok(FlowActionOutcome {
            outputs,
            skipped: false,
            message: Some("dry_run".to_string()),
        })
    }
}
