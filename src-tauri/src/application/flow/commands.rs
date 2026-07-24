//! 工作流(na-flow)相关命令 + 应用级 Action 执行器。
//!
//! `AppFlowActionExecutor` 是 `na-flow` 和业务 crate(`na-git`/`na-data`)
//! 的连接层:`na-flow` 只负责编排(顺序执行 job/step、渲染表达式),
//! 真正的动作(commit/push/sync/文件操作)由这里注入执行。
//!
//! Core 节点暂时由 `match node.uses.as_str()` 分发；插件节点通过 manifest 注册，
//! 运行时按插件与 backend method 快照路由到 sidecar。

use std::collections::BTreeMap;

use tauri::{AppHandle, Manager, State};

use na_data::{DataHub, RunJournalRecord, RunJournalSummary};
use na_flow::{
    CloudEvent, EventDefinition, EventDraft, EventReceipt, FlowBuildDraft, FlowBuildRequest,
    FlowNodeDefinition, FlowNodeOwner, FlowNodeRegistry, FlowNodeSpec, FlowRecord, FlowRunReport,
    FlowRunRequest, FlowSummary,
};

use crate::application::data::sync;
use crate::application::files::commands as file_commands;
use crate::application::git::commands as git_commands;
use crate::application::git::remote;
use crate::application::plugins::registry::ExtensionRegistry;
use crate::{publish_flow_event, AppState};

mod executor;
mod run;

use run::flow_run_blocking;

pub(crate) fn inspect_flow_node_sources(
    extensions: &ExtensionRegistry,
) -> Result<FlowNodeRegistry, String> {
    let mut core_nodes = Vec::new();
    core_nodes.extend(file_commands::flow_node_definitions());
    core_nodes.extend(git_commands::flow_node_definitions());
    core_nodes.extend(remote::flow_node_definitions());
    core_nodes.extend(sync::flow_node_definitions());

    let mut registry = FlowNodeRegistry::new();
    registry.replace_core_nodes(core_nodes)?;
    extensions.contribute_active_flow_nodes(&mut registry)?;
    Ok(registry)
}

pub(crate) fn refresh_flow_node_registry(state: &AppState) -> Result<(), String> {
    let candidate = inspect_flow_node_sources(&state.extensions)?;
    *state.node_registry.lock().unwrap() = candidate;
    Ok(())
}

#[derive(serde::Serialize)]
pub(crate) struct FlowListItem {
    id: String,
    key: String,
    summary: FlowSummary,
    enabled: bool,
    folder: String,
    created_at: String,
    updated_at: String,
}

