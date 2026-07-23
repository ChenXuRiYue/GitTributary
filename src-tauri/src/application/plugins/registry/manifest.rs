use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use na_flow::FlowNodeDefinition;
use serde::Deserialize;

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
    pub(super) fn definition(&self) -> FlowNodeDefinition {
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
    validate_views(manifest, root)?;
    validate_flow_nodes(manifest)?;
    validate_backend(manifest, &allowed_permissions)
}

fn validate_views(manifest: &ExtensionManifest, root: &Path) -> Result<(), String> {
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
    Ok(())
}

fn validate_flow_nodes(manifest: &ExtensionManifest) -> Result<(), String> {
    let backend = manifest.backend.as_ref();
    let mut uses = BTreeSet::new();
    for node in &manifest.contributes.flow_nodes {
        if node.uses.trim().is_empty()
            || !node.uses.starts_with(&format!("{}/", manifest.id))
            || !uses.insert(node.uses.as_str())
            || node.name.trim().is_empty()
            || node.node_type.trim().is_empty()
            || node.summary.trim().is_empty()
            || node.method.trim().is_empty()
        {
            return Err("插件 flowNode 定义无效".to_string());
        }
        if backend
            .and_then(|item| item.methods.get(&node.method))
            .is_none()
        {
            return Err("插件 flowNode method 未在 backend.methods 声明".to_string());
        }
    }
    Ok(())
}

fn validate_backend(
    manifest: &ExtensionManifest,
    allowed_permissions: &[&str],
) -> Result<(), String> {
    let Some(backend) = &manifest.backend else {
        return Ok(());
    };
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

pub(super) fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative_path(relative)?;
    let root = root
        .canonicalize()
        .map_err(|_| "插件目录不存在".to_string())?;
    let target = root
        .join(relative)
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

pub(super) fn installed_extension_paths(plugins_root: &Path) -> Vec<PathBuf> {
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

pub(super) fn extension_icon_value(base: &str, icon: &str) -> String {
    if icon.starts_with("lucide:") {
        icon.to_string()
    } else {
        format!("{base}{icon}")
    }
}

pub(super) fn native_library_name(library: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{library}.dll")
    } else if cfg!(target_os = "macos") {
        format!("lib{library}.dylib")
    } else {
        format!("lib{library}.so")
    }
}

pub(super) fn valid_extension_id(value: &str) -> bool {
    !value.is_empty()
        && value.contains('.')
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
        })
}

pub(super) fn validate_lucide_icon(value: &str) -> Result<(), String> {
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

pub(super) fn valid_version_segment(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-'
        })
}

fn valid_library_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn default_api_version() -> String {
    DEFAULT_API_VERSION.to_string()
}

fn default_publisher() -> String {
    "NoteAura".to_string()
}

fn default_view_location() -> String {
    "activitybar".to_string()
}

fn default_backend_runtime() -> String {
    "wasi-component".to_string()
}
