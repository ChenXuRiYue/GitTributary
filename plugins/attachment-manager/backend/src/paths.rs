use std::fs;
use std::path::{Component, Path, PathBuf};

use walkdir::DirEntry;

use crate::model::AttachmentKind;

pub(super) fn canonical_root(repo_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(repo_path)
        .canonicalize()
        .map_err(|_| "repository_not_found".to_string())?;
    if !root.is_dir() {
        return Err("repository_not_directory".to_string());
    }
    Ok(root)
}

pub(super) fn resolve_existing_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = normalize_components(Path::new(relative).components())
        .ok_or_else(|| "invalid_attachment_path".to_string())?;
    let path = root.join(normalized);
    let metadata = fs::symlink_metadata(&path).map_err(|_| "attachment_not_found".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("attachment_not_regular_file".to_string());
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("attachment_path_outside_repository".to_string());
    }
    Ok(canonical)
}

pub(super) fn included_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !(entry.file_type().is_dir()
        && matches!(
            name.as_ref(),
            ".git" | "node_modules" | "target" | ".DS_Store"
        ))
}

pub(super) fn attachment_kind(extension: &str) -> Option<AttachmentKind> {
    match extension {
        "png" | "apng" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" | "ico"
        | "tif" | "tiff" | "heic" | "heif" | "jxl" => Some(AttachmentKind::Image),
        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" => Some(AttachmentKind::Audio),
        _ => None,
    }
}

pub(super) fn mime_type(extension: &str) -> &'static str {
    match extension {
        "png" | "apng" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "jxl" => "image/jxl",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "opus" => "audio/opus",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        _ => "application/octet-stream",
    }
}

pub(super) fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub(super) fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
    Ok(relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
}

pub(super) fn normalize_components<'a>(
    components: impl IntoIterator<Item = Component<'a>>,
) -> Option<String> {
    let mut parts = Vec::new();
    for component in components {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}
