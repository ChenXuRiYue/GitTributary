use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config_dir::store_base_dir;
use crate::extensions::{
    backend_library_relative_path, read_manifest, validate_backend_exists, validate_manifest,
    ExtensionManifest,
};
use crate::AppState;

const MAX_PLUGIN_FILES: usize = 2_048;
const MAX_PLUGIN_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub publisher: String,
    pub permissions: Vec<String>,
    pub views: Vec<PluginMarketView>,
    pub backend_runtime: Option<String>,
    pub installed: bool,
    pub available: bool,
    pub native_code: bool,
    pub source_label: String,
    pub installed_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketView {
    pub id: String,
    pub title: String,
}

#[tauri::command]
pub fn plugin_market_list(app: AppHandle, state: State<'_, AppState>) -> Vec<PluginMarketItem> {
    let catalog_root = match plugin_catalog_root(&app) {
        Ok(root) => root,
        Err(error) => {
            eprintln!("[plugins] cannot resolve bundled plugin directory: {error}");
            return Vec::new();
        }
    };
    plugin_sources(&catalog_root)
        .into_iter()
        .filter_map(|source| match read_manifest(&source) {
            Ok(manifest) => match validate_project_plugin(&manifest, &source) {
                Ok(()) => Some(market_item(&manifest, &state)),
                Err(error) => {
                    eprintln!("[plugins] ignore {}: {error}", source.display());
                    None
                }
            },
            Err(error) => {
                eprintln!("[plugins] ignore {}: {error}", source.display());
                None
            }
        })
        .collect()
}

