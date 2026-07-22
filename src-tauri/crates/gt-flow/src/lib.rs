//! # gt-flow
//!
//! GitTributary Flow 的轻量领域层。
//! 负责解析、构造、校验和编排 workflow。具体业务动作由宿主应用注入执行器。

mod builder;
mod event;
mod model;
mod node;
mod parser;
mod runner;

pub use builder::{
    build_flow_draft, build_flow_draft_from_yaml, validate_flow_summary, FlowBuildDraft,
    FlowBuildRequest, FlowBuildStepRequest, FlowBuildTriggerRequest, FlowDiagnostic,
    FlowDiagnosticSeverity,
};
pub use event::{
    CloudEvent, EventDefinition, EventDraft, EventPool, EventReceipt, FlowRunIntent,
    FlowTriggerMatch,
};
pub use model::{
    default_folder_for_summary, normalize_folder, now_rfc3339, record_from_value, record_to_value,
    workflow_key, FlowError, FlowJobSummary, FlowRecord, FlowStepSummary, FlowSummary,
    FlowTriggerSummary, Result, DEFAULT_FLOW_FOLDER, FLOW_FOLDERS_KEY, FLOW_KEY_PREFIX,
    FLOW_NAMESPACE,
};
pub use node::{
    compile_flow_nodes, FlowNodeDefinition, FlowNodeOwner, FlowNodeRegistry, FlowNodeSpec,
};
pub use parser::parse_workflow;
pub use runner::{
    resolve_run_id, run_flow_with_executor, run_flow_with_executor_and_observer,
    run_flow_with_executor_for_run_id, run_flow_with_executor_for_run_id_and_observer,
    DryRunActionExecutor, FlowActionExecutor, FlowActionOutcome, FlowExecutionContext, FlowJobRun,
    FlowLifecycleEvent, FlowLifecycleEventKind, FlowNodeRun, FlowRunObserver, FlowRunReport,
    FlowRunRequest, FlowRunStatus,
};
