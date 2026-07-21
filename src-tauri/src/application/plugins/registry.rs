use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::State;

use gt_data::validate_namespace_name;
use gt_files::replace_tree;
use gt_flow::FlowNodeDefinition;
use gt_git::{
    commit_path_update, prepare_path_update, resolve_repo_root, verify_push_access, AuthMethod,
    CommitPathUpdateOptions, GitRepo, PreparePathUpdateOptions,
};

use crate::application::data::commands::{store_delete, store_get, store_set};
use crate::application::data::workspace::get_workspace_info;
use crate::application::files::commands::{files_list, files_read_text, files_scan, files_search};
use crate::application::flow::commands::flow_records_from_data;
use crate::application::git::auth::resolve_auth_for_remote;
use crate::application::git::identity::commit_identity_for_repo_remote;
use crate::application::git::remote::{add_remote, get_remote_configs, remote_url_for};
use crate::AppState;

const DEFAULT_API_VERSION: &str = "1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_publisher")]
    pub publisher: String,
    #[serde(default = "default_api_version")]
    pub api_version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub contributes: ExtensionContributions,
    #[serde(default)]
    pub backend: Option<ExtensionBackend>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub store_namespaces: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionContributions {
    #[serde(default)]
    pub views: Vec<ExtensionView>,
    #[serde(default)]
    pub flow_nodes: Vec<ExtensionFlowNode>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionView {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_view_location")]
    pub location: String,
    pub entry: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFlowNode {
    pub uses: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub summary: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
    #[serde(default)]
    pub outputs: BTreeMap<String, String>,
    pub method: String,
}

impl ExtensionFlowNode {
    fn definition(&self) -> FlowNodeDefinition {
        FlowNodeDefinition {
            uses: self.uses.clone(),
            name: self.name.clone(),
            node_type: self.node_type.clone(),
            summary: self.summary.clone(),
            description: self.description.clone(),
            inputs_schema: self.inputs.clone(),
            outputs_schema: self.outputs.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtensionBackend {
    #[serde(default = "default_backend_runtime")]
    pub runtime: String,
    pub entry: String,
    pub library: String,
    #[serde(default)]
    pub methods: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone)]
struct InstalledExtension {
    manifest: ExtensionManifest,
    root: PathBuf,
    generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BackendMethodSnapshot {
    generation: u64,
    version: String,
    path: PathBuf,
    permissions: Vec<String>,
}

#[derive(Debug, Clone)]
struct PathUpdateOperation {
    plugin_id: String,
    repository_path: PathBuf,
    branch: String,
    remote_name: String,
    pathspec: String,
    credential_ref: Option<String>,
    materialized: bool,
    created_at: Instant,
}

const PATH_UPDATE_OPERATION_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PluginFlowNodeBindingSnapshot {
    plugin_id: String,
    uses: String,
    method: String,
    backend: BackendMethodSnapshot,
}

#[derive(Clone, Default)]
pub struct ExtensionRegistry {
    installed: Arc<RwLock<BTreeMap<String, InstalledExtension>>>,
    lifecycle: Arc<Mutex<()>>,
    next_generation: Arc<AtomicU64>,
    path_update_operations: Arc<Mutex<BTreeMap<String, PathUpdateOperation>>>,
    next_path_update_operation: Arc<AtomicU64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionListItem {
    pub id: String,
    pub generation: u64,
    pub name: String,
    pub version: String,
    pub description: String,
    pub api_version: String,
    pub permissions: Vec<String>,
    pub backend: Option<ExtensionBackendInfo>,
    pub views: Vec<ExtensionViewContribution>,
    pub flow_nodes: Vec<FlowNodeDefinition>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionBackendInfo {
    pub runtime: String,
    pub entry: String,
    pub library: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionViewContribution {
    pub id: String,
    pub title: String,
    pub description: String,
    pub location: String,
    pub entry_url: String,
    pub icon_url: Option<String>,
}

impl ExtensionRegistry {
    pub fn discover(plugins_root: &Path) -> Self {
        let registry = Self::default();
        for path in installed_extension_paths(plugins_root) {
            if let Err(error) = registry.register_path(&path) {
                eprintln!("[extensions] ignore {}: {error}", path.display());
            }
        }
        registry
    }

    pub fn register_path(&self, root: &Path) -> Result<(), String> {
        let manifest_path = root.join("manifest.json");
        let raw = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("读取 manifest 失败: {error}"))?;
        let manifest: ExtensionManifest =
            serde_json::from_str(&raw).map_err(|error| format!("解析 manifest 失败: {error}"))?;
        validate_manifest(&manifest, root)?;
        validate_backend_exists(&manifest, root)?;
        let root = root
            .canonicalize()
            .map_err(|_| "插件目录不存在".to_string())?;
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        self.installed.write().unwrap().insert(
            manifest.id.clone(),
            InstalledExtension {
                manifest,
                root,
                generation,
            },
        );
        Ok(())
    }

    pub(crate) fn unregister(&self, plugin_id: &str) -> Option<PathBuf> {
        self.installed
            .write()
            .unwrap()
            .remove(plugin_id)
            .map(|extension| extension.root)
    }

    pub(crate) fn installed_version(&self, plugin_id: &str) -> Option<String> {
        self.installed
            .read()
            .unwrap()
            .get(plugin_id)
            .map(|extension| extension.manifest.version.clone())
    }

    pub(crate) fn installed_root(&self, plugin_id: &str) -> Option<PathBuf> {
        self.installed
            .read()
            .unwrap()
            .get(plugin_id)
            .map(|extension| extension.root.clone())
    }

    pub(crate) fn lifecycle_lock(&self) -> MutexGuard<'_, ()> {
        self.lifecycle.lock().unwrap()
    }

    pub(crate) fn contribute_active_flow_nodes(
        &self,
        registry: &mut gt_flow::FlowNodeRegistry,
    ) -> Result<(), String> {
        let installed = self.installed.read().unwrap();
        let mut candidate = registry.clone();
        for extension in installed.values() {
            candidate.replace_plugin_nodes(
                &extension.manifest.id,
                extension
                    .manifest
                    .contributes
                    .flow_nodes
                    .iter()
                    .map(ExtensionFlowNode::definition)
                    .collect(),
            )?;
        }
        *registry = candidate;
        Ok(())
    }

    pub(crate) fn flow_node_binding_snapshot(
        &self,
        plugin_id: &str,
        uses: &str,
    ) -> Result<PluginFlowNodeBindingSnapshot, String> {
        let (method, backend) = self.flow_node_backend_snapshot(plugin_id, uses)?;
        Ok(PluginFlowNodeBindingSnapshot {
            plugin_id: plugin_id.to_string(),
            uses: uses.to_string(),
            method,
            backend,
        })
    }

    pub(crate) fn invoke_flow_node(
        &self,
        plugin_host: &crate::application::plugins::host::PluginHostSupervisor,
        expected: &PluginFlowNodeBindingSnapshot,
        payload: Value,
    ) -> Result<Value, String> {
        let _lifecycle = self.lifecycle_lock();
        let current = self.flow_node_binding_snapshot(&expected.plugin_id, &expected.uses)?;
        if current != *expected {
            return Err("extension_changed_during_flow_node".to_string());
        }
        for permission in &current.backend.permissions {
            if !self.has_permission(&current.plugin_id, permission) {
                return Err("permission_denied".to_string());
            }
        }
        plugin_host.invoke_plugin(&current.backend.path, &current.method, payload)
    }

    pub fn list(&self) -> Vec<ExtensionListItem> {
        self.installed
            .read()
            .unwrap()
            .values()
            .map(|extension| extension_to_list_item(extension))
            .collect()
    }

    fn validate_generation(&self, plugin_id: &str, generation: u64) -> Result<(), String> {
        let installed = self.installed.read().unwrap();
        let extension = installed
            .get(plugin_id)
            .ok_or_else(|| "extension_not_found".to_string())?;
        if extension.generation != generation {
            return Err("extension_generation_mismatch".to_string());
        }
        Ok(())
    }

    fn has_permission(&self, plugin_id: &str, permission: &str) -> bool {
        self.installed
            .read()
            .unwrap()
            .get(plugin_id)
            .is_some_and(|extension| {
                extension
                    .manifest
                    .permissions
                    .iter()
                    .any(|item| item == permission)
            })
    }

    fn has_store_namespace(&self, plugin_id: &str, namespace: &str) -> bool {
        self.installed
            .read()
            .unwrap()
            .get(plugin_id)
            .is_some_and(|extension| {
                extension
                    .manifest
                    .store_namespaces
                    .iter()
                    .any(|declared| declared == namespace)
            })
    }

    fn begin_path_update(&self, operation: PathUpdateOperation) -> String {
        let id = format!(
            "path-update-{}",
            self.next_path_update_operation
                .fetch_add(1, Ordering::Relaxed)
                + 1
        );
        let mut operations = self.path_update_operations.lock().unwrap();
        operations.retain(|_, value| value.created_at.elapsed() < PATH_UPDATE_OPERATION_TTL);
        operations.insert(id.clone(), operation);
        id
    }

    fn path_update(
        &self,
        plugin_id: &str,
        operation_id: &str,
        require_materialized: bool,
    ) -> Result<PathUpdateOperation, String> {
        let mut operations = self.path_update_operations.lock().unwrap();
        let Some(operation) = operations.get(operation_id) else {
            return Err("path_update_operation_not_found".to_string());
        };
        if operation.created_at.elapsed() >= PATH_UPDATE_OPERATION_TTL {
            operations.remove(operation_id);
            return Err("path_update_operation_expired".to_string());
        }
        if operation.plugin_id != plugin_id || (require_materialized && !operation.materialized) {
            return Err("path_update_operation_denied".to_string());
        }
        Ok(operation.clone())
    }

    fn mark_path_update_materialized(&self, operation_id: &str) {
        if let Some(operation) = self
            .path_update_operations
            .lock()
            .unwrap()
            .get_mut(operation_id)
        {
            operation.materialized = true;
        }
    }

    fn finish_path_update(&self, operation_id: &str) {
        self.path_update_operations
            .lock()
            .unwrap()
            .remove(operation_id);
    }

    fn resolve_asset(&self, plugin_id: &str, relative: &str) -> Result<PathBuf, String> {
        let installed = self.installed.read().unwrap();
        let extension = installed
            .get(plugin_id)
            .ok_or_else(|| "插件不存在".to_string())?;
        safe_join(&extension.root, relative)
    }

    fn backend_method_snapshot(
        &self,
        plugin_id: &str,
        method: &str,
    ) -> Result<BackendMethodSnapshot, String> {
        let installed = self.installed.read().unwrap();
        let extension = installed
            .get(plugin_id)
            .ok_or_else(|| "extension_not_found".to_string())?;
        let backend = extension
            .manifest
            .backend
            .as_ref()
            .ok_or_else(|| "plugin_backend_missing".to_string())?;
        let permissions = backend
            .methods
            .get(method)
            .cloned()
            .ok_or_else(|| "backend_method_not_declared".to_string())?;
        let path = safe_join(
            &extension.root,
            &format!(
                "{}/{}",
                backend.entry.trim_end_matches('/'),
                native_library_name(&backend.library)
            ),
        )?;
        Ok(BackendMethodSnapshot {
            generation: extension.generation,
            version: extension.manifest.version.clone(),
            path,
            permissions,
        })
    }

    fn flow_node_backend_snapshot(
        &self,
        plugin_id: &str,
        uses: &str,
    ) -> Result<(String, BackendMethodSnapshot), String> {
        let method = {
            let installed = self.installed.read().unwrap();
            let extension = installed
                .get(plugin_id)
                .ok_or_else(|| "extension_not_found".to_string())?;
            extension
                .manifest
                .contributes
                .flow_nodes
                .iter()
                .find(|node| node.uses == uses)
                .map(|node| node.method.clone())
                .ok_or_else(|| "plugin_flow_node_not_found".to_string())?
        };
        let snapshot = self.backend_method_snapshot(plugin_id, &method)?;
        Ok((method, snapshot))
    }
}

pub fn asset_response(
    registry: &ExtensionRegistry,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let segments = request
        .uri()
        .path()
        .trim_start_matches('/')
        .splitn(2, '/')
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        return text_response(StatusCode::BAD_REQUEST, "invalid extension asset path");
    }
    let content_security_policy = if registry.has_permission(segments[0], "network:read") {
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self' data: https: http:; object-src 'self' data:; connect-src 'none'; frame-ancestors *"
    } else {
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; object-src 'self' data:; connect-src 'none'; frame-ancestors *"
    };
    let path = match registry.resolve_asset(segments[0], segments[1]) {
        Ok(path) => path,
        Err(error) => return text_response(StatusCode::NOT_FOUND, &error),
    };
    match fs::read(&path) {
        Ok(body) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type(&path))
            .header("Content-Security-Policy", content_security_policy)
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap(),
        Err(_) => text_response(StatusCode::NOT_FOUND, "extension asset not found"),
    }
}

#[tauri::command]
pub fn extension_list(state: State<'_, AppState>) -> Vec<ExtensionListItem> {
    state.extensions.list()
}

#[tauri::command]
pub async fn extension_call(
    plugin_id: String,
    generation: u64,
    method: String,
    payload: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .extensions
        .validate_generation(&plugin_id, generation)?;
    let payload = payload.unwrap_or(Value::Null);
    let backend_snapshot = if method == "backend.invoke" {
        let backend_method = payload
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| "invalid_backend_method".to_string())?;
        let snapshot = state
            .extensions
            .backend_method_snapshot(&plugin_id, backend_method)?;
        for permission in &snapshot.permissions {
            if !state.extensions.has_permission(&plugin_id, &permission) {
                return Err("permission_denied".to_string());
            }
        }
        Some(snapshot)
    } else {
        let required = required_permission(&method).ok_or_else(|| "unknown_method".to_string())?;
        if !state.extensions.has_permission(&plugin_id, required) {
            return Err("permission_denied".to_string());
        }
        None
    };
    if method == "backend.invoke" {
        let expected_snapshot =
            backend_snapshot.ok_or_else(|| "backend_method_snapshot_missing".to_string())?;
        let backend_method = payload
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| "invalid_backend_method".to_string())?
            .to_string();
        let backend_payload = enrich_backend_payload(
            &plugin_id,
            &backend_method,
            payload.get("payload").cloned().unwrap_or(Value::Null),
            &state,
        )?;
        let extensions = state.extensions.clone();
        let plugin_host = Arc::clone(&state.plugin_host);
        return tauri::async_runtime::spawn_blocking(move || {
            let _lifecycle = extensions.lifecycle_lock();
            extensions.validate_generation(&plugin_id, generation)?;
            let current_snapshot =
                extensions.backend_method_snapshot(&plugin_id, &backend_method)?;
            if current_snapshot != expected_snapshot {
                return Err("extension_changed_during_request".to_string());
            }
            plugin_host.invoke_plugin(&current_snapshot.path, &backend_method, backend_payload)
        })
        .await
        .map_err(|error| error.to_string())?;
    }

    let _lifecycle = state.extensions.lifecycle_lock();
    state
        .extensions
        .validate_generation(&plugin_id, generation)?;
    match method.as_str() {
        "repositories.active" | "git.overview" => {
            let lock = state.repo.lock().unwrap();
            let repo = lock
                .as_ref()
                .ok_or_else(|| "repository_not_open".to_string())?;
            let overview = repo
                .overview()
                .map_err(|_| "git_overview_failed".to_string())?;
            let display_name = overview
                .path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("repository");
            Ok(json!({
                "repositoryId": "active",
                "displayName": display_name,
                "currentBranch": overview.current_branch,
                "isDirty": overview.is_dirty,
                "changedCount": overview.changed_count,
                "hasRemote": overview.remote_url.is_some(),
            }))
        }
        "git.log" => {
            let limit = payload
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .clamp(1, 100) as usize;
            let lock = state.repo.lock().unwrap();
            let repo = lock
                .as_ref()
                .ok_or_else(|| "repository_not_open".to_string())?;
            serde_json::to_value(repo.log(limit).map_err(|_| "git_log_failed".to_string())?)
                .map_err(|_| "serialization_failed".to_string())
        }
        "flow.list" => {
            let store = state.data.lock().unwrap();
            let flows = flow_records_from_data(&store)?
                .into_iter()
                .map(|record| {
                    json!({
                        "id": record.summary.id,
                        "name": record.summary.name,
                        "enabled": record.enabled,
                    })
                })
                .collect::<Vec<_>>();
            Ok(Value::Array(flows))
        }
        "store.get" => {
            let namespace = extension_store_namespace(&state.extensions, &plugin_id, &payload)?;
            let key = payload_field::<String>(&payload, "key")?;
            if is_private_plugin_namespace(&plugin_id, &namespace) {
                let data = state.data.lock().unwrap();
                Ok(data
                    .plugin_data(&plugin_id)
                    .map_err(|error| error.to_string())?
                    .get(&namespace, &key)
                    .map_err(|error| error.to_string())?
                    .unwrap_or(Value::Null))
            } else {
                Ok(store_get(namespace, key, state.clone())?.unwrap_or(Value::Null))
            }
        }
        "store.set" => {
            let namespace = extension_store_namespace(&state.extensions, &plugin_id, &payload)?;
            let key = payload_field::<String>(&payload, "key")?;
            let value = payload
                .get("value")
                .cloned()
                .ok_or_else(|| "missing_payload_field:value".to_string())?;
            if is_private_plugin_namespace(&plugin_id, &namespace) {
                let mut data = state.data.lock().unwrap();
                data.plugin_data_mut(&plugin_id)
                    .map_err(|error| error.to_string())?
                    .set(&namespace, &key, value)
                    .map_err(|error| error.to_string())?;
            } else {
                store_set(namespace, key, value, state.clone())?;
            }
            Ok(Value::Null)
        }
        "store.delete" => {
            let namespace = extension_store_namespace(&state.extensions, &plugin_id, &payload)?;
            let key = payload_field::<String>(&payload, "key")?;
            if is_private_plugin_namespace(&plugin_id, &namespace) {
                let mut data = state.data.lock().unwrap();
                data.plugin_data_mut(&plugin_id)
                    .map_err(|error| error.to_string())?
                    .delete(&namespace, &key)
                    .map_err(|error| error.to_string())?;
            } else {
                store_delete(namespace, key, state.clone())?;
            }
            Ok(Value::Null)
        }
        "files.list" => {
            let root = extension_file_root(&state, &payload)?;
            let relative_dir = payload_optional_field(&payload, "relativeDir")?;
            let options = payload_optional_field(&payload, "options")?;
            serialize_value(files_list(root, relative_dir, options)?)
        }
        "files.scan" => {
            let root = extension_file_root(&state, &payload)?;
            let relative_dir = payload_optional_field(&payload, "relativeDir")?;
            let options = payload_optional_field(&payload, "options")?;
            serialize_value(files_scan(root, relative_dir, options)?)
        }
        "files.search" => {
            let root = extension_file_root(&state, &payload)?;
            let relative_dir = payload_optional_field(&payload, "relativeDir")?;
            let query = payload_field::<String>(&payload, "query")?;
            let options = payload_optional_field(&payload, "options")?;
            serialize_value(files_search(root, relative_dir, query, options)?)
        }
        "files.readText" => {
            let root = extension_file_root(&state, &payload)?;
            let path = payload_field::<String>(&payload, "path")?;
            let max_bytes = payload_optional_field(&payload, "maxBytes")?;
            serialize_value(files_read_text(root, path, max_bytes)?)
        }
        "files.replaceTree" => {
            if !state.extensions.has_permission(&plugin_id, "git:write") {
                return Err("permission_denied".to_string());
            }
            let operation_id = payload_field::<String>(&payload, "operationId")?;
            let operation = state
                .extensions
                .path_update(&plugin_id, &operation_id, false)?;
            let source = extension_source_directory(&state, &payload)?;
            let report = replace_tree(source, &operation.repository_path, &operation.pathspec)
                .map_err(|error| error.to_string())?;
            state
                .extensions
                .mark_path_update_materialized(&operation_id);
            serialize_value(report)
        }
        "git.pathUpdate.prepare" => extension_prepare_path_update(&state, &plugin_id, &payload),
        "git.pathUpdate.commit" => extension_commit_path_update(&state, &plugin_id, &payload),
        "repositories.configs" => serialize_value(get_remote_configs(state.clone())?),
        "repositories.addRemote" => {
            let name = payload_field::<String>(&payload, "name")?;
            let url = payload_field::<String>(&payload, "url")?;
            let token = payload_optional_field::<String>(&payload, "token")?;
            let commit_name = payload_optional_field::<String>(&payload, "commitName")?;
            let commit_email = payload_optional_field::<String>(&payload, "commitEmail")?;
            add_remote(name, url, token, commit_name, commit_email, state.clone())?;
            Ok(Value::Null)
        }
        "workspace.info" => serialize_value(get_workspace_info(state.clone())),
        "shell.openPath" => {
            let path = payload_field::<String>(&payload, "path")?;
            tauri_plugin_opener::open_path(path, None::<&str>)
                .map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        "shell.revealPath" => {
            let path = payload_field::<String>(&payload, "path")?;
            tauri_plugin_opener::reveal_item_in_dir(path).map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        "shell.openUrl" => {
            let url = payload_field::<String>(&payload, "url")?;
            tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        "backend.invoke" => unreachable!("backend.invoke returns before synchronous dispatch"),
        _ => Err("unknown_method".to_string()),
    }
}

fn extension_to_list_item(extension: &InstalledExtension) -> ExtensionListItem {
    let base = format!("gt-plugin://localhost/{}/", extension.manifest.id);
    ExtensionListItem {
        id: extension.manifest.id.clone(),
        generation: extension.generation,
        name: extension.manifest.name.clone(),
        version: extension.manifest.version.clone(),
        description: extension.manifest.description.clone(),
        api_version: extension.manifest.api_version.clone(),
        permissions: extension.manifest.permissions.clone(),
        backend: extension
            .manifest
            .backend
            .as_ref()
            .map(|backend| ExtensionBackendInfo {
                runtime: backend.runtime.clone(),
                entry: backend.entry.clone(),
                library: backend.library.clone(),
            }),
        views: extension
            .manifest
            .contributes
            .views
            .iter()
            .map(|view| {
                let icon = view.icon.as_ref().or(extension.manifest.icon.as_ref());
                ExtensionViewContribution {
                    id: view.id.clone(),
                    title: view.title.clone(),
                    description: view.description.clone(),
                    location: view.location.clone(),
                    entry_url: format!("{base}{}", view.entry),
                    icon_url: icon.map(|icon| extension_icon_value(&base, icon)),
                }
            })
            .collect(),
        flow_nodes: extension
            .manifest
            .contributes
            .flow_nodes
            .iter()
            .map(ExtensionFlowNode::definition)
            .collect(),
    }
}

pub(crate) fn validate_manifest(manifest: &ExtensionManifest, root: &Path) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err("仅支持 schemaVersion=1".to_string());
    }
    if manifest.api_version != DEFAULT_API_VERSION {
        return Err("插件 API 版本不兼容".to_string());
    }
    if !valid_extension_id(&manifest.id) {
        return Err("插件 id 格式无效".to_string());
    }
    if !valid_version_segment(&manifest.version) {
        return Err("插件 version 格式无效".to_string());
    }
    if manifest.contributes.views.is_empty() && manifest.contributes.flow_nodes.is_empty() {
        return Err("插件至少需要贡献一个 view 或 flowNode".to_string());
    }
    if let Some(icon) = &manifest.icon {
        validate_lucide_icon(icon)?;
    }
    let allowed_permissions = [
        "repository:read",
        "git:read",
        "git:credential",
        "flow:read",
        "files:read",
        "files:write",
        "git:write",
        "store:read",
        "store:write",
        "shell:open",
        "network:read",
        "network:write",
    ];
    if manifest
        .permissions
        .iter()
        .any(|permission| !allowed_permissions.contains(&permission.as_str()))
    {
        return Err("插件声明了不支持的权限".to_string());
    }
    if manifest
        .store_namespaces
        .iter()
        .any(|namespace| !matches!(namespace.as_str(), "sites"))
    {
        return Err("插件声明了不安全的存储命名空间".to_string());
    }
    let mut view_ids = BTreeSet::new();
    for view in &manifest.contributes.views {
        if view.id.trim().is_empty() || !view_ids.insert(view.id.as_str()) {
            return Err("插件 view id 为空或重复".to_string());
        }
        safe_join(root, &view.entry)?;
        if let Some(icon) = &view.icon {
            if icon.starts_with("lucide:") {
                validate_lucide_icon(icon)?;
            } else {
                safe_join(root, icon)?;
            }
        }
    }
    let backend = manifest.backend.as_ref();
    let mut flow_node_uses = BTreeSet::new();
    for node in &manifest.contributes.flow_nodes {
        if node.uses.trim().is_empty()
            || !node.uses.starts_with(&format!("{}/", manifest.id))
            || !flow_node_uses.insert(node.uses.as_str())
            || node.name.trim().is_empty()
            || node.node_type.trim().is_empty()
            || node.summary.trim().is_empty()
            || node.method.trim().is_empty()
        {
            return Err("插件 flowNode 定义无效".to_string());
        }
        let method_declared = backend
            .and_then(|backend| backend.methods.get(&node.method))
            .is_some();
        if !method_declared {
            return Err("插件 flowNode method 未在 backend.methods 声明".to_string());
        }
    }
    if let Some(backend) = &manifest.backend {
        validate_relative_path(&backend.entry)?;
        if !valid_library_name(&backend.library) {
            return Err("插件后台 library 格式无效".to_string());
        }
        for (method, permissions) in &backend.methods {
            if method.trim().is_empty()
                || permissions.iter().any(|permission| {
                    !manifest.permissions.contains(permission)
                        || !allowed_permissions.contains(&permission.as_str())
                })
            {
                return Err("插件后台方法权限声明无效".to_string());
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_backend_exists(
    manifest: &ExtensionManifest,
    root: &Path,
) -> Result<(), String> {
    if let Some(backend) = &manifest.backend {
        if backend.runtime != "rust-cdylib" {
            return Err("unsupported_backend_runtime".to_string());
        }
        safe_join(root, &backend_library_relative_path(backend))?;
    }
    Ok(())
}

pub(crate) fn read_manifest(root: &Path) -> Result<ExtensionManifest, String> {
    let raw = fs::read_to_string(root.join("manifest.json"))
        .map_err(|error| format!("读取 manifest 失败: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("解析 manifest 失败: {error}"))
}

pub(crate) fn backend_library_relative_path(backend: &ExtensionBackend) -> String {
    format!(
        "{}/{}",
        backend.entry.trim_end_matches('/'),
        native_library_name(&backend.library)
    )
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative_path(relative)?;
    let relative_path = Path::new(relative);
    let root = root
        .canonicalize()
        .map_err(|_| "插件目录不存在".to_string())?;
    let target = root.join(relative_path);
    let target = target
        .canonicalize()
        .map_err(|_| "插件资源不存在".to_string())?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("插件资源路径越界".to_string());
    }
    Ok(target)
}

fn validate_relative_path(relative: &str) -> Result<(), String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("插件资源路径越界".to_string());
    }
    Ok(())
}

fn installed_extension_paths(plugins_root: &Path) -> Vec<PathBuf> {
    let Ok(plugin_directories) = fs::read_dir(plugins_root) else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    for plugin_directory in plugin_directories.flatten() {
        let plugin_path = plugin_directory.path();
        if !plugin_path.is_dir()
            || plugin_directory
                .file_name()
                .to_string_lossy()
                .starts_with('.')
        {
            continue;
        }
        let Ok(version_directories) = fs::read_dir(plugin_path) else {
            continue;
        };
        for version_directory in version_directories.flatten() {
            let version_path = version_directory.path();
            if version_path.is_dir() && version_path.join("manifest.json").is_file() {
                paths.push(version_path);
            }
        }
    }
    paths.sort();
    paths
}

fn required_permission(method: &str) -> Option<&'static str> {
    match method {
        "repositories.active" | "repositories.configs" | "workspace.info" => {
            Some("repository:read")
        }
        "git.overview" | "git.log" => Some("git:read"),
        "flow.list" => Some("flow:read"),
        "files.list" | "files.scan" | "files.search" | "files.readText" => Some("files:read"),
        "files.replaceTree" => Some("files:write"),
        "git.pathUpdate.prepare" | "git.pathUpdate.commit" | "repositories.addRemote" => {
            Some("git:write")
        }
        "store.get" => Some("store:read"),
        "store.set" | "store.delete" => Some("store:write"),
        "shell.openPath" | "shell.revealPath" | "shell.openUrl" => Some("shell:open"),
        _ => None,
    }
}

fn payload_field<T: DeserializeOwned>(payload: &Value, field: &str) -> Result<T, String> {
    let value = payload
        .get(field)
        .cloned()
        .ok_or_else(|| format!("missing_payload_field:{field}"))?;
    serde_json::from_value(value).map_err(|error| format!("invalid_payload_field:{field}:{error}"))
}

fn payload_optional_field<T: DeserializeOwned>(
    payload: &Value,
    field: &str,
) -> Result<Option<T>, String> {
    payload
        .get(field)
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("invalid_payload_field:{field}:{error}"))
}

fn serialize_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| format!("serialization_failed:{error}"))
}

fn extension_git_operation_context(
    state: &AppState,
    repository_path: &Path,
    branch: &str,
    remote_name: &str,
    credential_ref: Option<&str>,
) -> Result<
    (
        PathBuf,
        String,
        String,
        crate::application::git::auth::ResolvedAuth,
    ),
    String,
> {
    let target_root = resolve_repo_root(&repository_path).map_err(|error| error.to_string())?;
    let target_repo = GitRepo::open(&target_root).map_err(|error| error.to_string())?;
    let remote_url = remote_url_for(&target_repo, remote_name)?;
    let auth = resolve_auth_for_remote(state, &target_root, Some(&remote_url), credential_ref);
    Ok((
        target_root,
        branch.to_string(),
        remote_name.to_string(),
        auth,
    ))
}

fn extension_prepare_path_update(
    state: &AppState,
    plugin_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let repository_path = payload_field::<String>(payload, "repositoryPath")?;
    let branch = payload_field::<String>(payload, "branch")?;
    let remote_name = payload_field::<String>(payload, "remoteName")?;
    let pathspec = payload_field::<String>(payload, "pathspec")?;
    let credential_ref = payload_optional_field::<String>(payload, "credentialRef")?;
    let (target_root, branch, remote_name, auth) = extension_git_operation_context(
        state,
        Path::new(&repository_path),
        &branch,
        &remote_name,
        credential_ref.as_deref(),
    )?;
    authorize_path_update_repository(state, &target_root)?;
    prepare_path_update(PreparePathUpdateOptions {
        target_local_path: target_root.clone(),
        branch: branch.clone(),
        remote_name: remote_name.clone(),
        allowed_dirty_pathspec: Some(pathspec.clone()),
        auth: auth.method.clone(),
    })
    .map_err(|error| error.to_string())?;
    verify_push_access(&target_root, &remote_name, &branch, &auth.method)
        .map_err(|error| error.to_string())?;
    let operation_id = state.extensions.begin_path_update(PathUpdateOperation {
        plugin_id: plugin_id.to_string(),
        repository_path: target_root.clone(),
        branch: branch.clone(),
        remote_name: remote_name.clone(),
        pathspec: pathspec.clone(),
        credential_ref: credential_ref.clone(),
        materialized: false,
        created_at: Instant::now(),
    });
    Ok(json!({
        "operationId": operation_id,
        "repositoryPath": target_root,
        "branch": branch,
        "remoteName": remote_name,
        "pathspec": pathspec,
        "credentialMode": auth.mode,
        "credentialRef": auth.credential_ref,
    }))
}

fn extension_commit_path_update(
    state: &AppState,
    plugin_id: &str,
    payload: &Value,
) -> Result<Value, String> {
    let operation_id = payload_field::<String>(payload, "operationId")?;
    let commit_message = payload_field::<String>(payload, "commitMessage")?;
    let operation = state
        .extensions
        .path_update(plugin_id, &operation_id, true)?;
    let (target_root, branch, remote_name, auth) = extension_git_operation_context(
        state,
        &operation.repository_path,
        &operation.branch,
        &operation.remote_name,
        operation.credential_ref.as_deref(),
    )?;
    let commit_identity =
        commit_identity_for_repo_remote(state, &target_root.to_string_lossy(), Some(&remote_name));
    let report = commit_path_update(CommitPathUpdateOptions {
        target_local_path: target_root,
        branch,
        remote_name,
        pathspec: operation.pathspec,
        commit_message,
        commit_identity,
        auth: auth.method,
    })
    .map_err(|error| error.to_string())?;
    state.extensions.finish_path_update(&operation_id);
    let mut value = serde_json::to_value(report).map_err(|error| error.to_string())?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "serialization_failed".to_string())?;
    object.insert("credentialMode".to_string(), Value::String(auth.mode));
    object.insert(
        "credentialRef".to_string(),
        auth.credential_ref
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    Ok(value)
}

fn authorize_path_update_repository(state: &AppState, repository: &Path) -> Result<(), String> {
    let store = state.data.lock().unwrap();
    let workspace = store.workspace().snapshot();
    let allowed = workspace
        .active_repo
        .into_iter()
        .chain(workspace.recent_repos)
        .chain(workspace.bound_repos)
        .filter_map(|path| PathBuf::from(path).canonicalize().ok())
        .any(|known| known == repository);
    if allowed {
        Ok(())
    } else {
        Err("git_repository_denied".to_string())
    }
}

fn extension_store_namespace(
    registry: &ExtensionRegistry,
    plugin_id: &str,
    payload: &Value,
) -> Result<String, String> {
    let requested = payload_field::<String>(payload, "namespace")?;
    validate_namespace_name(&requested).map_err(|_| "store_namespace_denied".to_string())?;
    if registry.has_store_namespace(plugin_id, &requested) {
        return Ok(requested);
    }
    let scoped = format!("plugin.{plugin_id}");
    if requested == scoped || requested.starts_with(&format!("{scoped}.")) {
        return Ok(requested);
    }
    Err("store_namespace_denied".to_string())
}

fn enrich_backend_payload(
    plugin_id: &str,
    method: &str,
    mut payload: Value,
    state: &AppState,
) -> Result<Value, String> {
    if plugin_id != "dev.gittributary.attachment-manager"
        || !matches!(
            method,
            "attachments.checkGithubImageConfig" | "attachments.migrateGithubImages"
        )
    {
        return Ok(payload);
    }

    let config = payload
        .get_mut("config")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "github_image_config_missing".to_string())?;
    let remote = config
        .get("remote")
        .and_then(Value::as_object)
        .ok_or_else(|| "github_remote_binding_missing".to_string())?;
    let repo_path = remote
        .get("repoPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "github_remote_repo_path_missing".to_string())?;
    let remote_name = remote
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "github_remote_name_missing".to_string())?;
    let requested_url = remote
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "github_remote_url_missing".to_string())?;

    let repo = GitRepo::open(repo_path).map_err(|_| "github_remote_repo_missing".to_string())?;
    let configured_url = remote_url_for(&repo, remote_name)
        .map_err(|_| "github_remote_binding_stale".to_string())?;
    if configured_url.trim() != requested_url {
        return Err("github_remote_binding_stale".to_string());
    }
    let (owner, repository) = github_repository_parts(&configured_url)?;
    let resolved =
        resolve_auth_for_remote(state, Path::new(repo_path), Some(&configured_url), None);
    let token = match resolved.method {
        AuthMethod::Token(token) if !token.trim().is_empty() => token,
        _ => return Err("github_remote_token_unavailable".to_string()),
    };

    config.insert("owner".to_string(), Value::String(owner));
    config.insert("repository".to_string(), Value::String(repository));
    config.insert("token".to_string(), Value::String(token));
    Ok(payload)
}