#[derive(serde::Serialize)]
pub(crate) struct FlowNodeCatalogItem {
    #[serde(flatten)]
    definition: FlowNodeDefinition,
    source: FlowNodeCatalogSource,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FlowNodeCatalogSource {
    kind: &'static str,
    id: Option<String>,
    name: String,
    version: Option<String>,
}

#[derive(serde::Deserialize)]
pub(crate) struct FlowSaveRequest {
    workflow: String,
    folder: Option<String>,
}

/// 供 `publish_flow_event` / `match_flow_event`(定义在 `lib.rs`,事件池入口)
/// 复用:通过 FlowDefinitionRepository 读取全部 Flow 记录,用来匹配触发条件。
pub(crate) fn flow_records_from_data(data: &DataHub) -> Result<Vec<FlowRecord>, String> {
    data.flows().list().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn flow_validate(workflow: String) -> Result<FlowSummary, String> {
    na_flow::parse_workflow(&workflow).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn flow_build_draft(
    request: FlowBuildRequest,
    state: State<'_, AppState>,
) -> Result<FlowBuildDraft, String> {
    let events = {
        let event_pool = state.event_pool.lock().unwrap();
        event_pool.catalog()
    };
    let registry = state.node_registry.lock().unwrap();
    na_flow::build_flow_draft(request, &events, &registry).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn flow_save(
    request: FlowSaveRequest,
    state: State<'_, AppState>,
) -> Result<FlowRecord, String> {
    let summary = na_flow::parse_workflow(&request.workflow).map_err(|e| e.to_string())?;
    let now = na_flow::now_rfc3339();
    let mut data = state.data.lock().unwrap();
    // 保存是损坏/旧 schema Flow 的修复入口；无法解析的旧值按不存在处理并覆盖。
    let existing = data.flows().get(&summary.id).ok().flatten();
    let created_at = existing
        .as_ref()
        .map(|record| record.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let requested_folder = request.folder.as_deref();
    let existing_folder = existing
        .as_ref()
        .and_then(|record| record.folder.as_deref());
    let folder = na_flow::normalize_folder(requested_folder.or(existing_folder), Some(&summary));

    let record = FlowRecord::new(
        request.workflow,
        summary,
        Some(folder.clone()),
        created_at,
        now,
    );
    data.flows_mut().save(&record).map_err(|e| e.to_string())?;
    let mut folders = flow_folders_from_data(&data)?;
    if !folders.contains(&folder) {
        folders.push(folder);
        save_flow_folders_to_data(&mut data, folders)?;
    }
    Ok(record)
}

#[tauri::command]
pub(crate) fn flow_list(state: State<'_, AppState>) -> Result<Vec<FlowListItem>, String> {
    let data = state.data.lock().unwrap();
    let mut items = flow_records_from_data(&data)?
        .into_iter()
        .map(|record| {
            let key = na_flow::workflow_key(&record.summary.id);
            FlowListItem {
                id: record.summary.id.clone(),
                key,
                folder: na_flow::normalize_folder(record.folder.as_deref(), Some(&record.summary)),
                summary: record.summary,
                enabled: record.enabled,
                created_at: record.created_at,
                updated_at: record.updated_at,
            }
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| {
        a.summary
            .name
            .cmp(&b.summary.name)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(items)
}

#[tauri::command]
pub(crate) fn flow_get(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<FlowRecord>, String> {
    let data = state.data.lock().unwrap();
    data.flows().get(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn flow_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.flows_mut().delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn flow_set_enabled(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<FlowRecord, String> {
    let mut data = state.data.lock().unwrap();
    let mut record = data
        .flows()
        .get(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Flow 不存在: {id}"))?;
    record.set_enabled(enabled, na_flow::now_rfc3339());
    data.flows_mut().save(&record).map_err(|e| e.to_string())?;
    Ok(record)
}

#[tauri::command]
pub(crate) fn flow_list_folders(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let data = state.data.lock().unwrap();
    flow_folders_from_data(&data)
}

#[tauri::command]
pub(crate) fn flow_create_folder(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let mut data = state.data.lock().unwrap();
    let folder = na_flow::normalize_folder(Some(&path), None);
    let mut folders = flow_folders_from_data(&data)?;
    if !folders.contains(&folder) {
        folders.push(folder);
    }
    save_flow_folders_to_data(&mut data, folders)
}

#[tauri::command]
pub(crate) fn flow_delete_folder(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let mut data = state.data.lock().unwrap();
    let folder = na_flow::normalize_folder(Some(&path), None);
    let has_children = flow_folders_from_data(&data)?
        .iter()
        .any(|item| item != &folder && item.starts_with(&format!("{folder}/")));
    if has_children {
        return Err("文件夹非空: 请先删除子文件夹".to_string());
    }
    let has_flows = data
        .flows()
        .list()
        .map_err(|e| e.to_string())?
        .into_iter()
        .any(|record| {
            na_flow::normalize_folder(record.folder.as_deref(), Some(&record.summary)) == folder
        });
    if has_flows {
        return Err("文件夹非空: 请先移动或删除其中的 Flow".to_string());
    }

    let folders = flow_folders_from_data(&data)?
        .into_iter()
        .filter(|item| item != &folder)
        .collect::<Vec<_>>();
    save_flow_folders_to_data(&mut data, folders)
}

fn flow_folders_from_data(data: &DataHub) -> Result<Vec<String>, String> {
    let mut folders = data
        .flows()
        .folders()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|folder| na_flow::normalize_folder(Some(&folder), None))
        .collect::<Vec<_>>();

    for record in data.flows().list().map_err(|e| e.to_string())? {
        folders.push(na_flow::normalize_folder(
            record.folder.as_deref(),
            Some(&record.summary),
        ));
    }

    folders.sort();
    folders.dedup();
    Ok(folders)
}

fn save_flow_folders_to_data(
    data: &mut DataHub,
    folders: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut folders = folders
        .into_iter()
        .map(|folder| na_flow::normalize_folder(Some(&folder), None))
        .collect::<Vec<_>>();
    folders.sort();
    folders.dedup();
    data.flows_mut()
        .save_folders(&folders)
        .map_err(|e| e.to_string())?;
    Ok(folders)
}

#[tauri::command]
pub(crate) fn flow_event_catalog(state: State<'_, AppState>) -> Vec<EventDefinition> {
    let event_pool = state.event_pool.lock().unwrap();
    event_pool.catalog()
}

#[tauri::command]
pub(crate) fn flow_recent_events(state: State<'_, AppState>) -> Vec<CloudEvent> {
    let event_pool = state.event_pool.lock().unwrap();
    event_pool.recent_events()
}

#[tauri::command]
pub(crate) fn flow_emit_event(
    event: EventDraft,
    state: State<'_, AppState>,
) -> Result<EventReceipt, String> {
    publish_flow_event(&state, event)
}

#[tauri::command]
pub(crate) fn flow_match_event(
    event: EventDraft,
    state: State<'_, AppState>,
) -> Result<EventReceipt, String> {
    crate::match_flow_event(&state, event)
}

#[tauri::command]
pub(crate) fn flow_node_catalog(state: State<'_, AppState>) -> Vec<FlowNodeCatalogItem> {
    let _lifecycle = state.extensions.lifecycle_lock();
    let plugins = state
        .extensions
        .list()
        .into_iter()
        .map(|plugin| (plugin.id.clone(), plugin))
        .collect::<BTreeMap<_, _>>();
    let registry = state.node_registry.lock().unwrap();
    registry
        .list_with_owners()
        .into_iter()
        .map(|(definition, owner)| {
            let source = match owner {
                FlowNodeOwner::Core => FlowNodeCatalogSource {
                    kind: "core",
                    id: None,
                    name: "Note Aura Core".to_string(),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                },
                FlowNodeOwner::Plugin(plugin_id) => {
                    let plugin = plugins.get(&plugin_id);
                    FlowNodeCatalogSource {
                        kind: "plugin",
                        id: Some(plugin_id.clone()),
                        name: plugin
                            .map(|item| item.name.clone())
                            .unwrap_or_else(|| plugin_id.clone()),
                        version: plugin.map(|item| item.version.clone()),
                    }
                }
            };
            FlowNodeCatalogItem { definition, source }
        })
        .collect()
}

#[tauri::command]
pub(crate) fn flow_nodes(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FlowNodeSpec>, String> {
    let record = {
        let data = state.data.lock().unwrap();
        data.flows()
            .get(&id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Flow 不存在: {id}"))?
    };
    let registry = state.node_registry.lock().unwrap();
    Ok(registry.compile_record(&record))
}

#[tauri::command]
pub(crate) async fn flow_run(
    id: String,
    request: Option<FlowRunRequest>,
    app: AppHandle,
) -> Result<FlowRunReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        flow_run_blocking(id, request, &state)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn flow_run_journal(
    run_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RunJournalRecord>, String> {
    let data = state.data.lock().unwrap();
    data.run_journal()
        .read_run(&run_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn flow_run_list(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<RunJournalSummary>, String> {
    let data = state.data.lock().unwrap();
    data.run_journal()
        .list_runs(limit.unwrap_or(100).clamp(1, 1000))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
