use std::collections::BTreeMap;

use na_data::{DataHub, RunJournalObserver};
use na_flow::{EventDraft, FlowNodeOwner, FlowRunReport, FlowRunRequest};
use serde_json::{json, Value};

use super::executor::AppFlowActionExecutor;
use crate::{publish_flow_event, AppState};

fn workspace_context_from_data(data: &DataHub) -> Value {
    let workspace = data.workspace().snapshot();
    json!({
        "active_repo": workspace.active_repo,
        "active_branch": workspace.active_branch,
        "device_id": workspace.device_id,
        "device_name": workspace.device_name,
    })
}

pub(super) fn flow_run_blocking(
    id: String,
    request: Option<FlowRunRequest>,
    state: &AppState,
) -> Result<FlowRunReport, String> {
    let _execution = state
        .flow_execution
        .try_lock()
        .map_err(|_| "flow_run_already_in_progress".to_string())?;
    let (record, workspace) = {
        let data = state.data.lock().unwrap();
        let record = data
            .flows()
            .get(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Flow 不存在: {id}"))?;
        let workspace = workspace_context_from_data(&data);
        (record, workspace)
    };
    let (registry, plugin_bindings) = {
        let _lifecycle = state.extensions.lifecycle_lock();
        let registry = state.node_registry.lock().unwrap().clone();
        let mut bindings = BTreeMap::new();
        for node in registry.compile_record(&record) {
            if let Some(FlowNodeOwner::Plugin(plugin_id)) = node.owner {
                let binding = state
                    .extensions
                    .flow_node_binding_snapshot(&plugin_id, &node.uses)?;
                bindings.insert(node.uses, binding);
            }
        }
        (registry, bindings)
    };
    let request = request.unwrap_or(FlowRunRequest {
        intent: None,
        inputs: Value::Object(Default::default()),
    });
    let run_id = na_flow::resolve_run_id(&request);
    {
        let data = state.data.lock().unwrap();
        data.run_journal()
            .start_run(&run_id, &record.summary.id, &na_flow::now_rfc3339())
            .map_err(|error| format!("flow_run_journal_start_failed: {error}"))?;
    }

    let journal = {
        let data = state.data.lock().unwrap();
        data.run_journal().clone()
    };
    let mut observer = RunJournalObserver::new(&journal);
    let mut executor = AppFlowActionExecutor::new(state, plugin_bindings);
    let report = na_flow::run_flow_with_executor_for_run_id_and_observer(
        &record,
        request,
        run_id,
        &registry,
        workspace,
        &mut executor,
        &mut observer,
    );
    let lifecycle_error = observer.take_error();
    let (completion_error, result_error) = {
        let data = state.data.lock().unwrap();
        (
            data.run_journal().complete_run(&report).err(),
            data.run_results().write(&report).err(),
        )
    };
    let journal_error = lifecycle_error.or_else(|| completion_error.map(|error| error.to_string()));
    if let Some(error) = result_error {
        eprintln!("flow_run_completed_but_result_persistence_failed: {error}");
        let _ = publish_flow_event(
            state,
            EventDraft {
                source: "noteaura://na-flow".to_string(),
                event_type: "flow.run.result_persistence_failed".to_string(),
                subject: Some(format!("flow:{}", report.flow_id)),
                data: json!({
                    "flow_id": report.flow_id,
                    "run_id": report.run_id,
                    "status": format!("{:?}", report.status).to_ascii_lowercase(),
                }),
            },
        );
    }
    if let Some(error) = journal_error {
        eprintln!("flow_run_completed_but_journal_failed: {error}");
        let _ = publish_flow_event(
            state,
            EventDraft {
                source: "noteaura://na-flow".to_string(),
                event_type: "flow.run.journal_failed".to_string(),
                subject: Some(format!("flow:{}", report.flow_id)),
                data: json!({
                    "flow_id": report.flow_id,
                    "run_id": report.run_id,
                    "status": format!("{:?}", report.status).to_ascii_lowercase(),
                }),
            },
        );
        return Ok(report);
    }
    let _ = publish_flow_event(
        state,
        EventDraft {
            source: "noteaura://na-flow".to_string(),
            event_type: match report.status {
                na_flow::FlowRunStatus::Succeeded => "flow.run.succeeded",
                na_flow::FlowRunStatus::Skipped => "flow.run.skipped",
                _ => "flow.run.failed",
            }
            .to_string(),
            subject: Some(format!("flow:{}", report.flow_id)),
            data: json!({
                "flow_id": report.flow_id,
                "run_id": report.run_id,
                "status": format!("{:?}", report.status).to_ascii_lowercase(),
            }),
        },
    );

    Ok(report)
}