fn github_repository_parts(remote_url: &str) -> Result<(String, String), String> {
    let trimmed = remote_url.trim().trim_end_matches('/');
    let prefix = "https://github.com/";
    if !trimmed.to_ascii_lowercase().starts_with(prefix) {
        return Err("github_remote_url_unsupported".to_string());
    }
    let path = &trimmed[prefix.len()..];
    if path.contains('?') || path.contains('#') {
        return Err("github_remote_url_unsupported".to_string());
    }
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err("github_remote_url_unsupported".to_string());
    }
    let owner = parts[0].trim();
    let repository = parts[1].trim().trim_end_matches(".git");
    if owner.is_empty() || repository.is_empty() {
        return Err("github_remote_url_unsupported".to_string());
    }
    Ok((owner.to_string(), repository.to_string()))
}

fn is_private_plugin_namespace(plugin_id: &str, namespace: &str) -> bool {
    let scoped = format!("plugin.{plugin_id}");
    namespace == scoped || namespace.starts_with(&format!("{scoped}."))
}

fn extension_source_directory(state: &AppState, payload: &Value) -> Result<PathBuf, String> {
    let requested = payload_field::<String>(payload, "sourceRoot")?;
    let requested = PathBuf::from(requested)
        .canonicalize()
        .map_err(|_| "file_root_missing".to_string())?;
    if !requested.is_dir() {
        return Err("file_root_not_directory".to_string());
    }
    let store = state.data.lock().unwrap();
    let workspace = store.workspace().snapshot();
    let allowed = workspace
        .active_repo
        .into_iter()
        .chain(workspace.recent_repos)
        .filter_map(|path| PathBuf::from(path).canonicalize().ok())
        .any(|root| requested.starts_with(root));
    if !allowed {
        return Err("file_root_denied".to_string());
    }
    Ok(requested)
}

