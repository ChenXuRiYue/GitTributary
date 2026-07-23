use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

use na_flow::FlowNodeDefinition;
use serde::Serialize;
use serde_json::Value;

use super::manifest::{
    extension_icon_value, installed_extension_paths, native_library_name, safe_join,
    validate_backend_exists, validate_manifest, ExtensionFlowNode, ExtensionManifest,
};

#[derive(Debug, Clone)]
pub(super) struct InstalledExtension {
    pub(super) manifest: ExtensionManifest,
    pub(super) root: PathBuf,
    pub(super) generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BackendMethodSnapshot {
    pub(super) generation: u64,
    pub(super) version: String,
    pub(super) path: PathBuf,
    pub(super) permissions: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct PathUpdateOperation {
    pub(super) plugin_id: String,
    pub(super) repository_path: PathBuf,
    pub(super) branch: String,
    pub(super) remote_name: String,
    pub(super) pathspec: String,
    pub(super) credential_ref: Option<String>,
    pub(super) materialized: bool,
    pub(super) created_at: Instant,
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
    pub(super) installed: Arc<RwLock<BTreeMap<String, InstalledExtension>>>,
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
        registry: &mut na_flow::FlowNodeRegistry,
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
            .map(extension_to_list_item)
            .collect()
    }

    pub(super) fn validate_generation(
        &self,
        plugin_id: &str,
        generation: u64,
    ) -> Result<(), String> {
        let installed = self.installed.read().unwrap();
        let extension = installed
            .get(plugin_id)
            .ok_or_else(|| "extension_not_found".to_string())?;
        if extension.generation != generation {
            return Err("extension_generation_mismatch".to_string());
        }
        Ok(())
    }

    pub(super) fn has_permission(&self, plugin_id: &str, permission: &str) -> bool {
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

    pub(super) fn has_store_namespace(&self, plugin_id: &str, namespace: &str) -> bool {
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

    pub(super) fn begin_path_update(&self, operation: PathUpdateOperation) -> String {
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

    pub(super) fn path_update(
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

    pub(super) fn mark_path_update_materialized(&self, operation_id: &str) {
        if let Some(operation) = self
            .path_update_operations
            .lock()
            .unwrap()
            .get_mut(operation_id)
        {
            operation.materialized = true;
        }
    }

    pub(super) fn finish_path_update(&self, operation_id: &str) {
        self.path_update_operations
            .lock()
            .unwrap()
            .remove(operation_id);
    }

    pub(super) fn resolve_asset(&self, plugin_id: &str, relative: &str) -> Result<PathBuf, String> {
        let installed = self.installed.read().unwrap();
        let extension = installed
            .get(plugin_id)
            .ok_or_else(|| "插件不存在".to_string())?;
        safe_join(&extension.root, relative)
    }

    pub(super) fn backend_method_snapshot(
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

fn extension_to_list_item(extension: &InstalledExtension) -> ExtensionListItem {
    let base = format!("na-plugin://localhost/{}/", extension.manifest.id);
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
