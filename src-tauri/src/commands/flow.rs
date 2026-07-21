//! 工作流(gt-flow)相关命令 + 应用级 Action 执行器。
//!
//! `AppFlowActionExecutor` 是 `gt-flow` 和业务 crate(`gt-git`/`gt-data`)
//! 的连接层:`gt-flow` 只负责编排(顺序执行 job/step、渲染表达式),
//! 真正的动作(commit/push/sync/文件操作)由这里注入执行。
//!
//! Core 节点暂时由 `match node.uses.as_str()` 分发；插件节点通过 manifest 注册，
//! 运行时按插件与 backend method 快照路由到 sidecar。

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use gt_data::{DataHub, RunJournalObserver, RunJournalRecord, RunJournalSummary};
use gt_flow::{
    CloudEvent, EventDefinition, EventDraft, EventReceipt, FlowActionExecutor, FlowActionOutcome,
    FlowBuildDraft, FlowBuildRequest, FlowExecutionContext, FlowNodeDefinition, FlowNodeOwner,
    FlowNodeRegistry, FlowNodeSpec, FlowRecord, FlowRunReport, FlowRunRequest, FlowSummary,
};
use gt_git::GitRepo;

use crate::auth::resolve_auth;
use crate::commands::{files as file_commands, git as git_commands, remote, sync};
use crate::extensions::{ExtensionRegistry, PluginFlowNodeBindingSnapshot};
use crate::identity::{commit_identity_for_repo_remote, preferred_commit_remote};
use crate::{publish_flow_event, sync_data_center_now, AppState};

const MAX_PLUGIN_NODE_OUTCOME_BYTES: usize = 256 * 1024;

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

fn workspace_context_from_data(data: &DataHub) -> Value {
    let workspace = data.workspace().snapshot();
    json!({
        "active_repo": workspace.active_repo,
        "active_branch": workspace.active_branch,
        "device_id": workspace.device_id,
        "device_name": workspace.device_name,
    })
}

struct AppFlowActionExecutor<'a> {
    state: &'a AppState,
    plugin_bindings: BTreeMap<String, PluginFlowNodeBindingSnapshot>,
}

impl<'a> AppFlowActionExecutor<'a> {
    fn new(
        state: &'a AppState,
        plugin_bindings: BTreeMap<String, PluginFlowNodeBindingSnapshot>,
    ) -> Self {
        Self {
            state,
            plugin_bindings,
        }
    }
}

impl FlowActionExecutor for AppFlowActionExecutor<'_> {
    fn execute(
        &mut self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> gt_flow::Result<FlowActionOutcome> {
        if matches!(node.owner.as_ref(), Some(FlowNodeOwner::Plugin(_))) {
            return self.execute_plugin_node(node, inputs, context);
        }
        let outcome = match node.uses.as_str() {
            "gittributary/files/assert-exists@v1" => self.assert_exists(inputs),
            "gittributary/files/sync-dir@v1" => self.sync_dir(inputs),
            "gittributary/git/commit-all@v1" => self.commit_all(inputs),
            "gittributary/git/push@v1" => self.push(inputs),
            "gittributary/store/sync-now@v1" => self.sync_store(),
            _ => Err(gt_flow::FlowError::Validation(format!(
                "节点动作未实现: {}",
                node.uses
            ))),
        }?;
        Ok(outcome)
    }
}