fn extension_file_root(state: &AppState, payload: &Value) -> Result<String, String> {
    let requested = payload_field::<String>(payload, "root")?;
    let requested = PathBuf::from(&requested)
        .canonicalize()
        .map_err(|_| "file_root_missing".to_string())?;
    if !requested.is_dir() {
        return Err("file_root_not_directory".to_string());
    }

    let mut known_roots = {
        let store = state.data.lock().unwrap();
        let workspace = store.workspace().snapshot();
        let mut roots = workspace.recent_repos;
        if let Some(active) = workspace.active_repo {
            roots.push(active);
        }
        roots
    };
    if let Some(workdir) = state
        .repo
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|repo| repo.workdir())
    {
        known_roots.push(workdir.to_string_lossy().to_string());
    }

    let allowed = known_roots.into_iter().any(|root| {
        PathBuf::from(root)
            .canonicalize()
            .is_ok_and(|root| root == requested)
    });
    if !allowed {
        return Err("file_root_not_authorized".to_string());
    }
    Ok(requested.to_string_lossy().to_string())
}

fn valid_extension_id(value: &str) -> bool {
    !value.is_empty()
        && value.contains('.')
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
        })
}

fn validate_lucide_icon(value: &str) -> Result<(), String> {
    let Some(name) = value.strip_prefix("lucide:") else {
        return Err("插件 icon 必须使用 lucide:<name>".to_string());
    };
    if name.is_empty()
        || name.len() > 64
        || name.starts_with('-')
        || name.ends_with('-')
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("插件 Lucide icon 格式无效".to_string());
    }
    Ok(())
}

