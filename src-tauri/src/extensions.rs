use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::State;

use crate::commands::flow::flow_records_from_store;
use crate::AppState;

const DEFAULT_API_VERSION: &str = "1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
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
pub struct ExtensionContributions {
    #[serde(default)]
    pub views: Vec<ExtensionView>,
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
pub struct ExtensionBackend {
    #[serde(default = "default_backend_runtime")]
    pub runtime: String,
    pub entry: String,
    pub library: String,
}

#[derive(Debug, Clone)]
struct InstalledExtension {
    manifest: ExtensionManifest,
    root: PathBuf,
}

#[derive(Clone, Default)]
pub struct ExtensionRegistry {
    installed: Arc<RwLock<BTreeMap<String, InstalledExtension>>>,
    lifecycle: Arc<Mutex<()>>,
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
        self.installed
            .write()
            .unwrap()
            .insert(manifest.id.clone(), InstalledExtension { manifest, root });
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

    fn backend_path(&self, plugin_id: &str) -> Result<PathBuf, String> {
        let installed = self.installed.read().unwrap();
        let extension = installed
            .get(plugin_id)
            .ok_or_else(|| "插件不存在".to_string())?;
        let backend = extension
            .manifest
            .backend
            .as_ref()
            .ok_or_else(|| "plugin_backend_missing".to_string())?;
        if backend.runtime != "rust-cdylib" {
            return Err("unsupported_backend_runtime".to_string());
        }
        if !valid_library_name(&backend.library) {
            return Err("invalid_backend_library".to_string());
        }
        safe_join(
            &extension.root,
            &format!(
                "{}/{}",
                backend.entry.trim_end_matches('/'),
                native_library_name(&backend.library)
            ),
        )
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
    let path = match registry.resolve_asset(segments[0], segments[1]) {
        Ok(path) => path,
        Err(error) => return text_response(StatusCode::NOT_FOUND, &error),
    };
    match fs::read(&path) {
        Ok(body) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type(&path))
            .header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors *",
            )
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
pub fn extension_call(
    plugin_id: String,
    method: String,
    payload: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if !state.extensions.contains(&plugin_id) {
        return Err("extension_not_found".to_string());
    }
    if method == "backend.invoke" {
        for permission in ["repository:read", "git:read", "flow:read"] {
            if !state.extensions.has_permission(&plugin_id, permission) {
                return Err("permission_denied".to_string());
            }
        }
    } else {
        let required = required_permission(&method).ok_or_else(|| "unknown_method".to_string())?;
        if !state.extensions.has_permission(&plugin_id, required) {
            return Err("permission_denied".to_string());
        }
    }
    let payload = payload.unwrap_or(Value::Null);

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
        "backend.invoke" => {
            let _lifecycle = state.extensions.lifecycle_lock();
            let backend_method = payload
                .get("method")
                .and_then(Value::as_str)
                .ok_or_else(|| "invalid_backend_method".to_string())?;
            let backend_path = state.extensions.backend_path(&plugin_id)?;
            let (repository, branch, changed_files, commits) = {
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
                    .unwrap_or("repository")
                    .to_string();
                let commits = repo.log(100).map_err(|_| "git_log_failed".to_string())?;
                (
                    display_name,
                    overview.current_branch,
                    overview.changed_count,
                    commits,
                )
            };
            let flow_count = {
                let store = state.store.lock().unwrap();
                flow_records_from_store(&store).len()
            };
            state.plugin_host.invoke_plugin(
                &backend_path,
                backend_method,
                json!({
                    "input": payload.get("payload").cloned().unwrap_or(Value::Null),
                    "hostContext": {
                        "repository": { "id": "active", "name": repository },
                        "branch": branch,
                        "changedFiles": changed_files,
                        "commits": commits,
                        "flowCount": flow_count,
                    }
                }),
            )
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
            .map(|view| ExtensionViewContribution {
                id: view.id.clone(),
                title: view.title.clone(),
                description: view.description.clone(),
                location: view.location.clone(),
                entry_url: format!("{base}{}", view.entry),
                icon_url: view.icon.as_ref().map(|icon| format!("{base}{icon}")),
            })
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
    if manifest.contributes.views.is_empty() {
        return Err("MVP 插件至少需要贡献一个 view".to_string());
    }
    let allowed_permissions = ["repository:read", "git:read", "flow:read"];
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
            safe_join(root, icon)?;
        }
    }
    if let Some(backend) = &manifest.backend {
        validate_relative_path(&backend.entry)?;
        if !valid_library_name(&backend.library) {
            return Err("插件后台 library 格式无效".to_string());
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
        "repositories.active" => Some("repository:read"),
        "git.overview" | "git.log" => Some("git:read"),
        "flow.list" => Some("flow:read"),
        _ => None,
    }
}

fn valid_extension_id(value: &str) -> bool {
    !value.is_empty()
        && value.contains('.')
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
        })
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
        assert_eq!(required_permission("flow.run"), None);
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
              "contributes": {"views": [{
                "id": "main", "title": "Demo", "entry": "web/index.html"
              }]},
              "permissions": ["repository:read"]
            }"#,
        )
        .unwrap();

        let registry = ExtensionRegistry::default();
        registry.register_path(directory.path()).unwrap();
        assert_eq!(registry.list().len(), 1);

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
        assert!(!csp.contains("unsafe-eval"));
    }
}
