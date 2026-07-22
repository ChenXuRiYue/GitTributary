use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;

use crate::model::{
    AttachmentKind, GitHubConfigCheck, GitHubImageConfig, GitHubMigrationFailure,
    GitHubMigrationItem, GitHubMigrationReport, GitHubMigrationRequest, LocalFilePolicy,
    PreparedImage,
};
use crate::paths::{
    attachment_kind, canonical_root, extension, relative_path, resolve_existing_file,
};
use crate::rewrite::rewrite_repository_notes;
use crate::scan::scan_repository;

const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;
const MAX_MIGRATION_IMAGES: usize = 500;

pub(super) fn migrate_github_images(
    request: GitHubMigrationRequest,
) -> Result<GitHubMigrationReport, String> {
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

pub(super) fn check_github_config(
    mut config: GitHubImageConfig,
) -> Result<GitHubConfigCheck, String> {
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

    let branch_response = github_request(client.get(github_branch_url(&config)?), &config)
        .send()
        .map_err(|error| format!("github_request_failed:{error}"))?;
    let branch_status = branch_response.status();
    if !branch_status.is_success() {
        if branch_status == StatusCode::NOT_FOUND {
            return Err("github_branch_not_found".to_string());
        }
        return Err(github_response_error(
            branch_status,
            &branch_response.text().unwrap_or_default(),
        ));
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

pub(super) fn migrate_github_images_with<F>(
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
    let referenced_before = if request.local_file_policy == LocalFilePolicy::DeleteAfterSuccess {
        scan_repository(&request.repo_path)?
            .attachments
            .into_iter()
            .filter(|item| selected.contains(&item.path) && !item.references.is_empty())
            .map(|item| item.path)
            .collect::<BTreeSet<_>>()
    } else {
        BTreeSet::new()
    };

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

    let (changed_note_paths, replaced_references, failed_notes) =
        rewrite_repository_notes(&root, &replacements)?;
    let (deleted_local_paths, failed_deletes) =
        if request.local_file_policy == LocalFilePolicy::DeleteAfterSuccess {
            delete_migrated_images(&root, &migrated, &referenced_before, &failed_notes)
        } else {
            (Vec::new(), Vec::new())
        };
    Ok(GitHubMigrationReport {
        migrated,
        failed,
        failed_notes,
        failed_deletes,
        changed_notes: changed_note_paths.len(),
        changed_note_paths,
        deleted_local_paths,
        replaced_references,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn delete_migrated_images(
    root: &Path,
    migrated: &[GitHubMigrationItem],
    referenced_before: &BTreeSet<String>,
    failed_notes: &[GitHubMigrationFailure],
) -> (Vec<String>, Vec<GitHubMigrationFailure>) {
    if !failed_notes.is_empty() {
        return (
            Vec::new(),
            migrated
                .iter()
                .map(|item| GitHubMigrationFailure {
                    path: item.local_path.clone(),
                    error: "migration_delete_skipped_note_failures".to_string(),
                })
                .collect(),
        );
    }
    let remaining_references = match scan_repository(&root.to_string_lossy()) {
        Ok(report) => report
            .attachments
            .into_iter()
            .filter(|item| item.kind == AttachmentKind::Image)
            .map(|item| (item.path, item.references.len()))
            .collect::<HashMap<_, _>>(),
        Err(error) => {
            return (
                Vec::new(),
                migrated
                    .iter()
                    .map(|item| GitHubMigrationFailure {
                        path: item.local_path.clone(),
                        error: format!("migration_delete_scan_failed:{error}"),
                    })
                    .collect(),
            );
        }
    };

    let mut deleted = Vec::new();
    let mut failed = Vec::new();
    for item in migrated {
        let error = if !referenced_before.contains(&item.local_path) {
            Some("migration_delete_skipped_no_references".to_string())
        } else if remaining_references
            .get(&item.local_path)
            .is_some_and(|count| *count > 0)
        {
            Some("migration_delete_skipped_remaining_references".to_string())
        } else {
            resolve_existing_file(root, &item.local_path)
                .and_then(|path| fs::remove_file(path).map_err(|error| error.to_string()))
                .err()
        };
        if let Some(error) = error {
            failed.push(GitHubMigrationFailure {
                path: item.local_path.clone(),
                error,
            });
        } else {
            deleted.push(item.local_path.clone());
        }
    }
    (deleted, failed)
}

pub(super) fn normalize_github_config(config: &mut GitHubImageConfig) -> Result<(), String> {
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

pub(super) fn github_branch_url(config: &GitHubImageConfig) -> Result<Url, String> {
    let mut url = github_repository_url(config)?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "github_url_invalid".to_string())?;
    segments.extend(["branches", &config.branch]);
    drop(segments);
    Ok(url)
}

pub(super) fn raw_github_url(
    config: &GitHubImageConfig,
    remote_path: &str,
) -> Result<String, String> {
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
