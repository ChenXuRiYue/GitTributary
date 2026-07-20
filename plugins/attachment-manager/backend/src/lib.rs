use std::collections::{BTreeMap, HashMap};
use std::ffi::{CStr, CString};
use std::fs;
use std::os::raw::c_char;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Instant, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use percent_encoding::percent_decode_str;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;
use walkdir::{DirEntry, WalkDir};

pub const PLUGIN_ABI_VERSION: u32 = 1;
const MAX_NOTE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PREVIEW_BYTES: u64 = 24 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AttachmentKind {
    Image,
    Audio,
    Link,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum LinkKind {
    Image,
    Audio,
    Video,
    Website,
    Download,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
enum ReferenceRole {
    Embed,
    Navigation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentReference {
    note_path: String,
    line: usize,
    role: ReferenceRole,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentItem {
    path: String,
    url: Option<String>,
    name: String,
    extension: String,
    kind: AttachmentKind,
    link_kind: Option<LinkKind>,
    domain: Option<String>,
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
    skipped_entries: usize,
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
    let mut skipped_entries = 0;
    let mut notes_scanned = 0;

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(included_entry)
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
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
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        attachments.push(AttachmentItem {
            path: relative_path(&root, path)?,
            url: None,
            name: entry.file_name().to_string_lossy().into_owned(),
            extension: extension.clone(),
            kind,
            link_kind: None,
            domain: None,
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
    let mut by_remote_url = HashMap::<String, usize>::new();

    for note_path in &markdown_paths {
        let metadata = match fs::metadata(note_path) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        if metadata.len() > MAX_NOTE_BYTES {
            skipped_entries += 1;
            continue;
        }
        let Ok(content) = fs::read_to_string(note_path) else {
            skipped_entries += 1;
            continue;
        };
        notes_scanned += 1;
        let note_relative = relative_path(&root, note_path)?;
        for extracted in extract_references(&content)? {
            let raw_target = extracted.target;
            let line = extracted.line;
            if let Some(remote) = remote_link_metadata(&raw_target) {
                let reference = AttachmentReference {
                    note_path: note_relative.clone(),
                    line,
                    role: extracted.role,
                };
                if let Some(index) = by_remote_url.get(&remote.canonical_key).copied() {
                    if !attachments[index].references.contains(&reference) {
                        attachments[index].references.push(reference);
                    }
                } else {
                    let index = attachments.len();
                    attachments.push(AttachmentItem {
                        path: remote.url.clone(),
                        url: Some(remote.url),
                        name: remote.name,
                        extension: remote.extension.clone(),
                        kind: AttachmentKind::Link,
                        link_kind: Some(remote.link_kind),
                        domain: Some(remote.domain),
                        mime_type: mime_type(&remote.extension).to_string(),
                        size: 0,
                        modified_at: None,
                        references: vec![reference],
                    });
                    by_remote_url.insert(remote.canonical_key, index);
                }
                continue;
            }
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
                role: extracted.role,
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
        notes_scanned,
        skipped_entries,
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

#[derive(Debug, PartialEq, Eq)]
struct ExtractedReference {
    target: String,
    line: usize,
    role: ReferenceRole,
}

fn extract_references(content: &str) -> Result<Vec<ExtractedReference>, String> {
    static MARKDOWN: OnceLock<Regex> = OnceLock::new();
    static WIKI: OnceLock<Regex> = OnceLock::new();
    static HTML: OnceLock<Regex> = OnceLock::new();
    // Angle-bracket destinations may contain spaces; bare destinations may not.
    let markdown = MARKDOWN.get_or_init(|| {
        Regex::new(r#"(!?)\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[\"'][^\"']*[\"'])?\s*\)"#)
            .expect("valid markdown attachment regex")
    });
    let wiki = WIKI.get_or_init(|| {
        Regex::new(r#"(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]"#)
            .expect("valid wiki attachment regex")
    });
    let html = HTML.get_or_init(|| {
        Regex::new(r#"(?i)\b(src|href)\s*=\s*[\"']([^\"']+)[\"']"#)
            .expect("valid HTML attachment regex")
    });
    let searchable = mask_fenced_code(content);
    let newline_offsets = searchable
        .bytes()
        .enumerate()
        .filter_map(|(offset, byte)| (byte == b'\n').then_some(offset))
        .collect::<Vec<_>>();
    let mut found = BTreeMap::<(usize, String, ReferenceRole), ()>::new();

    for captures in markdown.captures_iter(&searchable) {
        let Some(target) = captures.get(2).or_else(|| captures.get(3)) else {
            continue;
        };
        let role = if captures.get(1).is_some_and(|value| value.as_str() == "!") {
            ReferenceRole::Embed
        } else {
            ReferenceRole::Navigation
        };
        insert_extracted_reference(target, role, &newline_offsets, &mut found);
    }
    for captures in wiki.captures_iter(&searchable) {
        let Some(target) = captures.get(2) else {
            continue;
        };
        let role = if captures.get(1).is_some_and(|value| value.as_str() == "!") {
            ReferenceRole::Embed
        } else {
            ReferenceRole::Navigation
        };
        insert_extracted_reference(target, role, &newline_offsets, &mut found);
    }
    for captures in html.captures_iter(&searchable) {
        let (Some(attribute), Some(target)) = (captures.get(1), captures.get(2)) else {
            continue;
        };
        let role = if attribute.as_str().eq_ignore_ascii_case("src") {
            ReferenceRole::Embed
        } else {
            ReferenceRole::Navigation
        };
        insert_extracted_reference(target, role, &newline_offsets, &mut found);
    }

    Ok(found
        .into_keys()
        .map(|(line, target, role)| ExtractedReference { target, line, role })
        .collect())
}

fn mask_fenced_code(content: &str) -> String {
    let mut bytes = content.as_bytes().to_vec();
    let mut fence: Option<(u8, usize)> = None;
    let mut line_start = 0;

    while line_start < bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |offset| line_start + offset + 1);
        let content_end = bytes[line_start..line_end]
            .iter()
            .rposition(|byte| !matches!(*byte, b'\r' | b'\n'))
            .map_or(line_start, |offset| line_start + offset + 1);
        let line = &content.as_bytes()[line_start..content_end];
        let indent = line.iter().take_while(|byte| **byte == b' ').count();
        let candidate = if indent <= 3 { &line[indent..] } else { &[] };

        let marker = candidate
            .first()
            .copied()
            .filter(|byte| matches!(*byte, b'`' | b'~'));
        let run = marker.map_or(0, |marker| {
            candidate.iter().take_while(|byte| **byte == marker).count()
        });
        let is_fence_line = match fence {
            Some((open_marker, open_run)) => {
                marker == Some(open_marker)
                    && run >= open_run
                    && candidate[run..]
                        .iter()
                        .all(|byte| byte.is_ascii_whitespace())
            }
            None => run >= 3,
        };

        if fence.is_some() || is_fence_line {
            for byte in &mut bytes[line_start..content_end] {
                *byte = b' ';
            }
        }
        match (fence, is_fence_line, marker) {
            (None, true, Some(marker)) => fence = Some((marker, run)),
            (Some(_), true, _) => fence = None,
            _ => {}
        }
        line_start = line_end;
    }

    String::from_utf8(bytes).expect("mask preserves valid UTF-8")
}

fn insert_extracted_reference(
    target: regex::Match<'_>,
    role: ReferenceRole,
    newline_offsets: &[usize],
    found: &mut BTreeMap<(usize, String, ReferenceRole), ()>,
) {
    let line = newline_offsets.partition_point(|offset| *offset < target.start()) + 1;
    found.insert((line, target.as_str().trim().to_string(), role), ());
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

struct RemoteLinkMetadata {
    url: String,
    canonical_key: String,
    name: String,
    extension: String,
    domain: String,
    link_kind: LinkKind,
}

fn parse_remote_url(target: &str) -> Option<Url> {
    let target = target.trim().trim_matches('<').trim_matches('>');
    let (_, authority_and_path) = target.split_once("://")?;
    if authority_and_path.starts_with('/') || authority_and_path.starts_with('\\') {
        return None;
    }
    let url = Url::parse(target).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url)
}

fn remote_link_metadata(target: &str) -> Option<RemoteLinkMetadata> {
    let url = parse_remote_url(target)?;
    let domain = url.host_str()?.to_string();
    let name = remote_name_from_url(&url);
    let extension = extension(Path::new(&name));
    let link_kind = classify_remote_link_parts(&url, &extension);
    let mut canonical_url = url.clone();
    canonical_url.set_fragment(None);

    Some(RemoteLinkMetadata {
        url: url.into(),
        canonical_key: canonical_url.into(),
        name,
        extension,
        domain,
        link_kind,
    })
}

#[cfg(test)]
fn remote_url(target: &str) -> Option<String> {
    parse_remote_url(target).map(Into::into)
}

#[cfg(test)]
fn canonical_remote_key(url: &str) -> String {
    let Ok(mut parsed) = Url::parse(url) else {
        return url.to_string();
    };
    parsed.set_fragment(None);
    parsed.into()
}

fn remote_name_from_url(url: &Url) -> String {
    let encoded_name = url
        .path_segments()
        .and_then(|segments| segments.rev().find(|part| !part.is_empty()));
    encoded_name
        .and_then(|name| percent_decode_str(name).decode_utf8().ok())
        .map(|name| name.into_owned())
        .filter(|name| !name.is_empty())
        .or_else(|| url.host_str().map(str::to_string))
        .unwrap_or_default()
}

#[cfg(test)]
fn remote_domain(url: &str) -> Option<String> {
    Url::parse(url).ok()?.host_str().map(str::to_string)
}

#[cfg(test)]
fn classify_remote_link(url: &str) -> LinkKind {
    let Ok(parsed) = Url::parse(url) else {
        return LinkKind::Unknown;
    };
    let name = remote_name_from_url(&parsed);
    let extension = extension(Path::new(&name));
    classify_remote_link_parts(&parsed, &extension)
}

fn classify_remote_link_parts(url: &Url, extension: &str) -> LinkKind {
    if url.path().trim_matches('/').is_empty() {
        return LinkKind::Website;
    }

    match extension {
        "png" | "apng" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" | "ico"
        | "tif" | "tiff" | "heic" | "heif" | "jxl" => LinkKind::Image,
        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" | "opus" => LinkKind::Audio,
        "mp4" | "webm" | "mov" | "m4v" | "avi" | "mkv" | "ogv" => LinkKind::Video,
        "html" | "htm" | "php" | "asp" | "aspx" | "jsp" => LinkKind::Website,
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" | "zst" | "pdf" | "doc" | "docx"
        | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp" | "epub" | "dmg" | "pkg"
        | "exe" | "msi" | "deb" | "rpm" | "apk" | "ipa" | "bin" | "iso" => LinkKind::Download,
        "" => LinkKind::Website,
        _ => LinkKind::Unknown,
    }
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
        "png" | "apng" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" | "ico"
        | "tif" | "tiff" | "heic" | "heif" | "jxl" => Some(AttachmentKind::Image),
        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" => Some(AttachmentKind::Audio),
        _ => None,
    }
}

fn mime_type(extension: &str) -> &'static str {
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
/// Handles one plugin request encoded as JSON.
///
/// # Safety
///
/// `method` and `payload` must be non-null pointers to valid, NUL-terminated C strings. The
/// returned pointer must be released exactly once with [`gittributary_plugin_free_string`].
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
/// Releases a response allocated by [`gittributary_plugin_handle_request`].
///
/// # Safety
///
/// `value` must be null or a pointer returned by [`gittributary_plugin_handle_request`] that has
/// not already been released.
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
    fn scans_extended_image_formats_and_ignores_removed_types() {
        let directory = tempfile::tempdir().unwrap();
        for name in [
            "photo.HEIC",
            "scan.tiff",
            "icon.ico",
            "motion.apng",
            "next.jxl",
        ] {
            fs::write(directory.path().join(name), b"image").unwrap();
        }
        fs::write(directory.path().join("movie.mp4"), b"video").unwrap();
        fs::write(directory.path().join("document.pdf"), b"pdf").unwrap();

        let report = scan_repository(directory.path().to_str().unwrap()).unwrap();

        assert_eq!(report.attachments.len(), 5);
        assert!(report
            .attachments
            .iter()
            .all(|item| item.kind == AttachmentKind::Image));
    }

    #[test]
    fn resolves_angle_bracket_reference_with_spaces() {
        let references = extract_references("![photo](<assets/my photo.png>)").unwrap();
        assert_eq!(
            references,
            vec![ExtractedReference {
                target: "assets/my photo.png".to_string(),
                line: 1,
                role: ReferenceRole::Embed,
            }]
        );
    }

    #[test]
    fn preserves_reference_roles_across_supported_syntaxes() {
        let references = extract_references(concat!(
            "![markdown embed](https://example.com/image.png)\n",
            "[markdown navigation](https://example.com/docs)\n",
            "![[https://example.com/audio.mp3]]\n",
            "[[https://example.com/home]]\n",
            "<img src=\"https://example.com/photo.webp\">\n",
            "<a href='https://example.com/api'>API</a>\n",
        ))
        .unwrap();

        assert_eq!(references.len(), 6);
        assert_eq!(references[0].role, ReferenceRole::Embed);
        assert_eq!(references[1].role, ReferenceRole::Navigation);
        assert_eq!(references[2].role, ReferenceRole::Embed);
        assert_eq!(references[3].role, ReferenceRole::Navigation);
        assert_eq!(references[4].role, ReferenceRole::Embed);
        assert_eq!(references[5].role, ReferenceRole::Navigation);
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

    #[test]
    fn aggregates_remote_links_without_binding_them_to_local_attachments() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("assets")).unwrap();
        fs::write(directory.path().join("assets/photo.png"), b"png").unwrap();
        fs::write(
            directory.path().join("first.md"),
            concat!(
                "![local](assets/photo.png)\n",
                "![remote](https://example.com/media/photo.png?width=800#preview)\n",
                "![ignored](data:image/png;base64,abc)\n",
            ),
        )
        .unwrap();
        fs::write(
            directory.path().join("second.md"),
            "<img src=\"https://example.com/media/photo.png?width=800#other\">\n",
        )
        .unwrap();

        let report = scan_repository(directory.path().to_str().unwrap()).unwrap();

        assert_eq!(report.attachments.len(), 2);
        assert_eq!(report.total_size, 3);
        let local = report
            .attachments
            .iter()
            .find(|item| item.kind == AttachmentKind::Image)
            .unwrap();
        assert_eq!(local.url, None);
        assert_eq!(local.references.len(), 1);
        assert_eq!(local.references[0].note_path, "first.md");

        let remote = report
            .attachments
            .iter()
            .find(|item| item.kind == AttachmentKind::Link)
            .unwrap();
        assert_eq!(
            remote.url.as_deref(),
            Some("https://example.com/media/photo.png?width=800#preview")
        );
        assert_eq!(
            remote.path,
            "https://example.com/media/photo.png?width=800#preview"
        );
        assert_eq!(remote.name, "photo.png");
        assert_eq!(remote.extension, "png");
        assert_eq!(remote.mime_type, "image/png");
        assert_eq!(remote.link_kind, Some(LinkKind::Image));
        assert_eq!(remote.domain.as_deref(), Some("example.com"));
        assert_eq!(remote.size, 0);
        assert_eq!(remote.references.len(), 2);
        assert!(remote
            .references
            .iter()
            .all(|reference| reference.role == ReferenceRole::Embed));
    }

    #[test]
    fn classifies_remote_links_without_network_requests() {
        let cases = [
            ("https://cdn.example.com/photo.JPEG?v=2", LinkKind::Image),
            ("https://cdn.example.com/voice.opus", LinkKind::Audio),
            ("https://cdn.example.com/movie.webm", LinkKind::Video),
            ("https://example.com/api", LinkKind::Website),
            ("https://example.com/index.html", LinkKind::Website),
            ("https://example.com", LinkKind::Website),
            ("https://example.com/", LinkKind::Website),
            (
                "https://example.com/?source=inventory#overview",
                LinkKind::Website,
            ),
            ("https://example.com/archive.tar.gz", LinkKind::Download),
            ("https://example.com/file.custom", LinkKind::Unknown),
        ];

        for (url, expected) in cases {
            assert_eq!(classify_remote_link(url), expected, "{url}");
        }
    }

    #[test]
    fn classifies_vscode_api_as_website_and_extracts_domain() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("links.md"),
            "[VS Code API](https://code.visualstudio.com/api)\n",
        )
        .unwrap();

        let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
        let link = report.attachments.first().unwrap();

        assert_eq!(link.kind, AttachmentKind::Link);
        assert_eq!(link.link_kind, Some(LinkKind::Website));
        assert_eq!(link.domain.as_deref(), Some("code.visualstudio.com"));
        assert_eq!(link.references[0].role, ReferenceRole::Navigation);
        let serialized = serde_json::to_value(link).unwrap();
        assert_eq!(serialized["linkKind"], "website");
        assert_eq!(serialized["domain"], "code.visualstudio.com");
        assert_eq!(serialized["references"][0]["role"], "navigation");
    }

    #[test]
    fn recognizes_only_http_links_and_preserves_query() {
        assert_eq!(
            remote_url("<HTTPS://example.com/file.svg?v=2#icon>"),
            Some("https://example.com/file.svg?v=2#icon".to_string())
        );
        assert_eq!(
            remote_url("https://EXAMPLE.com:443?mode=api#section"),
            Some("https://example.com/?mode=api#section".to_string())
        );
        assert_eq!(
            remote_url("http://[::1]:80/assets?a=1#preview"),
            Some("http://[::1]/assets?a=1#preview".to_string())
        );
        assert_eq!(remote_url("data:image/png;base64,abc"), None);
        assert_eq!(remote_url("ftp://example.com/file.png"), None);
        assert_eq!(remote_url("https:///missing-host.png"), None);
        assert_eq!(remote_url("https://user@example.com/private.png"), None);
        assert_eq!(
            remote_url("https://user:secret@example.com/private.png"),
            None
        );
    }

    #[test]
    fn canonical_remote_key_ignores_only_fragment() {
        assert_eq!(
            canonical_remote_key("https://example.com/image.png?q=1#first"),
            "https://example.com/image.png?q=1"
        );
        assert_ne!(
            canonical_remote_key("https://example.com/image.png?q=1#first"),
            canonical_remote_key("https://example.com/image.png?q=2#first")
        );
        assert_eq!(
            remote_domain("http://[::1]:8080/path").as_deref(),
            Some("[::1]")
        );
    }

    #[test]
    fn ignores_references_inside_fenced_code_blocks() {
        let references = extract_references(concat!(
            "[outside](https://example.com/outside)\n",
            "```md\n",
            "![example](https://example.com/inside.png)\n",
            "```\n",
            "~~~html\n",
            "<img src=\"https://example.com/inside.jpg\">\n",
            "~~~\n",
        ))
        .unwrap();

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].target, "https://example.com/outside");
        assert_eq!(references[0].line, 1);
        assert_eq!(references[0].role, ReferenceRole::Navigation);
    }

    #[test]
    #[ignore = "performance fixture; run through npm run perf:attachments"]
    fn classifies_large_link_inventory_within_budget() {
        const LINK_COUNT: usize = 5_000;
        const SAMPLE_COUNT: usize = 20;

        let directory = tempfile::tempdir().unwrap();
        let content = (0..LINK_COUNT)
            .map(|index| match index % 5 {
                0 => format!("![image](https://cdn.example.com/{index}.webp)\n"),
                1 => format!("[audio](https://cdn.example.com/{index}.mp3)\n"),
                2 => format!("[video](https://cdn.example.com/{index}.mp4)\n"),
                3 => format!("[site](https://docs.example.com/api/{index})\n"),
                _ => format!("[download](https://files.example.com/{index}.zip)\n"),
            })
            .collect::<String>();
        fs::write(directory.path().join("links.md"), content).unwrap();

        let _ = scan_repository(directory.path().to_str().unwrap()).unwrap();
        let mut samples = Vec::with_capacity(SAMPLE_COUNT);
        for _ in 0..SAMPLE_COUNT {
            let started = Instant::now();
            let report = scan_repository(directory.path().to_str().unwrap()).unwrap();
            assert_eq!(report.attachments.len(), LINK_COUNT);
            samples.push(started.elapsed());
        }
        samples.sort_unstable();
        let p50 = samples[(SAMPLE_COUNT * 50).div_ceil(100) - 1];
        let p95 = samples[(SAMPLE_COUNT * 95).div_ceil(100) - 1];
        let budget_ms = std::env::var("GT_PERF_ATTACHMENT_LINK_SCAN_P95_MS")
            .ok()
            .map(|value| value.parse::<u64>().expect("budget must be an integer"))
            .unwrap_or(1_000);

        println!(
            "PERF fixture=attachment-links links={} samples={} p50_ms={:.2} p95_ms={:.2} budget_ms={}",
            LINK_COUNT,
            SAMPLE_COUNT,
            p50.as_secs_f64() * 1_000.0,
            p95.as_secs_f64() * 1_000.0,
            budget_ms,
        );
        assert!(
            p95.as_millis() <= budget_ms as u128,
            "attachment link scan p95 {:.2}ms exceeded {}ms budget",
            p95.as_secs_f64() * 1_000.0,
            budget_ms,
        );
    }

    #[test]
    fn counts_only_markdown_files_that_were_parsed() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("oversized.md"),
            vec![b'x'; MAX_NOTE_BYTES as usize + 1],
        )
        .unwrap();

        let report = scan_repository(directory.path().to_str().unwrap()).unwrap();

        assert_eq!(report.notes_scanned, 0);
        assert_eq!(report.skipped_entries, 1);
    }
}