impl AppFlowActionExecutor<'_> {
    fn execute_plugin_node(
        &self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let binding = self.plugin_bindings.get(&node.uses).ok_or_else(|| {
            gt_flow::FlowError::Validation(format!("插件节点运行快照不存在: {}", node.uses))
        })?;
        let value = self
            .state
            .extensions
            .invoke_flow_node(
                &self.state.plugin_host,
                binding,
                json!({
                    "inputs": inputs,
                    "context": {
                        "now": &context.now,
                    },
                }),
            )
            .map_err(to_validation_error)?;
        decode_plugin_node_outcome(&node.uses, value)
    }

    fn assert_exists(
        &self,
        inputs: &BTreeMap<String, String>,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let path = require_input(inputs, "path")?;
        let non_empty = inputs
            .get("non_empty")
            .map(|value| value == "true")
            .unwrap_or(false);
        let path_ref = Path::new(&path);
        if !path_ref.exists() {
            return Err(gt_flow::FlowError::Validation(format!(
                "路径不存在: {}",
                path
            )));
        }
        if non_empty && is_empty_path(path_ref).map_err(to_validation_error)? {
            return Err(gt_flow::FlowError::Validation(format!(
                "路径为空: {}",
                path
            )));
        }
        Ok(FlowActionOutcome {
            outputs: json!({ "path": path }),
            skipped: false,
            message: Some("path_exists".to_string()),
        })
    }

    fn sync_dir(&self, inputs: &BTreeMap<String, String>) -> gt_flow::Result<FlowActionOutcome> {
        let from = require_input(inputs, "from")?;
        let to = require_input(inputs, "to")?;
        let changed_count =
            copy_dir_recursive(Path::new(&from), Path::new(&to)).map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "changed_count": changed_count }),
            skipped: false,
            message: Some(format!("synced {changed_count} files")),
        })
    }

    fn commit_all(&self, inputs: &BTreeMap<String, String>) -> gt_flow::Result<FlowActionOutcome> {
        let repo_path = require_input(inputs, "repo")?;
        let message = require_input(inputs, "message")?;
        let repo = GitRepo::open(&repo_path).map_err(to_validation_error)?;
        let branch = repo.current_branch().unwrap_or_else(|_| "HEAD".to_string());
        let remote = preferred_commit_remote(&repo);
        let identity = commit_identity_for_repo_remote(self.state, &repo_path, remote.as_deref());
        repo.stage_all().map_err(to_validation_error)?;
        match repo.commit_with_identity(&message, &identity) {
            Ok(commit) => Ok(FlowActionOutcome {
                outputs: json!({ "commit": commit.id, "branch": branch }),
                skipped: false,
                message: Some("committed".to_string()),
            }),
            Err(gt_git::GitError::NothingToCommit) => Ok(FlowActionOutcome {
                outputs: json!({ "commit": Value::Null, "branch": branch }),
                skipped: true,
                message: Some("nothing_to_commit".to_string()),
            }),
            Err(error) => Err(to_validation_error(error)),
        }
    }

    fn push(&self, inputs: &BTreeMap<String, String>) -> gt_flow::Result<FlowActionOutcome> {
        let repo_path = require_input(inputs, "repo")?;
        let remote = require_input(inputs, "remote")?;
        let branch = require_input(inputs, "branch")?;
        let auth = resolve_auth(self.state);
        let repo = GitRepo::open(&repo_path).map_err(to_validation_error)?;
        repo.push(&remote, &branch, &auth)
            .map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "remote": remote, "branch": branch }),
            skipped: false,
            message: Some("pushed".to_string()),
        })
    }

    fn sync_store(&self) -> gt_flow::Result<FlowActionOutcome> {
        let message = sync_data_center_now(self.state).map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "message": message }),
            skipped: false,
            message: Some("store_synced".to_string()),
        })
    }
}

fn decode_plugin_node_outcome(uses: &str, value: Value) -> gt_flow::Result<FlowActionOutcome> {
    let size = serde_json::to_vec(&value)
        .map_err(to_validation_error)?
        .len();
    if size > MAX_PLUGIN_NODE_OUTCOME_BYTES {
        return Err(gt_flow::FlowError::Validation(format!(
            "插件节点返回值超过 {} bytes 限制 ({uses}): {size}",
            MAX_PLUGIN_NODE_OUTCOME_BYTES
        )));
    }
    serde_json::from_value(value).map_err(|error| {
        gt_flow::FlowError::Validation(format!("插件节点返回值无效 ({uses}): {error}"))
    })
}

