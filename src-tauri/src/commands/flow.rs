//! 工作流(gt-flow)相关命令 + 应用级 Action 执行器。
//!
//! `AppFlowActionExecutor` 是 `gt-flow` 和业务 crate(`gt-git`/`gt-store`)
//! 的连接层:`gt-flow` 只负责编排(顺序执行 job/step、渲染表达式),
//! 真正的动作(commit/push/sync/文件操作)由这里注入执行。
//!
//! 当前用 `match node.uses.as_str()` 做分发,这是已知的技术债——
//! 详见 `doc/工作流/流构造与执行技术实现.md` P2 "真实 Action Registry"。
//! 后续每加一个新节点类型都要来改这个大 match,值得抽成可注册的
//! action map,但这次重构只搬文件、不改行为,故保留现状。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::State;

use gt_flow::{
    CloudEvent, EventDefinition, EventDraft, EventReceipt, FlowActionExecutor, FlowActionOutcome,
    FlowBuildDraft, FlowBuildRequest, FlowExecutionContext, FlowNodeDefinition, FlowNodeSpec,
    FlowRecord, FlowRunReport, FlowRunRequest, FlowSummary,
};
use gt_git::GitRepo;
use gt_store::Store;

use crate::auth::resolve_auth;
use crate::identity::{commit_identity_for_repo_remote, preferred_commit_remote};
use crate::{publish_flow_event, sync_data_center_now, AppState};

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

#[derive(serde::Deserialize)]
pub(crate) struct FlowSaveRequest {
    workflow: String,
    folder: Option<String>,
}

pub(crate) fn flow_record_from_store_value(value: Value) -> Result<FlowRecord, String> {
    gt_flow::record_from_value(value).map_err(|e| e.to_string())
}

fn flow_record_to_store_value(record: &FlowRecord) -> Result<Value, String> {
    gt_flow::record_to_value(record).map_err(|e| e.to_string())
}

/// 供 `publish_flow_event` / `match_flow_event`(定义在 `lib.rs`,事件池入口)
/// 复用:从 Store 里读出全部 Flow 记录,用来匹配触发条件。
pub(crate) fn flow_records_from_store(store: &Store) -> Vec<FlowRecord> {
    store
        .scan(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_KEY_PREFIX)
        .into_iter()
        .filter_map(|(_, value)| flow_record_from_store_value(value).ok())
        .collect()
}

fn workspace_context_from_store(store: &Store) -> Value {
    json!({
        "active_repo": store.active_repo(),
        "active_branch": store.active_branch(),
        "device_id": store.device_id(),
        "device_name": store.device_name(),
    })
}

struct AppFlowActionExecutor<'a> {
    state: &'a AppState,
}

impl<'a> AppFlowActionExecutor<'a> {
    fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl FlowActionExecutor for AppFlowActionExecutor<'_> {
    fn execute(
        &mut self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let outcome = match node.uses.as_str() {
            "gittributary/workspace/resolve-publish-context@v1" => {
                self.resolve_publish_context(inputs, context)
            }
            "gittributary/notes/build-html@v1" => self.build_html_placeholder(inputs),
            "gittributary/files/assert-exists@v1" => self.assert_exists(inputs),
            "gittributary/files/sync-dir@v1" => self.sync_dir(inputs),
            "gittributary/git/commit-all@v1" => self.commit_all(inputs),
            "gittributary/git/push@v1" => self.push(inputs),
            "gittributary/store/sync-now@v1" => self.sync_store(),
            "gittributary/ui/notify@v1" => Ok(FlowActionOutcome {
                outputs: json!({}),
                skipped: false,
                message: Some(format!(
                    "{}: {}",
                    inputs.get("title").cloned().unwrap_or_default(),
                    inputs.get("message").cloned().unwrap_or_default()
                )),
            }),
            _ => Err(gt_flow::FlowError::Validation(format!(
                "节点动作未实现: {}",
                node.uses
            ))),
        }?;
        Ok(outcome)
    }
}

