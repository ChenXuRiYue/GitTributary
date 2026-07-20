use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::State;

use gt_flow::FlowNodeDefinition;
use gt_git::{resolve_repo_root, AuthMethod, GitRepo};

use crate::auth::resolve_auth_for_publish_target;
use crate::commands::files::{files_list, files_read_text, files_scan, files_search};
use crate::commands::flow::flow_records_from_store;
use crate::commands::remote::{get_remote_configs, remote_url_for};
use crate::commands::store::{store_delete, store_get, store_set};
use crate::commands::workspace::get_workspace_info;
use crate::identity::commit_identity_for_repo_remote;
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionListItem {
    pub id: String,
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
        plugin_host: &crate::plugin_host::PluginHostSupervisor,
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

    fn contains(&self, plugin_id: &str) -> bool {
        self.installed.read().unwrap().contains_key(plugin_id)
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
    method: String,
    payload: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if !state.extensions.contains(&plugin_id) {
        return Err("extension_not_found".to_string());
    }
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
            let store = state.store.lock().unwrap();
            let flows = flow_records_from_store(&store)
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
            let namespace = extension_store_namespace(&plugin_id, &payload)?;
            let key = payload_field::<String>(&payload, "key")?;
            Ok(store_get(namespace, key, state).unwrap_or(Value::Null))
        }
        "store.set" => {
            let namespace = extension_store_namespace(&plugin_id, &payload)?;
            let key = payload_field::<String>(&payload, "key")?;
            let value = payload
                .get("value")
                .cloned()
                .ok_or_else(|| "missing_payload_field:value".to_string())?;
            store_set(namespace, key, value, state)?;
            Ok(Value::Null)
        }
        "store.delete" => {
            let namespace = extension_store_namespace(&plugin_id, &payload)?;
            let key = payload_field::<String>(&payload, "key")?;
            store_delete(namespace, key, state)?;
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
        "repositories.configs" => serialize_value(get_remote_configs(state)?),
        "workspace.info" => serialize_value(get_workspace_info(state)),
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
        "backend.invoke" => {
            let expected_snapshot =
                backend_snapshot.ok_or_else(|| "backend_method_snapshot_missing".to_string())?;
            let backend_method = payload
                .get("method")
                .and_then(Value::as_str)
                .ok_or_else(|| "invalid_backend_method".to_string())?
                .to_string();
            let mut backend_payload = payload.get("payload").cloned().unwrap_or(Value::Null);
            if let Some(request) = payload
                .get("hostServices")
                .and_then(|services| services.get("gitPublishContext"))
            {
                if !expected_snapshot
                    .permissions
                    .iter()
                    .any(|permission| permission == "git:write")
                {
                    return Err("permission_denied".to_string());
                }
                let context = extension_git_publish_context(&state, request)?;
                backend_payload
                    .as_object_mut()
                    .ok_or_else(|| "backend_payload_must_be_object".to_string())?
                    .insert("gitContext".to_string(), context);
            }
            let extensions = state.extensions.clone();
            let plugin_host = Arc::clone(&state.plugin_host);
            tauri::async_runtime::spawn_blocking(move || {
                let _lifecycle = extensions.lifecycle_lock();
                let current_snapshot =
                    extensions.backend_method_snapshot(&plugin_id, &backend_method)?;
                if current_snapshot != expected_snapshot {
                    return Err("extension_changed_during_request".to_string());
                }
                plugin_host.invoke_plugin(&current_snapshot.path, &backend_method, backend_payload)
            })
            .await
            .map_err(|error| error.to_string())?
        }
        _ => Err("unknown_method".to_string()),
    }
}

