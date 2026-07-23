use std::path::Path;

use na_git::{AuthMethod, GitRepo};
use serde_json::Value;

use crate::application::git::auth::resolve_auth_for_remote;
use crate::application::git::remote::remote_url_for;
use crate::AppState;

pub(super) fn enrich_backend_payload(
    plugin_id: &str,
    method: &str,
    mut payload: Value,
    state: &AppState,
) -> Result<Value, String> {
    if plugin_id != "dev.noteaura.attachment-manager"
        || !matches!(
            method,
            "attachments.checkGithubImageConfig" | "attachments.migrateGithubImages"
        )
    {
        return Ok(payload);
    }

    let config = payload
        .get_mut("config")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "github_image_config_missing".to_string())?;
    let remote = config
        .get("remote")
        .and_then(Value::as_object)
        .ok_or_else(|| "github_remote_binding_missing".to_string())?;
    let repo_path = required_remote_value(remote, "repoPath", "github_remote_repo_path_missing")?;
    let remote_name = required_remote_value(remote, "name", "github_remote_name_missing")?;
    let requested_url = required_remote_value(remote, "url", "github_remote_url_missing")?;

    let repo = GitRepo::open(repo_path).map_err(|_| "github_remote_repo_missing".to_string())?;
    let configured_url = remote_url_for(&repo, remote_name)
        .map_err(|_| "github_remote_binding_stale".to_string())?;
    if configured_url.trim() != requested_url {
        return Err("github_remote_binding_stale".to_string());
    }
    let (owner, repository) = github_repository_parts(&configured_url)?;
    let resolved =
        resolve_auth_for_remote(state, Path::new(repo_path), Some(&configured_url), None);
    let token = match resolved.method {
        AuthMethod::Token(token) if !token.trim().is_empty() => token,
        _ => return Err("github_remote_token_unavailable".to_string()),
    };

    config.insert("owner".to_string(), Value::String(owner));
    config.insert("repository".to_string(), Value::String(repository));
    config.insert("token".to_string(), Value::String(token));
    Ok(payload)
}

fn required_remote_value<'a>(
    remote: &'a serde_json::Map<String, Value>,
    field: &str,
    error: &str,
) -> Result<&'a str, String> {
    remote
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| error.to_string())
}

pub(super) fn github_repository_parts(remote_url: &str) -> Result<(String, String), String> {
    let trimmed = remote_url.trim().trim_end_matches('/');
    let prefix = "https://github.com/";
    if !trimmed.to_ascii_lowercase().starts_with(prefix) {
        return Err("github_remote_url_unsupported".to_string());
    }
    let path = &trimmed[prefix.len()..];
    if path.contains('?') || path.contains('#') {
        return Err("github_remote_url_unsupported".to_string());
    }
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err("github_remote_url_unsupported".to_string());
    }
    let owner = parts[0].trim();
    let repository = parts[1].trim().trim_end_matches(".git");
    if owner.is_empty() || repository.is_empty() {
        return Err("github_remote_url_unsupported".to_string());
    }
    Ok((owner.to_string(), repository.to_string()))
}
