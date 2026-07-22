mod expressions;
mod model;

use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{SecondsFormat, Utc};
use serde_json::{Map, Value};

use expressions::{insert_step_outputs, manual_event, normalize_object, render_inputs};
use model::NoopFlowRunObserver;
pub use model::{
    DryRunActionExecutor, FlowActionExecutor, FlowActionOutcome, FlowExecutionContext, FlowJobRun,
    FlowLifecycleEvent, FlowLifecycleEventKind, FlowNodeRun, FlowRunObserver, FlowRunReport,
    FlowRunRequest, FlowRunStatus,
};

use crate::{FlowNodeRegistry, FlowNodeSpec, FlowRecord};

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
        lifecycle_event(
            FlowLifecycleEventKind::RunStarted,
            &run_id,
            &record.summary.id,
            FlowRunStatus::Running,
            &report.started_at,
        ),
    );

    if !record.enabled || !record.summary.enabled {
        report.status = FlowRunStatus::Skipped;
        report.error = Some("flow_disabled".to_string());
        report.finished_at = now_rfc3339();
        observe_lifecycle(
            observer,
            lifecycle_event(
                FlowLifecycleEventKind::RunFinished,
                &run_id,
                &record.summary.id,
                report.status,
                &report.finished_at,
            ),
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
            lifecycle_event(
                FlowLifecycleEventKind::JobStarted,
                &run_id,
                &record.summary.id,
                FlowRunStatus::Running,
                job_run
                    .started_at
                    .as_deref()
                    .expect("job start time is set"),
            )
            .with_job(&job.id),
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
            lifecycle_event(
                FlowLifecycleEventKind::JobFinished,
                &run_id,
                &record.summary.id,
                job_run.status,
                job_run
                    .finished_at
                    .as_deref()
                    .expect("job finish time is set"),
            )
            .with_job(&job.id),
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
        lifecycle_event(
            FlowLifecycleEventKind::RunFinished,
            &run_id,
            &record.summary.id,
            report.status,
            &report.finished_at,
        ),
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
        inputs: Default::default(),
        outputs: Value::Object(Map::new()),
        message: None,
        error: None,
    };
    observe_lifecycle(
        observer,
        lifecycle_event(
            FlowLifecycleEventKind::NodeStarted,
            run_id,
            flow_id,
            FlowRunStatus::Running,
            node_run
                .started_at
                .as_deref()
                .expect("node start time is set"),
        )
        .with_job(&node.job_id)
        .with_node(&node.id),
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
        lifecycle_event(
            FlowLifecycleEventKind::NodeFinished,
            &node.run_id,
            &node.flow_id,
            node.status,
            node.finished_at
                .as_deref()
                .expect("finished node has finish time"),
        )
        .with_job(&node.job_id)
        .with_node(&node.node_id),
    );
}

fn lifecycle_event(
    kind: FlowLifecycleEventKind,
    run_id: &str,
    flow_id: &str,
    status: FlowRunStatus,
    occurred_at: &str,
) -> FlowLifecycleEvent {
    FlowLifecycleEvent {
        kind,
        run_id: run_id.to_string(),
        flow_id: flow_id.to_string(),
        job_id: None,
        node_id: None,
        status,
        occurred_at: occurred_at.to_string(),
    }
}

impl FlowLifecycleEvent {
    fn with_job(mut self, job_id: &str) -> Self {
        self.job_id = Some(job_id.to_string());
        self
    }

    fn with_node(mut self, node_id: &str) -> Self {
        self.node_id = Some(node_id.to_string());
        self
    }
}

fn observe_lifecycle(observer: &mut impl FlowRunObserver, event: FlowLifecycleEvent) {
    observer.observe(&event);
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
    if candidate.len() <= 96 {
        candidate
    } else {
        run_id()
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
