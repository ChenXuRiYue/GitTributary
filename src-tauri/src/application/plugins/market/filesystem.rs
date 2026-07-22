use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::application::plugins::registry::{backend_library_relative_path, ExtensionManifest};

const MAX_PLUGIN_FILES: usize = 2_048;
pub(super) const MAX_PLUGIN_BYTES: u64 = 128 * 1024 * 1024;

pub(super) fn stage_project_plugin(
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
    if let Some(icon) = &manifest.icon {
        if !icon.starts_with("lucide:") {
            copy_file_checked(&source.join(icon), &staging.join(icon), &mut limits)?;
        }
    }

    let mut frontend_roots = BTreeSet::new();
    for view in &manifest.contributes.views {
        let entry = Path::new(&view.entry);
        let parent = entry.parent().unwrap_or_else(|| Path::new(""));
        frontend_roots.insert(parent.to_path_buf());
        if let Some(icon) = &view.icon {
            if !icon.starts_with("lucide:") {
                copy_file_checked(&source.join(icon), &staging.join(icon), &mut limits)?;
            }
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
pub(super) struct CopyLimits {
    pub(super) files: usize,
    pub(super) bytes: u64,
}

pub(super) fn copy_tree_checked(
    source: &Path,
    target: &Path,
    limits: &mut CopyLimits,
) -> Result<(), String> {
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

pub(super) fn copy_file_checked(
    source: &Path,
    target: &Path,
    limits: &mut CopyLimits,
) -> Result<(), String> {
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

pub(super) fn ensure_installed_root(
    plugins_root: &Path,
    installed_root: &Path,
) -> Result<(), String> {
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

pub(super) fn remove_other_versions(plugin_root: &Path, active_version: &str) {
    let Ok(entries) = fs::read_dir(plugin_root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name() != active_version {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}