#[tauri::command]
pub fn plugin_install(
    plugin_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PluginMarketItem, String> {
    let catalog_root = plugin_catalog_root(&app)?;
    let (source, manifest) =
        plugin_source(&catalog_root, &plugin_id).ok_or_else(|| "plugin_not_found".to_string())?;
    validate_project_plugin(&manifest, &source)?;

    let plugins_root = plugins_root();
    let staging_root = plugins_root.join(".staging");
    let trash_root = plugins_root.join(".trash");
    fs::create_dir_all(&staging_root).map_err(|error| error.to_string())?;
    fs::create_dir_all(&trash_root).map_err(|error| error.to_string())?;
    let token = operation_token();
    let staging = staging_root.join(format!("{}-{token}", manifest.id));
    let target_parent = plugins_root.join(&manifest.id);
    let target = target_parent.join(&manifest.version);
    fs::create_dir_all(&target_parent).map_err(|error| error.to_string())?;

    if let Err(error) = stage_project_plugin(&source, &staging, &manifest) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let staged_manifest = match read_manifest(&staging) {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if let Err(error) = validate_project_plugin(&staged_manifest, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let _lifecycle = state.extensions.lifecycle_lock();
    state.plugin_host.unload_plugin()?;
    let previous_root = state.extensions.unregister(&manifest.id);
    let backup = trash_root.join(format!("{}-{token}", manifest.id));
    let had_target = target.exists();
    if had_target {
        if let Err(error) = fs::rename(&target, &backup) {
            if let Some(previous_root) = previous_root {
                let _ = state.extensions.register_path(&previous_root);
            }
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("备份旧插件失败: {error}"));
        }
    }

    let install_result = fs::rename(&staging, &target)
        .map_err(|error| format!("切换插件版本失败: {error}"))
        .and_then(|_| state.extensions.register_path(&target));
    if let Err(error) = install_result {
        let _ = fs::remove_dir_all(&target);
        if had_target {
            let _ = fs::rename(&backup, &target);
        }
        if let Some(previous_root) = previous_root {
            let _ = state.extensions.register_path(&previous_root);
        }
        return Err(error);
    }

    if had_target {
        let _ = fs::remove_dir_all(&backup);
    }
    remove_other_versions(&target_parent, &manifest.version);
    let item = market_item(&manifest, &state);
    let _ = app.emit("extensions://changed", &item);
    Ok(item)
}

#[tauri::command]
pub fn plugin_uninstall(
    plugin_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let plugins_root = plugins_root();
    let plugin_root = plugins_root.join(&plugin_id);
    let trash_root = plugins_root.join(".trash");
    fs::create_dir_all(&trash_root).map_err(|error| error.to_string())?;
    let _lifecycle = state.extensions.lifecycle_lock();
    let registered_root = state
        .extensions
        .installed_root(&plugin_id)
        .ok_or_else(|| "extension_not_found".to_string())?;
    ensure_installed_root(&plugins_root, &registered_root)?;

    state.plugin_host.unload_plugin()?;
    let previous_root = state
        .extensions
        .unregister(&plugin_id)
        .ok_or_else(|| "extension_not_found".to_string())?;
    let trash = trash_root.join(format!("{}-{}", plugin_id, operation_token()));
    if let Err(error) = fs::rename(&plugin_root, &trash) {
        let _ = state.extensions.register_path(&previous_root);
        return Err(format!("移动待卸载插件失败: {error}"));
    }
    let _ = fs::remove_dir_all(&trash);
    let _ = app.emit("extensions://changed", &plugin_id);
    Ok(())
}

fn plugins_root() -> PathBuf {
    store_base_dir().join("plugins")
}

fn plugin_catalog_root(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return plugin_catalog_root_for_mode(true, Path::new(env!("CARGO_MANIFEST_DIR")), None);
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    plugin_catalog_root_for_mode(
        false,
        Path::new(env!("CARGO_MANIFEST_DIR")),
        Some(&resource_dir),
    )
}

fn plugin_catalog_root_for_mode(
    debug: bool,
    manifest_dir: &Path,
    resource_dir: Option<&Path>,
) -> Result<PathBuf, String> {
    if debug {
        let project_root = manifest_dir
            .parent()
            .ok_or_else(|| "project_root_missing".to_string())?;
        return Ok(project_root.join("plugins"));
    }
    let resource_dir = resource_dir.ok_or_else(|| "resource_dir_missing".to_string())?;
    Ok(resource_dir.join("plugins"))
}

fn plugin_sources(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut sources = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join("manifest.json").is_file())
        .collect::<Vec<_>>();
    sources.sort();
    sources
}

fn plugin_source(root: &Path, plugin_id: &str) -> Option<(PathBuf, ExtensionManifest)> {
    plugin_sources(root).into_iter().find_map(|source| {
        let manifest = read_manifest(&source).ok()?;
        (manifest.id == plugin_id).then_some((source, manifest))
    })
}

fn market_item(manifest: &ExtensionManifest, state: &AppState) -> PluginMarketItem {
    let installed_version = state.extensions.installed_version(&manifest.id);
    let backend_runtime = manifest
        .backend
        .as_ref()
        .map(|backend| backend.runtime.clone());
    PluginMarketItem {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        description: manifest.description.clone(),
        version: manifest.version.clone(),
        publisher: manifest.publisher.clone(),
        permissions: manifest.permissions.clone(),
        views: manifest
            .contributes
            .views
            .iter()
            .map(|view| PluginMarketView {
                id: view.id.clone(),
                title: view.title.clone(),
            })
            .collect(),
        native_code: backend_runtime.as_deref() == Some("rust-cdylib"),
        backend_runtime,
        installed: installed_version.is_some(),
        available: true,
        source_label: "内置插件".to_string(),
        installed_version,
    }
}

fn validate_project_plugin(manifest: &ExtensionManifest, root: &Path) -> Result<(), String> {
    validate_manifest(manifest, root)?;
    validate_backend_exists(manifest, root)
}

fn stage_project_plugin(
    source: &Path,
    staging: &Path,
    manifest: &ExtensionManifest,
) -> Result<(), String> {
    fs::create_dir(staging).map_err(|error| error.to_string())?;
    let mut limits = CopyLimits::default();
    copy_file_checked(
        &source.join("manifest.json"),
        &staging.join("manifest.json"),
        &mut limits,
    )?;

    let mut frontend_roots = BTreeSet::new();
    for view in &manifest.contributes.views {
        let entry = Path::new(&view.entry);
        let parent = entry.parent().unwrap_or_else(|| Path::new(""));
        frontend_roots.insert(parent.to_path_buf());
        if let Some(icon) = &view.icon {
            copy_file_checked(&source.join(icon), &staging.join(icon), &mut limits)?;
        }
    }
    for relative in frontend_roots {
        copy_tree_checked(
            &source.join(&relative),
            &staging.join(&relative),
            &mut limits,
        )?;
    }
    if let Some(backend) = &manifest.backend {
        let relative = backend_library_relative_path(backend);
        copy_file_checked(
            &source.join(&relative),
            &staging.join(relative),
            &mut limits,
        )?;
    }
    Ok(())
}

#[derive(Default)]
struct CopyLimits {
    files: usize,
    bytes: u64,
}

fn copy_tree_checked(source: &Path, target: &Path, limits: &mut CopyLimits) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("plugin_source_contains_symlink".to_string());
    }
    if metadata.is_file() {
        return copy_file_checked(source, target, limits);
    }
    if !metadata.is_dir() {
        return Err("plugin_source_contains_unsupported_entry".to_string());
    }
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        copy_tree_checked(&entry.path(), &target.join(entry.file_name()), limits)?;
    }
    Ok(())
}

