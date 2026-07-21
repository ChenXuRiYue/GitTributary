use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{FlowError, FlowNodeRegistry, FlowNodeSpec, FlowRecord, FlowRunIntent, Result};

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
struct NoopFlowRunObserver;

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
            "gittributary/files/assert-exists@v1" => json!({
                "path": inputs.get("path").cloned().unwrap_or_default(),
            }),
            "gittributary/files/sync-dir@v1" => json!({
                "changed_count": 0,
            }),
            "gittributary/git/commit-all@v1" => json!({
                "commit": "dry-run",
                "branch": "dry-run",
            }),
            "gittributary/git/push@v1" => json!({
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

pub fn run_flow_with_executor(
    record: &FlowRecord,
    request: FlowRunRequest,
    registry: &FlowNodeRegistry,
    workspace: Value,
    executor: &mut impl FlowActionExecutor,
) -> FlowRunReport {
    let run_id = resolve_run_id(&request);
    let mut observer = NoopFlowRunObserver;
    run_flow_with_executor_for_run_id_and_observer(
        record,
        request,
        run_id,
        registry,
        workspace,
        executor,
        &mut observer,
    )
}

pub fn run_flow_with_executor_and_observer(
    record: &FlowRecord,
    request: FlowRunRequest,
    registry: &FlowNodeRegistry,
    workspace: Value,
    executor: &mut impl FlowActionExecutor,
    observer: &mut impl FlowRunObserver,
) -> FlowRunReport {
    let run_id = resolve_run_id(&request);
    run_flow_with_executor_for_run_id_and_observer(
        record, request, run_id, registry, workspace, executor, observer,
    )
}

pub fn run_flow_with_executor_for_run_id(
    record: &FlowRecord,
    request: FlowRunRequest,
    run_id: String,
    registry: &FlowNodeRegistry,
    workspace: Value,
    executor: &mut impl FlowActionExecutor,
) -> FlowRunReport {
    let mut observer = NoopFlowRunObserver;
    run_flow_with_executor_for_run_id_and_observer(
        record,
        request,
        run_id,
        registry,
        workspace,
        executor,
        &mut observer,
    )
}

pub fn run_flow_with_executor_for_run_id_and_observer(
    record: &FlowRecord,
    request: FlowRunRequest,
    run_id: String,
    registry: &FlowNodeRegistry,
    workspace: Value,
    executor: &mut impl FlowActionExecutor,
    observer: &mut impl FlowRunObserver,
) -> FlowRunReport {
    let started_at = now_rfc3339();
    let trigger = request
        .intent
        .as_ref()
        .map(|intent| intent.trigger.clone())
        .unwrap_or_else(|| "workflow_dispatch".to_string());
    let reason = request
        .intent
        .as_ref()
        .map(|intent| intent.reason.clone())
        .unwrap_or_else(|| "manual_run".to_string());
    let event = request
        .intent
        .as_ref()
        .map(|intent| intent.event.clone())
        .unwrap_or_else(|| manual_event(&record.summary.id));
    let inputs = normalize_object(request.inputs);
    let mut context = FlowExecutionContext {
        event: event.clone(),
        inputs: inputs.clone(),
        workspace,
        now: started_at.clone(),
    };

    let mut report = FlowRunReport {
        run_id: run_id.clone(),
        flow_id: record.summary.id.clone(),
        flow_name: record.summary.name.clone(),
        status: FlowRunStatus::Running,
        trigger,
        reason,
        started_at,
        finished_at: String::new(),
        jobs: Vec::new(),
        event,
        inputs,
        error: None,
    };
    observe_lifecycle(
        observer,
        FlowLifecycleEventKind::RunStarted,
        &run_id,
        &record.summary.id,
        None,
        None,
        FlowRunStatus::Running,
        &report.started_at,
    );

    if !record.enabled || !record.summary.enabled {
        report.status = FlowRunStatus::Skipped;
        report.error = Some("flow_disabled".to_string());
        report.finished_at = now_rfc3339();
        observe_lifecycle(
            observer,
            FlowLifecycleEventKind::RunFinished,
            &run_id,
            &record.summary.id,
            None,
            None,
            report.status,
            &report.finished_at,
        );
        return report;
    }

    let nodes = registry.compile_record(record);
    let mut overall_status = FlowRunStatus::Succeeded;

    for job in &record.summary.jobs {
        let mut job_run = FlowJobRun {
            run_id: run_id.clone(),
            flow_id: record.summary.id.clone(),
            job_id: job.id.clone(),
            status: FlowRunStatus::Running,
            started_at: Some(now_rfc3339()),
            finished_at: None,
            nodes: Vec::new(),
            error: None,
        };
        observe_lifecycle(
            observer,
            FlowLifecycleEventKind::JobStarted,
            &run_id,
            &record.summary.id,
            Some(&job.id),
            None,
            FlowRunStatus::Running,
            job_run
                .started_at
                .as_deref()
                .expect("job start time is set"),
        );

        for node in nodes.iter().filter(|node| node.job_id == job.id) {
            let node_run = execute_node(
                &run_id,
                &record.summary.id,
                node,
                &mut context,
                executor,
                observer,
            );
            let failed = node_run.status == FlowRunStatus::Failed;
            if failed {
                job_run.error = node_run.error.clone();
            }
            job_run.nodes.push(node_run);
            if failed {
                overall_status = FlowRunStatus::Failed;
                break;
            }
        }

        job_run.status = if job_run
            .nodes
            .iter()
            .any(|node| node.status == FlowRunStatus::Failed)
        {
            FlowRunStatus::Failed
        } else if job_run
            .nodes
            .iter()
            .all(|node| node.status == FlowRunStatus::Skipped)
        {
            FlowRunStatus::Skipped
        } else {
            FlowRunStatus::Succeeded
        };
        job_run.finished_at = Some(now_rfc3339());
        observe_lifecycle(
            observer,
            FlowLifecycleEventKind::JobFinished,
            &run_id,
            &record.summary.id,
            Some(&job.id),
            None,
            job_run.status,
            job_run
                .finished_at
                .as_deref()
                .expect("job finish time is set"),
        );
        report.jobs.push(job_run);

        if overall_status == FlowRunStatus::Failed {
            break;
        }
    }

    report.status = overall_status;
    report.error = report
        .jobs
        .iter()
        .find_map(|job| job.error.clone())
        .filter(|_| overall_status == FlowRunStatus::Failed);
    report.finished_at = now_rfc3339();
    observe_lifecycle(
        observer,
        FlowLifecycleEventKind::RunFinished,
        &run_id,
        &record.summary.id,
        None,
        None,
        report.status,
        &report.finished_at,
    );
    report
}

fn execute_node(
    run_id: &str,
    flow_id: &str,
    node: &FlowNodeSpec,
    context: &mut FlowExecutionContext,
    executor: &mut impl FlowActionExecutor,
    observer: &mut impl FlowRunObserver,
) -> FlowNodeRun {
    let started_at = now_rfc3339();
    let mut node_run = FlowNodeRun {
        run_id: run_id.to_string(),
        flow_id: flow_id.to_string(),
        job_id: node.job_id.clone(),
        node_id: node.id.clone(),
        uses: node.uses.clone(),
        status: FlowRunStatus::Running,
        started_at: Some(started_at),
        finished_at: None,
        inputs: BTreeMap::new(),
        outputs: Value::Object(Map::new()),
        message: None,
        error: None,
    };
    observe_lifecycle(
        observer,
        FlowLifecycleEventKind::NodeStarted,
        run_id,
        flow_id,
        Some(&node.job_id),
        Some(&node.id),
        FlowRunStatus::Running,
        node_run
            .started_at
            .as_deref()
            .expect("node start time is set"),
    );

    if !node.known {
        node_run.status = FlowRunStatus::Failed;
        node_run.error = Some(format!("节点动作未登记: {}", node.uses));
        node_run.finished_at = Some(now_rfc3339());
        observe_node_finished(observer, &node_run);
        return node_run;
    }

    match render_inputs(&node.inputs, context) {
        Ok(inputs) => match executor.execute(node, &inputs, context) {
            Ok(outcome) => {
                node_run.inputs = inputs;
                node_run.outputs = normalize_object(outcome.outputs);
                node_run.message = outcome.message;
                node_run.status = if outcome.skipped {
                    FlowRunStatus::Skipped
                } else {
                    FlowRunStatus::Succeeded
                };
                insert_step_outputs(context, &node.id, &node_run.outputs);
            }
            Err(error) => {
                node_run.inputs = inputs;
                node_run.status = FlowRunStatus::Failed;
                node_run.error = Some(error.to_string());
            }
        },
        Err(error) => {
            node_run.status = FlowRunStatus::Failed;
            node_run.error = Some(error.to_string());
        }
    }

    node_run.finished_at = Some(now_rfc3339());
    observe_node_finished(observer, &node_run);
    node_run
}

fn observe_node_finished(observer: &mut impl FlowRunObserver, node: &FlowNodeRun) {
    observe_lifecycle(
        observer,
        FlowLifecycleEventKind::NodeFinished,
        &node.run_id,
        &node.flow_id,
        Some(&node.job_id),
        Some(&node.node_id),
        node.status,
        node.finished_at
            .as_deref()
            .expect("finished node has finish time"),
    );
}

#[allow(clippy::too_many_arguments)]
fn observe_lifecycle(
    observer: &mut impl FlowRunObserver,
    kind: FlowLifecycleEventKind,
    run_id: &str,
    flow_id: &str,
    job_id: Option<&str>,
    node_id: Option<&str>,
    status: FlowRunStatus,
    occurred_at: &str,
) {
    observer.observe(&FlowLifecycleEvent {
        kind,
        run_id: run_id.to_string(),
        flow_id: flow_id.to_string(),
        job_id: job_id.map(str::to_string),
        node_id: node_id.map(str::to_string),
        status,
        occurred_at: occurred_at.to_string(),
    });
}

fn render_inputs(
    inputs: &BTreeMap<String, String>,
    context: &FlowExecutionContext,
) -> Result<BTreeMap<String, String>> {
    inputs
        .iter()
        .map(|(key, value)| render_value(value, context).map(|rendered| (key.clone(), rendered)))
        .collect()
}

fn render_value(value: &str, context: &FlowExecutionContext) -> Result<String> {
    let mut rendered = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("${{") {
        rendered.push_str(&rest[..start]);
        let after_start = &rest[start + 3..];
        let Some(end) = after_start.find("}}") else {
            return Err(FlowError::Validation(format!(
                "表达式缺少闭合 }}}}: {value}"
            )));
        };
        let expression = after_start[..end].trim();
        rendered.push_str(&resolve_expression(expression, context)?);
        rest = &after_start[end + 2..];
    }
    rendered.push_str(rest);
    Ok(rendered)
}

fn resolve_expression(expression: &str, context: &FlowExecutionContext) -> Result<String> {
    let value = match expression {
        "gt.now" => Value::String(context.now.clone()),
        "gt.workspace.active_repo" => get_path(&context.workspace, &["active_repo"])
            .cloned()
            .unwrap_or(Value::Null),
        "gt.workspace.active_branch" => get_path(&context.workspace, &["active_branch"])
            .cloned()
            .unwrap_or(Value::Null),
        _ if expression.starts_with("event.") => {
            resolve_path_expression(expression, "event", &context.event)?
        }
        _ if expression.starts_with("inputs.") => {
            resolve_path_expression(expression, "inputs", &context.inputs)?
        }
        _ if expression.starts_with("steps.") => {
            resolve_path_expression(expression, "steps", &context_steps(context))?
        }
        _ => {
            return Err(FlowError::Validation(format!(
                "不支持的表达式: ${{{{ {expression} }}}}"
            )))
        }
    };
    value_to_string(&value).ok_or_else(|| {
        FlowError::Validation(format!("表达式没有可渲染值: ${{{{ {expression} }}}}"))
    })
}

fn resolve_path_expression(expression: &str, root: &str, value: &Value) -> Result<Value> {
    let path = expression
        .strip_prefix(root)
        .and_then(|rest| rest.strip_prefix('.'))
        .ok_or_else(|| FlowError::Validation(format!("表达式路径无效: {expression}")))?;
    let parts = path.split('.').collect::<Vec<_>>();
    get_path(value, &parts)
        .cloned()
        .ok_or_else(|| FlowError::Validation(format!("表达式引用不存在: ${{{{ {expression} }}}}")))
}

fn get_path<'a>(value: &'a Value, parts: &[&str]) -> Option<&'a Value> {
    parts.iter().try_fold(value, |current, part| {
        if part.is_empty() {
            return None;
        }
        match current {
            Value::Object(map) => map.get(*part),
            _ => None,
        }
    })
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(value) => Some(value.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::Array(_) | Value::Object(_) => Some(value.to_string()),
    }
}