fn extension_to_list_item(extension: &InstalledExtension) -> ExtensionListItem {
    let base = format!("gt-plugin://localhost/{}/", extension.manifest.id);
    ExtensionListItem {
        id: extension.manifest.id.clone(),
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
        "flow:read",
        "files:read",
        "git:write",
        "store:read",
        "store:write",
        "shell:open",
        "network:read",
    ];
    if manifest
        .permissions
        .iter()
        .any(|permission| !allowed_permissions.contains(&permission.as_str()))
    {
        return Err("插件声明了不支持的权限".to_string());
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

fn extension_auth_context(auth: AuthMethod) -> Value {
    match auth {
        AuthMethod::Token(token) => json!({ "kind": "token", "token": token }),
        AuthMethod::SshKey {
            private_key,
            passphrase,
        } => json!({
            "kind": "ssh_key",
            "privateKey": private_key,
            "passphrase": passphrase,
        }),
        AuthMethod::Agent => json!({ "kind": "agent" }),
        AuthMethod::None => json!({ "kind": "none" }),
    }
}

fn extension_git_publish_context(state: &AppState, request: &Value) -> Result<Value, String> {
    let target_local_path = payload_field::<String>(request, "targetLocalPath")?;
    let remote_name = payload_field::<String>(request, "remoteName")?;
    let credential_ref = payload_optional_field::<String>(request, "credentialRef")?;
    let target_root = resolve_repo_root(&target_local_path).map_err(|error| error.to_string())?;
    let target_repo = GitRepo::open(&target_root).map_err(|error| error.to_string())?;
    let remote_url = remote_url_for(&target_repo, &remote_name)?;
    let auth = resolve_auth_for_publish_target(
        state,
        &target_root,
        Some(&remote_url),
        credential_ref.as_deref(),
    );
    let commit_identity =
        commit_identity_for_repo_remote(state, &target_root.to_string_lossy(), Some(&remote_name));
    Ok(json!({
        "targetRoot": target_root,
        "remoteName": remote_name,
        "remoteUrl": remote_url,
        "auth": extension_auth_context(auth.method),
        "mode": auth.mode,
        "credentialRef": auth.credential_ref,
        "commitIdentity": {
            "name": commit_identity.name,
            "email": commit_identity.email,
        }
    }))
}

fn extension_store_namespace(plugin_id: &str, payload: &Value) -> Result<String, String> {
    let requested = payload_field::<String>(payload, "namespace")?;
    if plugin_id == "dev.gittributary.site-publisher"
        && matches!(requested.as_str(), "sites" | "ui-state")
    {
        return Ok(requested);
    }
    let scoped = format!("plugin.{plugin_id}");
    if requested == scoped || requested.starts_with(&format!("{scoped}.")) {
        return Ok(requested);
    }
    Err("store_namespace_denied".to_string())
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
        let store = state.store.lock().unwrap();
        let mut roots = store.recent_repos();
        if let Some(active) = store.active_repo() {
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
    use std::io::Write;

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
        assert_eq!(required_permission("shell.openPath"), Some("shell:open"));
        assert_eq!(required_permission("flow.run"), None);
    }

    #[test]
    fn scopes_extension_store_namespaces() {
        let site_payload = json!({ "namespace": "sites" });
        assert_eq!(
            extension_store_namespace("dev.gittributary.site-publisher", &site_payload).unwrap(),
            "sites"
        );

        let scoped_payload = json!({ "namespace": "plugin.com.example.demo.settings" });
        assert_eq!(
            extension_store_namespace("com.example.demo", &scoped_payload).unwrap(),
            "plugin.com.example.demo.settings"
        );
        assert!(
            extension_store_namespace("com.example.demo", &json!({ "namespace": "sites" }))
                .is_err()
        );
    }

    #[test]
    fn authorizes_only_known_file_roots() {
        let store_directory = tempfile::tempdir().unwrap();
        let repository = tempfile::tempdir().unwrap();
        let unknown = tempfile::tempdir().unwrap();
        let mut store = gt_store::Store::open(store_directory.path()).unwrap();
        store.init_workspace().unwrap();
        let repository_path = repository.path().to_string_lossy().to_string();
        store
            .sync_workspace(Some(&repository_path), Some("main"))
            .unwrap();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            store: std::sync::Mutex::new(store),
            event_pool: std::sync::Mutex::new(gt_flow::EventPool::new()),
            node_registry: std::sync::Mutex::new(gt_flow::FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(crate::plugin_host::PluginHostSupervisor::default()),
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
    fn serializes_git_auth_for_plugin_backends() {
        assert_eq!(
            extension_auth_context(AuthMethod::Token("secret".to_string())),
            json!({ "kind": "token", "token": "secret" })
        );
        assert_eq!(
            extension_auth_context(AuthMethod::SshKey {
                private_key: "/tmp/id_ed25519".to_string(),
                passphrase: None,
            }),
            json!({
                "kind": "ssh_key",
                "privateKey": "/tmp/id_ed25519",
                "passphrase": null,
            })
        );
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