impl AppFlowActionExecutor<'_> {
    fn resolve_publish_context(
        &self,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let workspace_repo = context
            .workspace
            .get("active_repo")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let workspace_branch = context
            .workspace
            .get("active_branch")
            .and_then(Value::as_str)
            .unwrap_or("main");
        let source_repo = input_or_default(inputs, "source_repo", workspace_repo);
        let target_repo = input_or_default(inputs, "target_repo", &source_repo);
        let target_branch = input_or_default(inputs, "target_branch", workspace_branch);
        let output_dir = PathBuf::from(&source_repo)
            .join(".gittributary")
            .join("output")
            .to_string_lossy()
            .to_string();
        Ok(FlowActionOutcome {
            outputs: json!({
                "source_repo": source_repo,
                "target_repo": target_repo,
                "target_branch": target_branch,
                "output_dir": output_dir,
            }),
            skipped: false,
            message: Some("context_resolved".to_string()),
        })
    }

    fn build_html_placeholder(
        &self,
        inputs: &BTreeMap<String, String>,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let output = require_input(inputs, "output")?;
        Ok(FlowActionOutcome {
            outputs: json!({ "html_dir": output }),
            skipped: false,
            message: Some("build_html_placeholder".to_string()),
        })
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

fn input_or_default(inputs: &BTreeMap<String, String>, key: &str, fallback: &str) -> String {
    inputs
        .get(key)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
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
    let key = gt_flow::workflow_key(&summary.id);
    let now = gt_flow::now_rfc3339();
    let mut store = state.store.lock().unwrap();
    let existing = store
        .get(gt_flow::FLOW_NAMESPACE, &key)
        .and_then(|value| flow_record_from_store_value(value).ok());
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
    let value = flow_record_to_store_value(&record)?;
    store
        .set(gt_flow::FLOW_NAMESPACE, &key, value)
        .map_err(|e| e.to_string())?;
    let mut folders = flow_folders_from_store(&store);
    if !folders.contains(&folder) {
        folders.push(folder);
        save_flow_folders_to_store(&mut store, folders)?;
    }
    Ok(record)
}

#[tauri::command]
pub(crate) fn flow_list(state: State<'_, AppState>) -> Vec<FlowListItem> {
    let store = state.store.lock().unwrap();
    let mut items = flow_records_from_store(&store)
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
    items
}

#[tauri::command]
pub(crate) fn flow_get(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<FlowRecord>, String> {
    let store = state.store.lock().unwrap();
    let key = gt_flow::workflow_key(&id);
    store
        .get(gt_flow::FLOW_NAMESPACE, &key)
        .map(flow_record_from_store_value)
        .transpose()
}

#[tauri::command]
pub(crate) fn flow_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    let key = gt_flow::workflow_key(&id);
    store
        .delete(gt_flow::FLOW_NAMESPACE, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn flow_set_enabled(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<FlowRecord, String> {
    let mut store = state.store.lock().unwrap();
    let key = gt_flow::workflow_key(&id);
    let value = store
        .get(gt_flow::FLOW_NAMESPACE, &key)
        .ok_or_else(|| format!("Flow 不存在: {id}"))?;
    let mut record = flow_record_from_store_value(value)?;
    record.set_enabled(enabled, gt_flow::now_rfc3339());
    let value = flow_record_to_store_value(&record)?;
    store
        .set(gt_flow::FLOW_NAMESPACE, &key, value)
        .map_err(|e| e.to_string())?;
    Ok(record)
}

#[tauri::command]
pub(crate) fn flow_list_folders(state: State<'_, AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    flow_folders_from_store(&store)
}

#[tauri::command]
pub(crate) fn flow_create_folder(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.store.lock().unwrap();
    let folder = gt_flow::normalize_folder(Some(&path), None);
    let mut folders = flow_folders_from_store(&store);
    if !folders.contains(&folder) {
        folders.push(folder);
    }
    save_flow_folders_to_store(&mut store, folders)
}

#[tauri::command]
pub(crate) fn flow_delete_folder(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let mut store = state.store.lock().unwrap();
    let folder = gt_flow::normalize_folder(Some(&path), None);
    let has_children = flow_folders_from_store(&store)
        .iter()
        .any(|item| item != &folder && item.starts_with(&format!("{folder}/")));
    if has_children {
        return Err("文件夹非空: 请先删除子文件夹".to_string());
    }
    let has_flows = store
        .scan(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_KEY_PREFIX)
        .into_iter()
        .filter_map(|(_, value)| flow_record_from_store_value(value).ok())
        .any(|record| {
            gt_flow::normalize_folder(record.folder.as_deref(), Some(&record.summary)) == folder
        });
    if has_flows {
        return Err("文件夹非空: 请先移动或删除其中的 Flow".to_string());
    }

    let folders = flow_folders_from_store(&store)
        .into_iter()
        .filter(|item| item != &folder)
        .collect::<Vec<_>>();
    save_flow_folders_to_store(&mut store, folders)
}

fn flow_folders_from_store(store: &Store) -> Vec<String> {
    let mut folders = store
        .get(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_FOLDERS_KEY)
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|folder| gt_flow::normalize_folder(Some(&folder), None))
        .collect::<Vec<_>>();

    for (_, value) in store.scan(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_KEY_PREFIX) {
        if let Ok(record) = flow_record_from_store_value(value) {
            folders.push(gt_flow::normalize_folder(
                record.folder.as_deref(),
                Some(&record.summary),
            ));
        }
    }

    folders.sort();
    folders.dedup();
    folders
}

fn save_flow_folders_to_store(
    store: &mut Store,
    folders: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut folders = folders
        .into_iter()
        .map(|folder| gt_flow::normalize_folder(Some(&folder), None))
        .collect::<Vec<_>>();
    folders.sort();
    folders.dedup();
    store
        .set(
            gt_flow::FLOW_NAMESPACE,
            gt_flow::FLOW_FOLDERS_KEY,
            serde_json::json!(folders),
        )
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
pub(crate) fn flow_node_catalog(state: State<'_, AppState>) -> Vec<FlowNodeDefinition> {
    let registry = state.node_registry.lock().unwrap();
    registry.list()
}

#[tauri::command]
pub(crate) fn flow_nodes(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FlowNodeSpec>, String> {
    let record = {
        let store = state.store.lock().unwrap();
        let key = gt_flow::workflow_key(&id);
        store
            .get(gt_flow::FLOW_NAMESPACE, &key)
            .map(flow_record_from_store_value)
            .transpose()?
            .ok_or_else(|| format!("Flow 不存在: {id}"))?
    };
    let registry = state.node_registry.lock().unwrap();
    Ok(registry.compile_record(&record))
}

#[tauri::command]
pub(crate) fn flow_run(
    id: String,
    request: Option<FlowRunRequest>,
    state: State<'_, AppState>,
) -> Result<FlowRunReport, String> {
    let (record, workspace) = {
        let store = state.store.lock().unwrap();
        let key = gt_flow::workflow_key(&id);
        let record = store
            .get(gt_flow::FLOW_NAMESPACE, &key)
            .map(flow_record_from_store_value)
            .transpose()?
            .ok_or_else(|| format!("Flow 不存在: {id}"))?;
        let workspace = workspace_context_from_store(&store);
        (record, workspace)
    };
    let registry = state.node_registry.lock().unwrap();
    let mut executor = AppFlowActionExecutor::new(&state);
    let report = gt_flow::run_flow_with_executor(
        &record,
        request.unwrap_or(FlowRunRequest {
            intent: None,
            inputs: Value::Object(Default::default()),
        }),
        &registry,
        workspace,
        &mut executor,
    );
    drop(registry);

    let _ = publish_flow_event(
        &state,
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
    fn input_or_default_uses_fallback_when_missing_or_blank() {
        let mut inputs = BTreeMap::new();
        inputs.insert("k".to_string(), "  ".to_string());
        assert_eq!(input_or_default(&inputs, "k", "fallback"), "fallback");
        assert_eq!(input_or_default(&inputs, "missing", "fallback"), "fallback");
        inputs.insert("k".to_string(), "value".to_string());
        assert_eq!(input_or_default(&inputs, "k", "fallback"), "value");
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