fn require_input(inputs: &BTreeMap<String, String>, key: &str) -> gt_flow::Result<String> {
    inputs
        .get(key)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| gt_flow::FlowError::Validation(format!("缺少输入: {key}")))
}

fn is_empty_path(path: &Path) -> std::io::Result<bool> {
    if path.is_dir() {
        Ok(fs::read_dir(path)?.next().is_none())
    } else {
        Ok(path.metadata()?.len() == 0)
    }
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<usize> {
    if !from.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("源目录不存在: {}", from.display()),
        ));
    }
    fs::create_dir_all(to)?;
    let mut changed_count = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            changed_count += copy_dir_recursive(&source, &target)?;
        } else {
            fs::copy(&source, &target)?;
            changed_count += 1;
        }
    }
    Ok(changed_count)
}

fn to_validation_error(error: impl ToString) -> gt_flow::FlowError {
    gt_flow::FlowError::Validation(error.to_string())
}

#[tauri::command]
pub(crate) fn flow_validate(workflow: String) -> Result<FlowSummary, String> {
    gt_flow::parse_workflow(&workflow).map_err(|e| e.to_string())
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
    gt_flow::build_flow_draft(request, &events, &registry).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn flow_save(
    request: FlowSaveRequest,
    state: State<'_, AppState>,
) -> Result<FlowRecord, String> {
    let summary = gt_flow::parse_workflow(&request.workflow).map_err(|e| e.to_string())?;
    let now = gt_flow::now_rfc3339();
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
    let folder = gt_flow::normalize_folder(requested_folder.or(existing_folder), Some(&summary));

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
            let key = gt_flow::workflow_key(&record.summary.id);
            FlowListItem {
                id: record.summary.id.clone(),
                key,
                folder: gt_flow::normalize_folder(record.folder.as_deref(), Some(&record.summary)),
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
    record.set_enabled(enabled, gt_flow::now_rfc3339());
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
    let folder = gt_flow::normalize_folder(Some(&path), None);
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
    let folder = gt_flow::normalize_folder(Some(&path), None);
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
            gt_flow::normalize_folder(record.folder.as_deref(), Some(&record.summary)) == folder
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
        .map(|folder| gt_flow::normalize_folder(Some(&folder), None))
        .collect::<Vec<_>>();

    for record in data.flows().list().map_err(|e| e.to_string())? {
        folders.push(gt_flow::normalize_folder(
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
        .map(|folder| gt_flow::normalize_folder(Some(&folder), None))
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
                    name: "GitTributary Core".to_string(),
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

fn flow_run_blocking(
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
    let run_id = gt_flow::resolve_run_id(&request);
    {
        let data = state.data.lock().unwrap();
        data.run_journal()
            .start_run(&run_id, &record.summary.id, &gt_flow::now_rfc3339())
            .map_err(|error| format!("flow_run_journal_start_failed: {error}"))?;
    }

    let journal = {
        let data = state.data.lock().unwrap();
        data.run_journal().clone()
    };
    let mut observer = RunJournalObserver::new(&journal);
    let mut executor = AppFlowActionExecutor::new(state, plugin_bindings);
    let report = gt_flow::run_flow_with_executor_for_run_id_and_observer(
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
        // 业务动作已经结束，结果投影失败不能改变真实报告或触发自动重试。
        eprintln!("flow_run_completed_but_result_persistence_failed: {error}");
        let _ = publish_flow_event(
            state,
            EventDraft {
                source: "gittributary://gt-flow".to_string(),
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
                source: "gittributary://gt-flow".to_string(),
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
            source: "gittributary://gt-flow".to_string(),
            event_type: match report.status {
                gt_flow::FlowRunStatus::Succeeded => "flow.run.succeeded",
                gt_flow::FlowRunStatus::Skipped => "flow.run.skipped",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_catalog_registers_journal_failure_notification() {
        let pool = gt_flow::EventPool::new();
        assert!(pool
            .catalog()
            .iter()
            .any(|event| event.event_type == "flow.run.journal_failed"));
        assert!(pool
            .catalog()
            .iter()
            .any(|event| event.event_type == "flow.run.result_persistence_failed"));
    }

    #[test]
    fn plugin_node_outcome_is_bounded_before_entering_run_report() {
        let oversized = json!({
            "outputs": { "payload": "x".repeat(MAX_PLUGIN_NODE_OUTCOME_BYTES) },
            "skipped": false,
            "message": null
        });
        let error = decode_plugin_node_outcome("plugin/example@v1", oversized).unwrap_err();
        assert!(error.to_string().contains("返回值超过"));
    }

    #[test]
    fn flow_run_persists_lifecycle_before_returning_report() {
        let directory = tempfile::tempdir().unwrap();
        let mut data = DataHub::open(directory.path()).unwrap();
        let workflow = r#"
name: Journal Demo
gt:
  id: journal-demo
  enabled: true
on:
  workflow_dispatch:
jobs:
  main:
    steps:
      - uses: gittributary/files/assert-exists@v1
        with:
          path: README.md
"#
        .trim()
        .to_string();
        let summary = gt_flow::parse_workflow(&workflow).unwrap();
        let record = FlowRecord::new(
            workflow,
            summary,
            None,
            gt_flow::now_rfc3339(),
            gt_flow::now_rfc3339(),
        );
        data.flows_mut().save(&record).unwrap();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            data: std::sync::Mutex::new(data),
            event_pool: std::sync::Mutex::new(gt_flow::EventPool::new()),
            node_registry: std::sync::Mutex::new(FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(crate::plugin_host::PluginHostSupervisor::default()),
        };

        let report = flow_run_blocking("journal-demo".to_string(), None, &state).unwrap();
        assert_eq!(report.status, gt_flow::FlowRunStatus::Failed);
        let data = state.data.lock().unwrap();
        let records = data.run_journal().read_run(&report.run_id).unwrap();
        assert_eq!(records.len(), 6);
        assert_eq!(records[0].kind, gt_data::RunJournalEventKind::RunStarted);
        assert_eq!(records[1].kind, gt_data::RunJournalEventKind::JobStarted);
        assert_eq!(records[2].kind, gt_data::RunJournalEventKind::NodeStarted);
        assert_eq!(records[3].kind, gt_data::RunJournalEventKind::NodeFinished);
        assert_eq!(records[4].kind, gt_data::RunJournalEventKind::JobFinished);
        assert_eq!(records[5].kind, gt_data::RunJournalEventKind::RunCompleted);
        let result = data.run_results().read(&report.run_id).unwrap().unwrap();
        assert_eq!(result.status, report.status);
        assert_eq!(
            result.jobs[0].nodes[0].node_id,
            report.jobs[0].nodes[0].node_id
        );
    }

    #[test]
    fn inspects_only_executable_core_node_sources() {
        let registry = inspect_flow_node_sources(&ExtensionRegistry::default()).unwrap();
        let uses = registry
            .list()
            .into_iter()
            .map(|definition| definition.uses)
            .collect::<Vec<_>>();
        assert_eq!(uses.len(), 5);
        assert!(uses.contains(&"gittributary/files/assert-exists@v1".to_string()));
        assert!(uses.contains(&"gittributary/files/sync-dir@v1".to_string()));
        assert!(uses.contains(&"gittributary/git/commit-all@v1".to_string()));
        assert!(uses.contains(&"gittributary/git/push@v1".to_string()));
        assert!(uses.contains(&"gittributary/store/sync-now@v1".to_string()));
        assert!(!uses.iter().any(|uses| uses.contains("build-html")));
        assert!(!uses.iter().any(|uses| uses.contains("notify")));
        assert!(!uses.iter().any(|uses| uses.contains("publish-context")));
    }

    #[test]
    fn inspects_active_plugin_node_sources() {
        let directory = tempfile::tempdir().unwrap();
        let backend = directory.path().join("backend");
        std::fs::create_dir_all(&backend).unwrap();
        let library = if cfg!(target_os = "windows") {
            "demo.dll"
        } else if cfg!(target_os = "macos") {
            "libdemo.dylib"
        } else {
            "libdemo.so"
        };
        std::fs::write(backend.join(library), b"placeholder").unwrap();
        std::fs::write(
            directory.path().join("manifest.json"),
            r#"{
              "schemaVersion": 1,
              "apiVersion": "1",
              "id": "com.example.demo",
              "name": "Demo",
              "version": "0.1.0",
              "contributes": {"flowNodes": [{
                "uses": "com.example.demo/action@v1",
                "name": "Demo action",
                "type": "action",
                "summary": "Run demo",
                "method": "flow.action"
              }]},
              "backend": {
                "runtime": "rust-cdylib",
                "entry": "backend",
                "library": "demo",
                "methods": {"flow.action": []}
              }
            }"#,
        )
        .unwrap();
        let extensions = ExtensionRegistry::default();
        extensions.register_path(directory.path()).unwrap();

        let registry = inspect_flow_node_sources(&extensions).unwrap();
        assert_eq!(registry.list().len(), 6);
        assert_eq!(
            registry.owner_of("com.example.demo/action@v1"),
            Some(&FlowNodeOwner::Plugin("com.example.demo".to_string()))
        );
    }

    #[test]
    fn serializes_flow_node_catalog_source() {
        let item = FlowNodeCatalogItem {
            definition: FlowNodeDefinition {
                uses: "com.example.demo/action@v1".to_string(),
                name: "Demo".to_string(),
                node_type: "action".to_string(),
                summary: "Demo action".to_string(),
                description: String::new(),
                inputs_schema: BTreeMap::new(),
                outputs_schema: BTreeMap::new(),
            },
            source: FlowNodeCatalogSource {
                kind: "plugin",
                id: Some("com.example.demo".to_string()),
                name: "Demo Plugin".to_string(),
                version: Some("1.2.3".to_string()),
            },
        };
        let value = serde_json::to_value(item).unwrap();
        assert_eq!(value["uses"], "com.example.demo/action@v1");
        assert_eq!(value["source"]["kind"], "plugin");
        assert_eq!(value["source"]["id"], "com.example.demo");
        assert_eq!(value["source"]["name"], "Demo Plugin");
        assert_eq!(value["source"]["version"], "1.2.3");
    }

    #[test]
    fn require_input_errors_when_missing() {
        let inputs: BTreeMap<String, String> = BTreeMap::new();
        assert!(require_input(&inputs, "path").is_err());
    }

    #[test]
    fn require_input_returns_value_when_present() {
        let mut inputs = BTreeMap::new();
        inputs.insert("path".to_string(), "/tmp/x".to_string());
        assert_eq!(require_input(&inputs, "path").unwrap(), "/tmp/x");
    }

    #[test]
    fn is_empty_path_detects_empty_dir_and_file() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(is_empty_path(dir.path()).unwrap());
        let file = dir.path().join("f.txt");
        fs::write(&file, "").unwrap();
        assert!(is_empty_path(&file).unwrap());
        fs::write(&file, "content").unwrap();
        assert!(!is_empty_path(&file).unwrap());
    }

    #[test]
    fn copy_dir_recursive_copies_nested_files() {
        let src = tempfile::TempDir::new().unwrap();
        let dst = tempfile::TempDir::new().unwrap();
        fs::create_dir_all(src.path().join("nested")).unwrap();
        fs::write(src.path().join("a.txt"), "a").unwrap();
        fs::write(src.path().join("nested/b.txt"), "b").unwrap();

        let count = copy_dir_recursive(src.path(), dst.path()).unwrap();
        assert_eq!(count, 2);
        assert!(dst.path().join("a.txt").exists());
        assert!(dst.path().join("nested/b.txt").exists());
    }

    #[test]
    fn copy_dir_recursive_errors_on_missing_source() {
        let dst = tempfile::TempDir::new().unwrap();
        let missing = dst.path().join("does-not-exist");
        let err = copy_dir_recursive(&missing, dst.path()).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    }
}