fn copy_file_checked(source: &Path, target: &Path, limits: &mut CopyLimits) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("plugin_source_entry_is_not_regular_file".to_string());
    }
    limits.files += 1;
    limits.bytes = limits.bytes.saturating_add(metadata.len());
    if limits.files > MAX_PLUGIN_FILES || limits.bytes > MAX_PLUGIN_BYTES {
        return Err("plugin_package_too_large".to_string());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, target).map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_installed_root(plugins_root: &Path, installed_root: &Path) -> Result<(), String> {
    let plugins_root = plugins_root
        .canonicalize()
        .map_err(|_| "plugins_root_missing".to_string())?;
    let installed_root = installed_root
        .canonicalize()
        .map_err(|_| "extension_root_missing".to_string())?;
    if !installed_root.starts_with(&plugins_root) {
        return Err("extension_root_outside_plugins_directory".to_string());
    }
    Ok(())
}

fn remove_other_versions(plugin_root: &Path, active_version: &str) {
    let Ok(entries) = fs::read_dir(plugin_root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name() != active_version {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn operation_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{nanos}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rejects_symlinks_while_copying_plugin_payload() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        let target = directory.path().join("target");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("real.js"), "ok").unwrap();

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(source.join("real.js"), source.join("link.js")).unwrap();
            let error =
                copy_tree_checked(&source, &target, &mut CopyLimits::default()).unwrap_err();
            assert_eq!(error, "plugin_source_contains_symlink");
        }
    }

    #[test]
    fn enforces_total_copy_size() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("large.bin");
        let mut file = fs::File::create(&source).unwrap();
        file.write_all(b"large").unwrap();
        let mut limits = CopyLimits {
            files: 0,
            bytes: MAX_PLUGIN_BYTES,
        };
        assert_eq!(
            copy_file_checked(&source, &directory.path().join("copy.bin"), &mut limits)
                .unwrap_err(),
            "plugin_package_too_large"
        );
    }

    #[test]
    fn resolves_debug_catalog_from_project_root() {
        let catalog = plugin_catalog_root_for_mode(
            true,
            Path::new("/workspace/GitTributary/src-tauri"),
            Some(Path::new("/ignored/resources")),
        )
        .unwrap();
        assert_eq!(catalog, Path::new("/workspace/GitTributary/plugins"));
    }

    #[test]
    fn resolves_release_catalog_from_resource_directory() {
        let catalog = plugin_catalog_root_for_mode(
            false,
            Path::new("/ignored/src-tauri"),
            Some(Path::new("/Applications/GitTributary/Resources")),
        )
        .unwrap();
        assert_eq!(
            catalog,
            Path::new("/Applications/GitTributary/Resources/plugins")
        );
    }

    #[test]
    fn discovers_site_publisher_from_project_plugins() {
        let root = plugin_catalog_root_for_mode(true, Path::new(env!("CARGO_MANIFEST_DIR")), None)
            .unwrap();
        let plugins = plugin_sources(&root);
        assert!(plugins.iter().any(|source| {
            read_manifest(source)
                .is_ok_and(|manifest| manifest.id == "dev.gittributary.site-publisher")
        }));
    }
}
