use std::fs;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use super::{normalize_relative_path, path_from_slash, FileError, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceTreeReport {
    pub target_root: String,
    pub relative_path: String,
    pub copied_file_count: usize,
}

pub fn replace_tree(
    source: impl AsRef<Path>,
    target_root: impl AsRef<Path>,
    relative_path: &str,
) -> Result<ReplaceTreeReport> {
    let source = canonical_directory(source.as_ref(), "source")?;
    let target_root = canonical_directory(target_root.as_ref(), "target root")?;
    let relative_path = normalize_tree_target(relative_path)?;
    ensure_no_symlink_components(&target_root, &relative_path)?;
    let target = target_root.join(path_from_slash(&relative_path));

    if source == target_root
        || source.starts_with(&target_root)
        || target_root.starts_with(&source)
        || source == target
        || source.starts_with(&target)
        || target.starts_with(&source)
    {
        return Err(FileError::UnsafeTreeReplacement(
            "source and target paths overlap".to_string(),
        ));
    }

    validate_source_tree(&source)?;
    clear_tree_target(&target, target == target_root)?;
    let mut copied_file_count = 0usize;
    copy_tree(&source, &source, &target, &mut copied_file_count)?;
    Ok(ReplaceTreeReport {
        target_root: target_root.to_string_lossy().to_string(),
        relative_path: if relative_path.is_empty() {
            ".".to_string()
        } else {
            relative_path
        },
        copied_file_count,
    })
}

fn canonical_directory(path: &Path, label: &str) -> Result<std::path::PathBuf> {
    let metadata = fs::symlink_metadata(path).map_err(FileError::Io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(FileError::UnsafeTreeReplacement(format!(
            "{label} must be a real directory: {}",
            path.display()
        )));
    }
    path.canonicalize().map_err(FileError::Io)
}

fn normalize_tree_target(value: &str) -> Result<String> {
    if value == "." || value.is_empty() {
        return Ok(String::new());
    }
    if value.chars().any(char::is_control) {
        return Err(FileError::InvalidRelativePath(value.to_string()));
    }
    normalize_relative_path(value, false)
}

fn ensure_no_symlink_components(root: &Path, relative: &str) -> Result<()> {
    let mut current = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(component) = component else {
            continue;
        };
        current.push(component);
        if !current.exists() {
            break;
        }
        let metadata = fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() {
            return Err(FileError::UnsafeTreeReplacement(format!(
                "target path contains a symbolic link: {}",
                current.display()
            )));
        }
        if !metadata.is_dir() {
            return Err(FileError::UnsafeTreeReplacement(format!(
                "target path component is not a directory: {}",
                current.display()
            )));
        }
    }
    Ok(())
}

fn validate_source_tree(root: &Path) -> Result<()> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_name() == ".git" {
                return Err(FileError::UnsafeTreeReplacement(format!(
                    "source tree contains Git metadata: {}",
                    path.display()
                )));
            }
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() {
                return Err(FileError::UnsafeTreeReplacement(format!(
                    "symbolic links are not allowed: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                pending.push(path);
            }
        }
    }
    Ok(())
}

fn clear_tree_target(target: &Path, preserve_git: bool) -> Result<()> {
    if !target.exists() {
        fs::create_dir_all(target)?;
        return Ok(());
    }
    let metadata = fs::symlink_metadata(target)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(FileError::UnsafeTreeReplacement(
            target.to_string_lossy().to_string(),
        ));
    }
    for entry in fs::read_dir(target)? {
        let entry = entry?;
        if preserve_git && entry.file_name() == ".git" {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || metadata.is_file() {
            fs::remove_file(path)?;
        } else if metadata.is_dir() {
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

fn copy_tree(root: &Path, current: &Path, target: &Path, copied: &mut usize) -> Result<()> {
    fs::create_dir_all(target)?;
    let mut entries = fs::read_dir(current)?.collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let source_path = entry.path();
        let metadata = fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() {
            return Err(FileError::UnsafeTreeReplacement(format!(
                "symbolic links are not allowed: {}",
                source_path.display()
            )));
        }
        let relative = source_path.strip_prefix(root).map_err(|_| {
            FileError::UnsafeTreeReplacement(source_path.to_string_lossy().to_string())
        })?;
        let target_path = target.join(relative);
        if metadata.is_dir() {
            fs::create_dir_all(&target_path)?;
            copy_tree(root, &source_path, target, copied)?;
        } else if metadata.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(source_path, target_path)?;
            *copied += 1;
        }
    }
    Ok(())
}
