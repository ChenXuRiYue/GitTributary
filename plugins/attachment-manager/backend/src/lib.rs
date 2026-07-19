use std::collections::{BTreeMap, HashMap};
use std::ffi::{CStr, CString};
use std::fs;
use std::os::raw::c_char;
use std::path::{Component, Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use percent_encoding::percent_decode_str;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use walkdir::{DirEntry, WalkDir};

pub const PLUGIN_ABI_VERSION: u32 = 1;
const MAX_NOTE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PREVIEW_BYTES: u64 = 24 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AttachmentKind {
    Image,
    Audio,
    Video,
    Document,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentReference {
    note_path: String,
    line: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentItem {
    path: String,
    name: String,
    extension: String,
    kind: AttachmentKind,
    mime_type: String,
    size: u64,
    modified_at: Option<u64>,
    references: Vec<AttachmentReference>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentScanReport {
    repo_path: String,
    scanned_at: u64,
    duration_ms: u128,
    notes_scanned: usize,
    total_size: u64,
    attachments: Vec<AttachmentItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentPreview {
    path: String,
    mime_type: String,
    data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanRequest {
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRequest {
    repo_path: String,
    path: String,
}

pub fn handle_request(method: &str, payload: Value) -> Result<Value, String> {
    match method {
        "attachments.scan" => {
            let request = deserialize::<ScanRequest>(payload)?;
            serialize(scan_repository(&request.repo_path)?)
        }
        "attachments.preview" => {
            let request = deserialize::<PreviewRequest>(payload)?;
            serialize(read_preview(&request.repo_path, &request.path)?)
        }
        _ => Err(format!("unsupported method: {method}")),
    }
}

fn scan_repository(repo_path: &str) -> Result<AttachmentScanReport, String> {
    let started = Instant::now();
    let root = canonical_root(repo_path)?;
    let mut attachments = Vec::new();
    let mut markdown_paths = Vec::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(included_entry)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let extension = extension(path);
        if matches!(extension.as_str(), "md" | "markdown") {
            markdown_paths.push(path.to_path_buf());
            continue;
        }
        let Some(kind) = attachment_kind(&extension) else {
            continue;
        };
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        attachments.push(AttachmentItem {
            path: relative_path(&root, path)?,
            name: entry.file_name().to_string_lossy().into_owned(),
            extension: extension.clone(),
            kind,
            mime_type: mime_type(&extension).to_string(),
            size: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs()),
            references: Vec::new(),
        });
    }

    attachments.sort_by(|left, right| left.path.cmp(&right.path));
    markdown_paths.sort();
    let by_path = attachments
        .iter()
        .enumerate()
        .map(|(index, item)| (item.path.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, item) in attachments.iter().enumerate() {
        by_name.entry(item.name.clone()).or_default().push(index);
    }

    for note_path in &markdown_paths {
        let metadata = fs::metadata(note_path).map_err(|error| error.to_string())?;
        if metadata.len() > MAX_NOTE_BYTES {
            continue;
        }
        let Ok(content) = fs::read_to_string(note_path) else {
            continue;
        };
        let note_relative = relative_path(&root, note_path)?;
        for (raw_target, line) in extract_references(&content)? {
            let Some(target) = resolve_reference(&note_relative, &raw_target) else {
                continue;
            };
            let index = by_path.get(&target).copied().or_else(|| {
                Path::new(&target)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .and_then(|name| by_name.get(name))
                    .filter(|matches| matches.len() == 1)
                    .map(|matches| matches[0])
            });
            let Some(index) = index else { continue };
            let reference = AttachmentReference {
                note_path: note_relative.clone(),
                line,
            };
            if !attachments[index].references.contains(&reference) {
                attachments[index].references.push(reference);
            }
        }
    }

    let total_size = attachments.iter().map(|item| item.size).sum();
    Ok(AttachmentScanReport {
        repo_path: root.to_string_lossy().into_owned(),
        scanned_at: std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        duration_ms: started.elapsed().as_millis(),
        notes_scanned: markdown_paths.len(),
        total_size,
        attachments,
    })
}

fn read_preview(repo_path: &str, relative: &str) -> Result<AttachmentPreview, String> {
    let root = canonical_root(repo_path)?;
    let path = resolve_existing_file(&root, relative)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Err("preview_file_too_large".to_string());
    }
    let extension = extension(&path);
    if attachment_kind(&extension).is_none() {
        return Err("preview_type_not_supported".to_string());
    }
    let mime_type = mime_type(&extension).to_string();
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    Ok(AttachmentPreview {
        path: relative_path(&root, &path)?,
        data_url: format!("data:{mime_type};base64,{}", BASE64.encode(bytes)),
        mime_type,
    })
}

fn extract_references(content: &str) -> Result<Vec<(String, usize)>, String> {
    let patterns = [
        r#"!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[\"'][^\"']*[\"'])?\s*\)"#,
        r#"!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]"#,
        r#"(?i)(?:src|href)\s*=\s*[\"']([^\"']+)[\"']"#,
    ];
    let mut found = BTreeMap::<(usize, String), ()>::new();
    for pattern in patterns {
        let regex = Regex::new(pattern).map_err(|error| error.to_string())?;
        for captures in regex.captures_iter(content) {
            let Some(target) = captures.get(1) else {
                continue;
            };
            let line = content[..target.start()]
                .bytes()
                .filter(|byte| *byte == b'\n')
                .count()
                + 1;
            found.insert((line, target.as_str().trim().to_string()), ());
        }
    }
    Ok(found
        .into_keys()
        .map(|(line, target)| (target, line))
        .collect())
}

fn resolve_reference(note_path: &str, target: &str) -> Option<String> {
    let target = target.trim().trim_matches('<').trim_matches('>');
    if target.is_empty()
        || target.starts_with('#')
        || target.starts_with("data:")
        || target.contains("://")
    {
        return None;
    }
    let target = target.split(['?', '#']).next()?;
    let decoded = percent_decode_str(target).decode_utf8().ok()?;
    let mut components = Vec::new();
    if !decoded.starts_with('/') {
        if let Some(parent) = Path::new(note_path).parent() {
            components.extend(parent.components());
        }
    }
    components.extend(Path::new(decoded.trim_start_matches('/')).components());
    normalize_components(components)
}

fn normalize_components<'a>(components: impl IntoIterator<Item = Component<'a>>) -> Option<String> {
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

fn canonical_root(repo_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(repo_path)
        .canonicalize()
        .map_err(|_| "repository_not_found".to_string())?;
    if !root.is_dir() {
        return Err("repository_not_directory".to_string());
    }
    Ok(root)
}

fn resolve_existing_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
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

fn included_entry(entry: &DirEntry) -> bool {
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

fn attachment_kind(extension: &str) -> Option<AttachmentKind> {
    match extension {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" => {
            Some(AttachmentKind::Image)
        }
        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" => Some(AttachmentKind::Audio),
        "mp4" | "webm" | "mov" | "mkv" => Some(AttachmentKind::Video),
        "pdf" => Some(AttachmentKind::Document),
        _ => None,
    }
}

fn mime_type(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
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

fn deserialize<T: serde::de::DeserializeOwned>(payload: Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|error| error.to_string())
}

fn serialize<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[no_mangle]
pub extern "C" fn gittributary_plugin_abi_version() -> u32 {
    PLUGIN_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn gittributary_plugin_handle_request(
    method: *const c_char,
    payload: *const c_char,
) -> *mut c_char {
    if method.is_null() || payload.is_null() {
        return CString::new(r#"{"error":"invalid_pointer"}"#)
            .unwrap()
            .into_raw();
    }
    let method = CStr::from_ptr(method).to_string_lossy();
    let payload = CStr::from_ptr(payload).to_string_lossy();
    let result = serde_json::from_str::<Value>(&payload)
        .map_err(|error| error.to_string())
        .and_then(|value| handle_request(&method, value));
    let response = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    CString::new(response.to_string()).unwrap().into_raw()
}

#[no_mangle]
pub unsafe extern "C" fn gittributary_plugin_free_string(value: *mut c_char) {
    if !value.is_null() {
        drop(CString::from_raw(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_attachments_and_resolves_markdown_references() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("notes")).unwrap();
        fs::create_dir_all(directory.path().join("assets")).unwrap();
        fs::write(directory.path().join("assets/photo.png"), b"png").unwrap();
        fs::write(directory.path().join("assets/voice.mp3"), b"mp3").unwrap();
        fs::write(
            directory.path().join("notes/demo.md"),
            "![photo](../assets/photo.png)\n![[voice.mp3]]\n",
        )
        .unwrap();

        let report = scan_repository(directory.path().to_str().unwrap()).unwrap();

        assert_eq!(report.notes_scanned, 1);
        assert_eq!(report.attachments.len(), 2);
        assert!(report
            .attachments
            .iter()
            .all(|item| item.references.len() == 1));
    }

    #[test]
    fn rejects_preview_path_outside_repository() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            read_preview(directory.path().to_str().unwrap(), "../secret.png").unwrap_err(),
            "invalid_attachment_path"
        );
    }

    #[test]
    fn ignores_remote_and_data_references() {
        assert_eq!(
            resolve_reference("note.md", "https://example.com/a.png"),
            None
        );
        assert_eq!(
            resolve_reference("note.md", "data:image/png;base64,abc"),
            None
        );
    }
}
