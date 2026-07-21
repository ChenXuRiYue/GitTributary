use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ffi::{CStr, CString};
use std::fs;
use std::io::Write;
use std::os::raw::c_char;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;
use walkdir::{DirEntry, WalkDir};

pub const PLUGIN_ABI_VERSION: u32 = 1;
const MAX_NOTE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PREVIEW_BYTES: u64 = 24 * 1024 * 1024;
const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;
const MAX_MIGRATION_IMAGES: usize = 500;
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubImageConfig {
    owner: String,
    repository: String,
    branch: String,
    directory: String,
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubMigrationRequest {
    repo_path: String,
    image_paths: Vec<String>,
    config: GitHubImageConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubConfigCheckRequest {
    config: GitHubImageConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubConfigCheck {
    repository: String,
    default_branch: String,
    #[serde(rename = "private")]
    is_private: bool,
    can_push: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubMigrationItem {
    local_path: String,
    remote_path: String,
    url: String,
    uploaded: bool,
}

#[derive(Debug, Clone, Serialize)]
struct GitHubMigrationFailure {
    path: String,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubMigrationReport {
    migrated: Vec<GitHubMigrationItem>,
    failed: Vec<GitHubMigrationFailure>,
    failed_notes: Vec<GitHubMigrationFailure>,
    changed_notes: usize,
    replaced_references: usize,
    duration_ms: u128,
}

struct PreparedImage {
    local_path: String,
    remote_path: String,
    url: String,
    bytes: Vec<u8>,
    name: String,
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
        "attachments.checkGithubImageConfig" => {
            let request = deserialize::<GitHubConfigCheckRequest>(payload)?;
            serialize(check_github_config(request.config)?)
        }
        "attachments.migrateGithubImages" => {
            let request = deserialize::<GitHubMigrationRequest>(payload)?;
            serialize(migrate_github_images(request)?)
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

fn migrate_github_images(request: GitHubMigrationRequest) -> Result<GitHubMigrationReport, String> {
    let client = github_client(Duration::from_secs(120))?;
    migrate_github_images_with(request, |config, image| {
        upload_github_image(&client, config, image)
    })
}

fn github_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(timeout)
        .user_agent("GitTributary/attachment-manager")
        .build()
        .map_err(|error| format!("github_client_failed:{error}"))
}

fn check_github_config(mut config: GitHubImageConfig) -> Result<GitHubConfigCheck, String> {
    normalize_github_config(&mut config)?;
    let client = github_client(Duration::from_secs(30))?;
    let repository_endpoint = github_repository_url(&config)?;
    let response = github_request(client.get(repository_endpoint), &config)
        .send()
        .map_err(|error| format!("github_request_failed:{error}"))?;
    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(github_response_error(status, &body));
    }
    let repository = serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("github_response_invalid:{error}"))?;
    let can_push = repository
        .pointer("/permissions/push")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !can_push {
        return Err("github_permission_denied".to_string());
    }

    let branch_endpoint = github_branch_url(&config)?;
    let branch_response = github_request(client.get(branch_endpoint), &config)
        .send()
        .map_err(|error| format!("github_request_failed:{error}"))?;
    let branch_status = branch_response.status();
    if !branch_status.is_success() {
        if branch_status == StatusCode::NOT_FOUND {
            return Err("github_branch_not_found".to_string());
        }
        let body = branch_response.text().unwrap_or_default();
        return Err(github_response_error(branch_status, &body));
    }

    Ok(GitHubConfigCheck {
        repository: format!("{}/{}", config.owner, config.repository),
        default_branch: repository
            .get("default_branch")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        is_private: repository
            .get("private")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        can_push,
    })
}

fn github_request(
    request: reqwest::blocking::RequestBuilder,
    config: &GitHubImageConfig,
) -> reqwest::blocking::RequestBuilder {
    request
        .bearer_auth(&config.token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

fn migrate_github_images_with<F>(
    mut request: GitHubMigrationRequest,
    mut upload: F,
) -> Result<GitHubMigrationReport, String>
where
    F: FnMut(&GitHubImageConfig, &PreparedImage) -> Result<bool, String>,
{
    let started = Instant::now();
    let root = canonical_root(&request.repo_path)?;
    normalize_github_config(&mut request.config)?;
    let selected = request
        .image_paths
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .collect::<BTreeSet<_>>();
    if selected.is_empty() {
        return Err("migration_images_empty".to_string());
    }
    if selected.len() > MAX_MIGRATION_IMAGES {
        return Err("migration_images_too_many".to_string());
    }

    let mut migrated = Vec::new();
    let mut failed = Vec::new();
    let mut replacements = HashMap::<String, String>::new();
    let mut uploaded_paths = HashMap::<String, String>::new();

    for local_path in selected {
        let image = match prepare_image(&root, &local_path, &request.config) {
            Ok(image) => image,
            Err(error) => {
                failed.push(GitHubMigrationFailure {
                    path: local_path,
                    error,
                });
                continue;
            }
        };
        if let Some(url) = uploaded_paths.get(&image.remote_path) {
            replacements.insert(image.local_path.clone(), url.clone());
            migrated.push(GitHubMigrationItem {
                local_path: image.local_path,
                remote_path: image.remote_path,
                url: url.clone(),
                uploaded: false,
            });
            continue;
        }
        match upload(&request.config, &image) {
            Ok(uploaded) => {
                replacements.insert(image.local_path.clone(), image.url.clone());
                uploaded_paths.insert(image.remote_path.clone(), image.url.clone());
                migrated.push(GitHubMigrationItem {
                    local_path: image.local_path,
                    remote_path: image.remote_path,
                    url: image.url,
                    uploaded,
                });
            }
            Err(error) => failed.push(GitHubMigrationFailure {
                path: image.local_path,
                error,
            }),
        }
    }

    let (changed_notes, replaced_references, failed_notes) =
        rewrite_repository_notes(&root, &replacements)?;
    Ok(GitHubMigrationReport {
        migrated,
        failed,
        failed_notes,
        changed_notes,
        replaced_references,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn normalize_github_config(config: &mut GitHubImageConfig) -> Result<(), String> {
    config.owner = config.owner.trim().to_string();
    config.repository = config
        .repository
        .trim()
        .trim_end_matches(".git")
        .to_string();
    config.branch = config.branch.trim().to_string();
    config.directory = normalize_remote_directory(&config.directory)?;
    config.token = config.token.trim().to_string();

    if !valid_github_slug(&config.owner) {
        return Err("github_owner_invalid".to_string());
    }
    if !valid_github_slug(&config.repository) {
        return Err("github_repository_invalid".to_string());
    }
    if !valid_github_branch(&config.branch) {
        return Err("github_branch_invalid".to_string());
    }
    if config.token.is_empty() {
        return Err("github_token_missing".to_string());
    }
    Ok(())
}

fn valid_github_branch(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "@"
        && value != "HEAD"
        && !value.starts_with('-')
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.ends_with('.')
        && !value.contains("//")
        && !value.contains("..")
        && !value.contains("@{")
        && value.split('/').all(|segment| {
            !segment.is_empty()
                && !segment.starts_with('.')
                && !segment.ends_with(".lock")
                && segment.bytes().all(|byte| {
                    !byte.is_ascii_control()
                        && !matches!(byte, b' ' | b'~' | b'^' | b':' | b'?' | b'*' | b'[' | b'\\')
                })
        })
}

fn valid_github_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn normalize_remote_directory(value: &str) -> Result<String, String> {
    if value.contains('\\') {
        return Err("github_directory_invalid".to_string());
    }
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let segments = trimmed.split('/').collect::<Vec<_>>();
    if segments.iter().any(|segment| {
        segment.is_empty()
            || matches!(*segment, "." | "..")
            || segment.len() > 100
            || segment.chars().any(char::is_control)
    }) {
        return Err("github_directory_invalid".to_string());
    }
    Ok(segments.join("/"))
}

fn prepare_image(
    root: &Path,
    local_path: &str,
    config: &GitHubImageConfig,
) -> Result<PreparedImage, String> {
    let path = resolve_existing_file(root, local_path)?;
    let extension = extension(&path);
    if attachment_kind(&extension) != Some(AttachmentKind::Image) {
        return Err("migration_file_not_image".to_string());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_UPLOAD_BYTES {
        return Err("migration_image_too_large".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let file_name = format!("{}.{}", &hash[..20], extension);
    let remote_path = if config.directory.is_empty() {
        file_name
    } else {
        format!("{}/{}", config.directory, file_name)
    };
    Ok(PreparedImage {
        local_path: relative_path(root, &path)?,
        url: raw_github_url(config, &remote_path)?,
        remote_path,
        bytes,
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string(),
    })
}

fn github_content_url(config: &GitHubImageConfig, remote_path: &str) -> Result<Url, String> {
    let mut url = github_repository_url(config)?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "github_url_invalid".to_string())?;
    segments.push("contents");
    segments.extend(remote_path.split('/'));
    drop(segments);
    Ok(url)
}

fn github_repository_url(config: &GitHubImageConfig) -> Result<Url, String> {
    let mut url = Url::parse("https://api.github.com/").map_err(|error| error.to_string())?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "github_url_invalid".to_string())?;
    segments.extend(["repos", &config.owner, &config.repository]);
    drop(segments);
    Ok(url)
}

fn github_branch_url(config: &GitHubImageConfig) -> Result<Url, String> {
    let mut url = github_repository_url(config)?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "github_url_invalid".to_string())?;
    segments.extend(["branches", &config.branch]);
    drop(segments);
    Ok(url)
}

fn raw_github_url(config: &GitHubImageConfig, remote_path: &str) -> Result<String, String> {
    let mut url =
        Url::parse("https://raw.githubusercontent.com/").map_err(|error| error.to_string())?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "github_url_invalid".to_string())?;
    segments.extend([&config.owner, &config.repository]);
    segments.extend(config.branch.split('/'));
    segments.extend(remote_path.split('/'));
    drop(segments);
    Ok(url.into())
}

fn upload_github_image(
    client: &Client,
    config: &GitHubImageConfig,
    image: &PreparedImage,
) -> Result<bool, String> {
    let endpoint = github_content_url(config, &image.remote_path)?;
    let response = github_request(client.put(endpoint.clone()), config)
        .json(&json!({
            "message": format!("chore(images): upload {}", image.name),
            "content": BASE64.encode(&image.bytes),
            "branch": config.branch,
        }))
        .send()
        .map_err(|error| format!("github_request_failed:{error}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(true);
    }
    let body = response.text().unwrap_or_default();
    if matches!(
        status,
        StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY
    ) {
        let existing = github_request(client.get(endpoint), config)
            .query(&[("ref", &config.branch)])
            .send()
            .map_err(|error| format!("github_request_failed:{error}"))?;
        if existing.status().is_success() {
            return Ok(false);
        }
    }
    Err(github_response_error(status, &body))
}

fn github_response_error(status: StatusCode, body: &str) -> String {
    if status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN && body.to_ascii_lowercase().contains("rate limit"))
    {
        return "github_rate_limited".to_string();
    }
    match status {
        StatusCode::UNAUTHORIZED => "github_auth_failed".to_string(),
        StatusCode::FORBIDDEN => "github_permission_denied".to_string(),
        StatusCode::NOT_FOUND => "github_repository_or_branch_not_found".to_string(),
        _ => {
            let message = serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|value| value.get("message")?.as_str().map(str::to_string))
                .unwrap_or_else(|| "unknown response".to_string());
            format!("github_upload_failed:{}:{}", status.as_u16(), message)
        }
    }
}

fn rewrite_repository_notes(
    root: &Path,
    replacements: &HashMap<String, String>,
) -> Result<(usize, usize, Vec<GitHubMigrationFailure>), String> {
    if replacements.is_empty() {
        return Ok((0, 0, Vec::new()));
    }
    let mut by_name = HashMap::<String, Option<String>>::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(included_entry)
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && attachment_kind(&extension(entry.path())) == Some(AttachmentKind::Image)
        })
    {
        let path = relative_path(root, entry.path())?;
        let Some(name) = entry.file_name().to_str() else {
            continue;
        };
        by_name
            .entry(name.to_string())
            .and_modify(|value| *value = None)
            .or_insert(Some(path));
    }

    let mut markdown_paths = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(included_entry)
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && matches!(extension(entry.path()).as_str(), "md" | "markdown")
        })
        .map(|entry| entry.into_path())
        .collect::<Vec<_>>();
    markdown_paths.sort();

    let mut changed_notes = 0;
    let mut replaced_references = 0;
    let mut failed_notes = Vec::new();
    for note_path in markdown_paths {
        let note_relative = relative_path(root, &note_path)?;
        let metadata = match fs::metadata(&note_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                failed_notes.push(GitHubMigrationFailure {
                    path: note_relative,
                    error: error.to_string(),
                });
                continue;
            }
        };
        if metadata.len() > MAX_NOTE_BYTES {
            failed_notes.push(GitHubMigrationFailure {
                path: note_relative,
                error: "note_too_large".to_string(),
            });
            continue;
        }
        let content = match fs::read_to_string(&note_path) {
            Ok(content) => content,
            Err(error) => {
                failed_notes.push(GitHubMigrationFailure {
                    path: note_relative,
                    error: error.to_string(),
                });
                continue;
            }
        };
        let (next, count) =
            rewrite_markdown_links(&note_relative, &content, replacements, &by_name)?;
        if count == 0 {
            continue;
        }
        if let Err(error) = atomic_write(&note_path, &next, metadata.permissions()) {
            failed_notes.push(GitHubMigrationFailure {
                path: note_relative,
                error,
            });
            continue;
        }
        changed_notes += 1;
        replaced_references += count;
    }
    Ok((changed_notes, replaced_references, failed_notes))
}

fn rewrite_markdown_links(
    note_path: &str,
    content: &str,
    replacements: &HashMap<String, String>,
    by_name: &HashMap<String, Option<String>>,
) -> Result<(String, usize), String> {
    static MARKDOWN: OnceLock<Regex> = OnceLock::new();
    static WIKI: OnceLock<Regex> = OnceLock::new();
    static HTML: OnceLock<Regex> = OnceLock::new();
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
    let mut edits = BTreeMap::<(usize, usize), String>::new();

    for captures in markdown.captures_iter(&searchable) {
        if let Some(target) = captures.get(2).or_else(|| captures.get(3)) {
            collect_link_edit(note_path, target, replacements, by_name, &mut edits);
        }
    }
    for captures in wiki.captures_iter(&searchable) {
        if let Some(target) = captures.get(2) {
            collect_link_edit(note_path, target, replacements, by_name, &mut edits);
        }
    }
    for captures in html.captures_iter(&searchable) {
        if let Some(target) = captures.get(2) {
            collect_link_edit(note_path, target, replacements, by_name, &mut edits);
        }
    }

    let count = edits.len();
    let mut rewritten = content.to_string();
    for ((start, end), value) in edits.into_iter().rev() {
        rewritten.replace_range(start..end, &value);
    }
    Ok((rewritten, count))
}

fn collect_link_edit(
    note_path: &str,
    target: regex::Match<'_>,
    replacements: &HashMap<String, String>,
    by_name: &HashMap<String, Option<String>>,
    edits: &mut BTreeMap<(usize, usize), String>,
) {
    let Some(resolved) = resolve_reference(note_path, target.as_str()) else {
        return;
    };
    let matched_path = if replacements.contains_key(&resolved) {
        Some(resolved)
    } else {
        Path::new(&resolved)
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| by_name.get(name))
            .and_then(Clone::clone)
    };
    let Some(url) = matched_path.and_then(|path| replacements.get(&path)) else {
        return;
    };
    edits.insert((target.start(), target.end()), url.clone());
}

fn atomic_write(path: &Path, content: &str, permissions: fs::Permissions) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "note_parent_missing".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "note_name_invalid".to_string())?;
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{file_name}.gittributary-{}-{sequence}",
        std::process::id()
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    if let Err(error) = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::set_permissions(&temporary, permissions))
        .and_then(|_| fs::rename(&temporary, path))
    {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
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

    fn github_config() -> GitHubImageConfig {
        GitHubImageConfig {
            owner: "example".to_string(),
            repository: "images".to_string(),
            branch: "main".to_string(),
            directory: "notes/images".to_string(),
            token: "test-token".to_string(),
        }
    }

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
    fn migrates_uploaded_images_and_rewrites_supported_links() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("notes")).unwrap();
        fs::create_dir_all(directory.path().join("assets")).unwrap();
        fs::write(directory.path().join("assets/photo.png"), b"png-image").unwrap();
        fs::write(
            directory.path().join("notes/demo.md"),
            concat!(
                "![markdown](../assets/photo.png)\n",
                "[navigation](../assets/photo.png)\n",
                "![[../assets/photo.png|wiki]]\n",
                "<img src='../assets/photo.png'>\n",
                "```md\n",
                "![example](../assets/photo.png)\n",
                "```\n",
            ),
        )
        .unwrap();

        let request = GitHubMigrationRequest {
            repo_path: directory.path().to_string_lossy().to_string(),
            image_paths: vec!["assets/photo.png".to_string()],
            config: github_config(),
        };
        let report = migrate_github_images_with(request, |config, image| {
            assert_eq!(config.token, "test-token");
            assert_eq!(image.bytes, b"png-image");
            assert!(image.remote_path.starts_with("notes/images/"));
            Ok(true)
        })
        .unwrap();

        assert_eq!(report.migrated.len(), 1);
        assert!(report.migrated[0].uploaded);
        assert_eq!(report.changed_notes, 1);
        assert_eq!(report.replaced_references, 4);
        assert!(report.failed.is_empty());
        assert!(report.failed_notes.is_empty());
        let rewritten = fs::read_to_string(directory.path().join("notes/demo.md")).unwrap();
        assert_eq!(rewritten.matches(&report.migrated[0].url).count(), 4);
        assert!(rewritten.contains("![example](../assets/photo.png)"));
        assert!(directory.path().join("assets/photo.png").is_file());
    }

    #[test]
    fn leaves_failed_image_references_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("photo.png"), b"png-image").unwrap();
        fs::write(directory.path().join("note.md"), "![photo](photo.png)\n").unwrap();
        let request = GitHubMigrationRequest {
            repo_path: directory.path().to_string_lossy().to_string(),
            image_paths: vec!["photo.png".to_string()],
            config: github_config(),
        };

        let report =
            migrate_github_images_with(request, |_, _| Err("github_auth_failed".to_string()))
                .unwrap();

        assert!(report.migrated.is_empty());
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.changed_notes, 0);
        assert_eq!(report.replaced_references, 0);
        assert_eq!(
            fs::read_to_string(directory.path().join("note.md")).unwrap(),
            "![photo](photo.png)\n"
        );
    }

    #[test]
    fn reuses_one_remote_object_for_identical_images() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("first.png"), b"same-image").unwrap();
        fs::write(directory.path().join("second.png"), b"same-image").unwrap();
        fs::write(
            directory.path().join("note.md"),
            "![first](first.png)\n![second](second.png)\n",
        )
        .unwrap();
        let request = GitHubMigrationRequest {
            repo_path: directory.path().to_string_lossy().to_string(),
            image_paths: vec!["first.png".to_string(), "second.png".to_string()],
            config: github_config(),
        };
        let mut upload_count = 0;

        let report = migrate_github_images_with(request, |_, _| {
            upload_count += 1;
            Ok(true)
        })
        .unwrap();

        assert_eq!(upload_count, 1);
        assert_eq!(report.migrated.len(), 2);
        assert_eq!(report.migrated[0].url, report.migrated[1].url);
        assert_eq!(report.replaced_references, 2);
    }

    #[test]
    fn does_not_guess_ambiguous_image_names_during_rewrite() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("a")).unwrap();
        fs::create_dir_all(directory.path().join("b")).unwrap();
        fs::write(directory.path().join("a/photo.png"), b"first").unwrap();
        fs::write(directory.path().join("b/photo.png"), b"second").unwrap();
        fs::write(directory.path().join("note.md"), "![photo](photo.png)\n").unwrap();
        let request = GitHubMigrationRequest {
            repo_path: directory.path().to_string_lossy().to_string(),
            image_paths: vec!["a/photo.png".to_string()],
            config: github_config(),
        };

        let report = migrate_github_images_with(request, |_, _| Ok(true)).unwrap();

        assert_eq!(report.migrated.len(), 1);
        assert_eq!(report.replaced_references, 0);
        assert_eq!(
            fs::read_to_string(directory.path().join("note.md")).unwrap(),
            "![photo](photo.png)\n"
        );
    }

    #[test]
    fn validates_github_configuration_and_encodes_remote_paths() {
        let mut config = github_config();
        config.directory = " /image cloud/notes/ ".to_string();
        normalize_github_config(&mut config).unwrap();
        assert_eq!(config.directory, "image cloud/notes");
        assert_eq!(
            raw_github_url(&config, "image cloud/notes/photo.png").unwrap(),
            "https://raw.githubusercontent.com/example/images/main/image%20cloud/notes/photo.png"
        );

        config.branch = "feature/images".to_string();
        normalize_github_config(&mut config).unwrap();
        assert_eq!(
            github_branch_url(&config).unwrap().as_str(),
            "https://api.github.com/repos/example/images/branches/feature%2Fimages"
        );
        assert_eq!(
            raw_github_url(&config, "notes/photo.png").unwrap(),
            "https://raw.githubusercontent.com/example/images/feature/images/notes/photo.png"
        );

        for invalid in [
            "HEAD",
            "-draft",
            "/main",
            "main/",
            ".hidden",
            "release..next",
            "topic.lock",
            "bad branch",
        ] {
            config.branch = invalid.to_string();
            assert_eq!(
                normalize_github_config(&mut config).unwrap_err(),
                "github_branch_invalid",
                "{invalid}"
            );
        }
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