fn context_steps(context: &FlowExecutionContext) -> Value {
    context
        .workspace
        .get("__flow")
        .and_then(|value| value.get("steps"))
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()))
}

fn insert_step_outputs(context: &mut FlowExecutionContext, step_id: &str, outputs: &Value) {
    let workspace = context
        .workspace
        .as_object_mut()
        .expect("workspace is normalized object");
    let flow = workspace
        .entry("__flow")
        .or_insert_with(|| json!({ "steps": {} }));
    if !flow.is_object() {
        *flow = json!({ "steps": {} });
    }
    let flow_object = flow.as_object_mut().expect("flow is object");
    let steps = flow_object
        .entry("steps")
        .or_insert_with(|| Value::Object(Map::new()));
    if !steps.is_object() {
        *steps = Value::Object(Map::new());
    }
    let steps_object = steps.as_object_mut().expect("steps is object");
    steps_object.insert(
        step_id.to_string(),
        json!({
            "outputs": outputs,
        }),
    );
}

fn manual_event(flow_id: &str) -> Value {
    json!({
        "id": "evt_manual",
        "type": "workflow_dispatch",
        "source": "gittributary://ui",
        "subject": format!("flow:{flow_id}"),
        "data": {},
    })
}

fn normalize_object(value: Value) -> Value {
    if value.is_null() {
        Value::Object(Map::new())
    } else {
        value
    }
}

fn run_id() -> String {
    static RUN_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    format!(
        "run_{}_{}_{}",
        Utc::now().timestamp_millis(),
        std::process::id(),
        RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn resolve_run_id(request: &FlowRunRequest) -> String {
    let candidate = request
        .intent
        .as_ref()
        .map(|intent| intent.id.replace("run_intent", "run"))
        .unwrap_or_else(run_id);
    if candidate.as_bytes().len() <= 96 {
        candidate
    } else {
        run_id()
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