fn extension_icon_value(base: &str, icon: &str) -> String {
    if icon.starts_with("lucide:") {
        icon.to_string()
    } else {
        format!("{base}{icon}")
    }
}

fn valid_version_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-'
        })
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

fn default_api_version() -> String {
    DEFAULT_API_VERSION.to_string()
}

fn default_publisher() -> String {
    "GitTributary".to_string()
}

fn default_view_location() -> String {
    "activitybar".to_string()
}

fn default_backend_runtime() -> String {
    "wasi-component".to_string()
}

fn valid_library_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn native_library_name(library: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{library}.dll")
    } else if cfg!(target_os = "macos") {
        format!("lib{library}.dylib")
    } else {
        format!("lib{library}.so")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::io::Write;
    use std::process::Command;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HostApiContract {
        api_version: u32,
        methods: Vec<HostMethodContract>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HostMethodContract {
        method: String,
        permission: Option<String>,
        permission_source: Option<String>,
        cases: Vec<HostMethodCase>,
    }

    #[derive(Deserialize)]
    struct HostMethodCase {
        id: String,
        kind: String,
    }

    fn run_git(directory: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(directory)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn validates_extension_ids() {
        assert!(valid_extension_id("com.example.insights"));
        assert!(!valid_extension_id("Insights"));
        assert!(!valid_extension_id("insights"));
    }

    #[test]
    fn validates_version_directory_segments() {
        assert!(valid_version_segment("1.2.3-beta_1"));
        assert!(!valid_version_segment(""));
        assert!(!valid_version_segment(".."));
        assert!(!valid_version_segment("1/../../escape"));
    }

    #[test]
    fn maps_permissions_to_methods() {
        assert_eq!(required_permission("git.log"), Some("git:read"));
        assert_eq!(required_permission("store.set"), Some("store:write"));
        assert_eq!(required_permission("files.search"), Some("files:read"));
        assert_eq!(
            required_permission("files.replaceTree"),
            Some("files:write")
        );
        assert_eq!(
            required_permission("git.pathUpdate.commit"),
            Some("git:write")
        );
        assert_eq!(
            required_permission("repositories.addRemote"),
            Some("git:write")
        );
        assert_eq!(required_permission("shell.openPath"), Some("shell:open"));
        assert_eq!(required_permission("flow.run"), None);
    }

    #[test]
    fn public_host_methods_match_the_plugin_testkit_contract() {
        let contract: HostApiContract = serde_json::from_str(include_str!(
            "../../../../packages/plugin-testkit/src/host-methods.v1.json"
        ))
        .unwrap();
        assert_eq!(contract.api_version, 1);

        let expected = BTreeSet::from([
            "backend.invoke",
            "files.list",
            "files.readText",
            "files.replaceTree",
            "files.scan",
            "files.search",
            "flow.list",
            "git.log",
            "git.overview",
            "git.pathUpdate.commit",
            "git.pathUpdate.prepare",
            "repositories.active",
            "repositories.addRemote",
            "repositories.configs",
            "shell.openPath",
            "shell.openUrl",
            "shell.revealPath",
            "store.delete",
            "store.get",
            "store.set",
            "workspace.info",
        ]);
        let actual = contract
            .methods
            .iter()
            .map(|item| item.method.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(actual, expected);

        let mut case_ids = HashSet::new();
        for method in contract.methods {
            assert!(
                method.cases.iter().any(|case| case.kind == "success"),
                "{} must publish a canonical success case",
                method.method
            );
            for case in method.cases {
                assert!(case_ids.insert(case.id), "host case ids must be unique");
            }
            if method.method == "backend.invoke" {
                assert_eq!(method.permission, None);
                assert_eq!(method.permission_source.as_deref(), Some("backend.methods"));
            } else {
                assert_eq!(
                    required_permission(&method.method).map(str::to_owned),
                    method.permission,
                    "permission drift for {}",
                    method.method
                );
            }
        }
    }

    #[test]
    fn validates_network_write_for_backend_methods() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("web")).unwrap();
        fs::write(directory.path().join("web/index.html"), "upload").unwrap();
        let manifest = |permissions: Value| -> ExtensionManifest {
            serde_json::from_value(json!({
                "schemaVersion": 1,
                "apiVersion": "1",
                "id": "com.example.uploader",
                "name": "Uploader",
                "version": "1.0.0",
                "contributes": {
                    "views": [{ "id": "main", "title": "Upload", "entry": "web/index.html" }]
                },
                "backend": {
                    "runtime": "rust-cdylib",
                    "entry": "backend",
                    "library": "uploader",
                    "methods": { "images.upload": ["network:write"] }
                },
                "permissions": permissions
            }))
            .unwrap()
        };

        assert!(validate_manifest(&manifest(json!(["network:write"])), directory.path()).is_ok());
        assert!(validate_manifest(&manifest(json!([])), directory.path()).is_err());
    }

    #[test]
    fn parses_supported_github_remote_urls() {
        assert_eq!(
            github_repository_parts("https://github.com/octocat/images.git").unwrap(),
            ("octocat".to_string(), "images".to_string())
        );
        assert_eq!(
            github_repository_parts("HTTPS://GITHUB.COM/Team/image-cloud/").unwrap(),
            ("Team".to_string(), "image-cloud".to_string())
        );
        assert!(github_repository_parts("git@github.com:octocat/images.git").is_err());
        assert!(github_repository_parts("https://github.com/octocat/images/tree/main").is_err());
    }

    #[test]
    fn injects_git_remote_token_only_for_the_attachment_backend() {
        let store_directory = tempfile::tempdir().unwrap();
        let repository = tempfile::tempdir().unwrap();
        let repo = GitRepo::init(repository.path()).unwrap();
        repo.add_remote("image-cloud", "https://github.com/octocat/images.git")
            .unwrap();
        let repo_path = repo.workdir().unwrap().to_string_lossy().to_string();
        let mut data = gt_data::DataHub::open(store_directory.path()).unwrap();
        data.credentials_mut()
            .set_project_token(&repo_path, "project-token")
            .unwrap();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            data: std::sync::Mutex::new(data),
            event_pool: std::sync::Mutex::new(gt_flow::EventPool::new()),
            node_registry: std::sync::Mutex::new(gt_flow::FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(
                crate::application::plugins::host::PluginHostSupervisor::default(),
            ),
        };
        let payload = json!({
            "config": {
                "remote": {
                    "repoPath": repo_path,
                    "name": "image-cloud",
                    "url": "https://github.com/octocat/images.git"
                },
                "branch": "main",
                "directory": "images"
            }
        });

        let enriched = enrich_backend_payload(
            "dev.gittributary.attachment-manager",
            "attachments.migrateGithubImages",
            payload,
            &state,
        )
        .unwrap();

        assert_eq!(enriched["config"]["owner"], "octocat");
        assert_eq!(enriched["config"]["repository"], "images");
        assert_eq!(enriched["config"]["token"], "project-token");
    }

    #[test]
    fn scopes_extension_store_namespaces() {
        let registry = ExtensionRegistry::default();
        let manifest: ExtensionManifest = serde_json::from_value(json!({
            "schemaVersion": 1,
            "id": "dev.gittributary.site-publisher",
            "name": "Site",
            "version": "1.0.0",
            "storeNamespaces": ["sites"]
        }))
        .unwrap();
        registry.installed.write().unwrap().insert(
            manifest.id.clone(),
            InstalledExtension {
                manifest,
                root: PathBuf::new(),
                generation: 1,
            },
        );
        let site_payload = json!({ "namespace": "sites" });
        assert_eq!(
            extension_store_namespace(&registry, "dev.gittributary.site-publisher", &site_payload)
                .unwrap(),
            "sites"
        );

        let scoped_payload = json!({ "namespace": "plugin.com.example.demo.settings" });
        assert_eq!(
            extension_store_namespace(&registry, "com.example.demo", &scoped_payload).unwrap(),
            "plugin.com.example.demo.settings"
        );
        assert!(extension_store_namespace(
            &registry,
            "com.example.demo",
            &json!({ "namespace": "sites" })
        )
        .is_err());
        assert!(extension_store_namespace(
            &registry,
            "com.example.demo",
            &json!({ "namespace": "plugin.com.example.demo.x/../../escape" })
        )
        .is_err());
    }

    #[test]
    fn authorizes_only_known_file_roots() {
        let store_directory = tempfile::tempdir().unwrap();
        let repository = tempfile::tempdir().unwrap();
        let unknown = tempfile::tempdir().unwrap();
        let mut data = gt_data::DataHub::open(store_directory.path()).unwrap();
        data.workspace_mut().initialize().unwrap();
        let repository_path = repository.path().to_string_lossy().to_string();
        data.workspace_mut()
            .sync(Some(&repository_path), Some("main"))
            .unwrap();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            data: std::sync::Mutex::new(data),
            event_pool: std::sync::Mutex::new(gt_flow::EventPool::new()),
            node_registry: std::sync::Mutex::new(gt_flow::FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(
                crate::application::plugins::host::PluginHostSupervisor::default(),
            ),
        };

        let authorized = extension_file_root(&state, &json!({ "root": repository_path })).unwrap();
        assert_eq!(
            PathBuf::from(authorized),
            repository.path().canonicalize().unwrap()
        );
        assert!(
            extension_file_root(&state, &json!({ "root": unknown.path().to_string_lossy() }))
                .is_err()
        );
    }

    #[test]
    fn host_capabilities_replace_commit_and_push_a_path() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        let remote = temp.path().join("remote.git");
        let store_directory = temp.path().join("store");
        fs::create_dir_all(source.join("artifact")).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("artifact/index.html"), "<h1>Hello</h1>").unwrap();
        run_git(temp.path(), &["init", "--bare", remote.to_str().unwrap()]);
        run_git(&target, &["init", "-b", "main"]);
        fs::write(target.join("README.md"), "seed").unwrap();
        run_git(&target, &["add", "README.md"]);
        run_git(
            &target,
            &[
                "-c",
                "user.name=GitTributary Test",
                "-c",
                "user.email=test@local",
                "commit",
                "-m",
                "seed",
            ],
        );
        run_git(
            &target,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        run_git(&target, &["push", "-u", "origin", "main"]);

        let mut data = gt_data::DataHub::open(&store_directory).unwrap();
        data.workspace_mut().initialize().unwrap();
        data.workspace_mut()
            .sync(Some(&source.to_string_lossy()), Some("main"))
            .unwrap();
        data.workspace_mut()
            .bind_repo(&target.to_string_lossy())
            .unwrap();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            data: std::sync::Mutex::new(data),
            event_pool: std::sync::Mutex::new(gt_flow::EventPool::new()),
            node_registry: std::sync::Mutex::new(gt_flow::FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(
                crate::application::plugins::host::PluginHostSupervisor::default(),
            ),
        };
        let operation = json!({
            "repositoryPath": target,
            "branch": "main",
            "remoteName": "origin",
            "pathspec": "docs"
        });
        let prepared = extension_prepare_path_update(&state, "test.plugin", &operation).unwrap();
        let operation_id = prepared["operationId"].as_str().unwrap();
        assert!(extension_commit_path_update(
            &state,
            "test.plugin",
            &json!({
                "operationId": operation_id,
                "commitMessage": "must materialize first"
            })
        )
        .is_err());
        let bound = state
            .extensions
            .path_update("test.plugin", operation_id, false)
            .unwrap();
        let source_root =
            extension_source_directory(&state, &json!({ "sourceRoot": source.join("artifact") }))
                .unwrap();
        replace_tree(source_root, &bound.repository_path, &bound.pathspec).unwrap();
        state.extensions.mark_path_update_materialized(operation_id);
        let report = extension_commit_path_update(
            &state,
            "test.plugin",
            &json!({
                "operationId": operation_id,
                "commitMessage": "publish artifact"
            }),
        )
        .unwrap();

        assert_eq!(report["pushed"], true);
        assert!(target.join("docs/index.html").is_file());
        run_git(&target, &["fetch", "origin", "main"]);
        let remote_head = Command::new("git")
            .args(["rev-parse", "origin/main"])
            .current_dir(&target)
            .output()
            .unwrap();
        let local_head = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&target)
            .output()
            .unwrap();
        assert_eq!(remote_head.stdout, local_head.stdout);
    }

    #[test]
    fn validates_headless_flow_node_plugins() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("backend")).unwrap();
        fs::write(
            directory
                .path()
                .join("backend")
                .join(native_library_name("demo_plugin")),
            b"placeholder",
        )
        .unwrap();
        let manifest: ExtensionManifest = serde_json::from_value(json!({
            "schemaVersion": 1,
            "apiVersion": "1",
            "id": "com.example.demo",
            "name": "Demo",
            "version": "0.1.0",
            "contributes": {
                "flowNodes": [{
                    "uses": "com.example.demo/scan@v1",
                    "name": "Scan",
                    "type": "scan",
                    "summary": "Scan files",
                    "inputs": { "root": "string" },
                    "outputs": { "count": "number" },
                    "method": "flow.scan"
                }]
            },
            "backend": {
                "runtime": "rust-cdylib",
                "entry": "backend",
                "library": "demo_plugin",
                "methods": { "flow.scan": ["files:read"] }
            },
            "permissions": ["files:read"]
        }))
        .unwrap();

        validate_manifest(&manifest, directory.path()).unwrap();
        validate_backend_exists(&manifest, directory.path()).unwrap();

        let registry = ExtensionRegistry::default();
        fs::write(
            directory.path().join("manifest.json"),
            serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "apiVersion": "1",
                "id": "com.example.demo",
                "name": "Demo",
                "version": "0.1.0",
                "contributes": {
                    "flowNodes": [{
                        "uses": "com.example.demo/scan@v1",
                        "name": "Scan",
                        "type": "scan",
                        "summary": "Scan files",
                        "method": "flow.scan"
                    }]
                },
                "backend": {
                    "runtime": "rust-cdylib",
                    "entry": "backend",
                    "library": "demo_plugin",
                    "methods": { "flow.scan": ["files:read"] }
                },
                "permissions": ["files:read"]
            }))
            .unwrap(),
        )
        .unwrap();
        registry.register_path(directory.path()).unwrap();
        let first_binding = registry
            .flow_node_binding_snapshot("com.example.demo", "com.example.demo/scan@v1")
            .unwrap();
        let mut nodes = gt_flow::FlowNodeRegistry::new();
        registry.contribute_active_flow_nodes(&mut nodes).unwrap();
        assert!(nodes.get("com.example.demo/scan@v1").is_some());
        registry.register_path(directory.path()).unwrap();
        let reinstalled_binding = registry
            .flow_node_binding_snapshot("com.example.demo", "com.example.demo/scan@v1")
            .unwrap();
        assert_ne!(first_binding, reinstalled_binding);
        nodes.unregister_plugin_nodes("com.example.demo");
        assert!(nodes.get("com.example.demo/scan@v1").is_none());
    }

    #[test]
    fn rejects_invalid_flow_node_bindings() {
        let directory = tempfile::tempdir().unwrap();
        let manifest = |uses: &str, method: &str| -> ExtensionManifest {
            serde_json::from_value(json!({
                "schemaVersion": 1,
                "apiVersion": "1",
                "id": "com.example.demo",
                "name": "Demo",
                "version": "0.1.0",
                "contributes": {
                    "flowNodes": [{
                        "uses": uses,
                        "name": "Scan",
                        "type": "scan",
                        "summary": "Scan files",
                        "method": method
                    }]
                },
                "backend": {
                    "entry": "backend",
                    "library": "demo_plugin",
                    "methods": { "flow.scan": [] }
                }
            }))
            .unwrap()
        };
        assert!(validate_manifest(
            &manifest("gittributary/files/override@v1", "flow.scan"),
            directory.path()
        )
        .is_err());
        assert!(validate_manifest(
            &manifest("com.example.demo/scan@v1", "missing.method"),
            directory.path()
        )
        .is_err());
    }

    #[test]
    fn registers_manifest_and_serves_scoped_assets() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("web")).unwrap();
        fs::File::create(directory.path().join("web/index.html"))
            .unwrap()
            .write_all(b"<h1>demo</h1>")
            .unwrap();
        fs::write(
            directory.path().join("manifest.json"),
            r#"{
              "schemaVersion": 1,
              "apiVersion": "1",
              "id": "com.example.demo",
              "name": "Demo",
              "version": "0.1.0",
              "icon": "lucide:paperclip",
              "contributes": {"views": [{
                "id": "main", "title": "Demo", "entry": "web/index.html"
              }]},
              "permissions": ["repository:read"]
            }"#,
        )
        .unwrap();

        let registry = ExtensionRegistry::default();
        registry.register_path(directory.path()).unwrap();
        let extensions = registry.list();
        assert_eq!(extensions.len(), 1);
        let generation = extensions[0].generation;
        assert!(generation > 0);
        assert_eq!(
            registry.validate_generation("com.example.demo", generation),
            Ok(())
        );
        assert_eq!(
            registry.validate_generation("com.example.demo", generation + 1),
            Err("extension_generation_mismatch".to_string())
        );
        assert_eq!(
            registry.validate_generation("com.example.missing", generation),
            Err("extension_not_found".to_string())
        );
        registry.register_path(directory.path()).unwrap();
        let reinstalled_generation = registry.list()[0].generation;
        assert!(reinstalled_generation > generation);
        assert_eq!(
            registry.validate_generation("com.example.demo", generation),
            Err("extension_generation_mismatch".to_string())
        );
        assert_eq!(
            registry.validate_generation("com.example.demo", reinstalled_generation),
            Ok(())
        );
        assert_eq!(
            extensions[0].views[0].icon_url.as_deref(),
            Some("lucide:paperclip")
        );

        let request = Request::builder()
            .uri("gt-plugin://localhost/com.example.demo/web/index.html")
            .body(Vec::new())
            .unwrap();
        let response = asset_response(&registry, &request);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"<h1>demo</h1>");
        let csp = response
            .headers()
            .get("Content-Security-Policy")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("script-src 'self'"));
        assert!(csp.contains("connect-src 'none'"));
        assert!(!csp.contains("img-src 'self' data: https:"));
        assert!(!csp.contains("unsafe-eval"));
    }

    #[test]
    fn network_permission_allows_remote_media_without_enabling_fetch() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("web")).unwrap();
        fs::write(directory.path().join("web/index.html"), "<h1>network</h1>").unwrap();
        fs::write(
            directory.path().join("manifest.json"),
            r#"{
              "schemaVersion": 1,
              "apiVersion": "1",
              "id": "com.example.network",
              "name": "Network",
              "version": "0.1.0",
              "icon": "lucide:paperclip",
              "contributes": {"views": [{
                "id": "main", "title": "Network", "entry": "web/index.html"
              }]},
              "permissions": ["network:read"]
            }"#,
        )
        .unwrap();

        let registry = ExtensionRegistry::default();
        registry.register_path(directory.path()).unwrap();
        let request = Request::builder()
            .uri("gt-plugin://localhost/com.example.network/web/index.html")
            .body(Vec::new())
            .unwrap();
        let response = asset_response(&registry, &request);
        let csp = response
            .headers()
            .get("Content-Security-Policy")
            .unwrap()
            .to_str()
            .unwrap();

        assert!(csp.contains("img-src 'self' data: https: http:"));
        assert!(csp.contains("media-src 'self' data: https: http:"));
        assert!(csp.contains("connect-src 'none'"));
    }

    #[test]
    fn validates_lucide_icon_tokens() {
        assert!(validate_lucide_icon("lucide:paperclip").is_ok());
        assert!(validate_lucide_icon("lucide:chart-no-axes").is_ok());
        assert!(validate_lucide_icon("paperclip").is_err());
        assert!(validate_lucide_icon("lucide:Paperclip").is_err());
        assert!(validate_lucide_icon("lucide:../paperclip").is_err());
    }
}
