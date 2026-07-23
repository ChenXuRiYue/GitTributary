use std::path::{Path, PathBuf};

use na_data::{DataHub, RemoteCommitIdentity};
use na_git::GitRepo;

use crate::application::git::auth::credential_summary_for_remote;
use crate::application::git::identity::{
    default_commit_identity_config, remote_commit_identity_config,
};
use crate::support::config_dir::store_base_dir;
use crate::AppState;

#[derive(serde::Serialize)]
pub(crate) struct RemoteConfigEntry {
    pub(super) name: String,
    pub(super) url: String,
    pub(super) push_url: Option<String>,
    pub(super) repo_path: Option<String>,
    pub(super) source: String,
    pub(super) purpose: Vec<String>,
    pub(super) credential_mode: String,
    pub(super) credential_ref: Option<String>,
    pub(super) commit_name: Option<String>,
    pub(super) commit_email: Option<String>,
    pub(super) verify_status: String,
    pub(super) capabilities: String,
}

fn config_repo_credential_summary(data: &DataHub) -> (String, Option<String>) {
    let status = data.credentials().data_center_config_status();
    if status.has_token {
        ("config_repo_token".to_string(), Some(status.credential_ref))
    } else {
        ("none".to_string(), None)
    }
}

pub(super) fn config_repo_remote_name(url: &str) -> String {
    let trimmed = url.trim_end_matches(".git").trim_end_matches('/');
    let name = trimmed
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("config-repo");
    format!("data-center/{}", name)
}

pub(super) fn repo_path_for_repo(repo: &GitRepo) -> Result<String, String> {
    repo.workdir()
        .map(|path| path.display().to_string())
        .ok_or_else(|| "无法获取仓库路径".to_string())
}

pub(super) fn save_project_remote_config_and_bind_repo(
    state: &AppState,
    repo_path: &str,
    remote_name: &str,
    token: &str,
    commit_name: Option<&str>,
    commit_email: Option<&str>,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.credentials_mut()
        .set_project_token(repo_path, token)
        .map_err(|e| e.to_string())?;
    let identity = RemoteCommitIdentity::normalized(commit_name, commit_email);
    data.remote_metadata_mut()
        .save_commit_identity(repo_path, remote_name, &identity)
        .map_err(|e| e.to_string())?;
    data.workspace_mut()
        .bind_repo(repo_path)
        .map_err(|e| e.to_string())
}

pub(super) fn save_project_token_and_bind_repo(
    state: &AppState,
    repo_path: &str,
    token: &str,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.credentials_mut()
        .set_project_token(repo_path, token)
        .map_err(|e| e.to_string())?;
    data.workspace_mut()
        .bind_repo(repo_path)
        .map_err(|e| e.to_string())
}

/// 找远程 URL,找不到直接报错(用于发布/改 URL 前先取旧值)。
pub(crate) fn remote_url_for(repo: &GitRepo, name: &str) -> Result<String, String> {
    repo.remotes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|remote| remote.name == name)
        .map(|remote| remote.url)
        .ok_or_else(|| format!("远程 '{}' 不存在", name))
}

pub(super) fn maybe_unbind_repo_without_remotes(
    state: &AppState,
    repo_path: &str,
    has_remotes: bool,
) -> Result<(), String> {
    if !has_remotes {
        let mut data = state.data.lock().unwrap();
        data.workspace_mut()
            .unbind_repo(repo_path)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn delete_remote_commit_identity(
    state: &AppState,
    repo_path: &str,
    remote_name: &str,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.remote_metadata_mut()
        .delete_commit_identity(repo_path, remote_name)
        .map_err(|e| e.to_string())
}

fn push_remote_config_entries_for_repo(
    entries: &mut Vec<RemoteConfigEntry>,
    data: &DataHub,
    repo_path: &str,
    purpose: &str,
) -> Result<(), String> {
    let repo = GitRepo::open(repo_path).map_err(|e| e.to_string())?;
    for remote in repo.remotes().map_err(|e| e.to_string())? {
        let (credential_mode, credential_ref) =
            credential_summary_for_remote(data, Some(repo_path), &remote.url);
        let identity = remote_commit_identity_config(data, repo_path, &remote.name);
        entries.push(RemoteConfigEntry {
            name: remote.name,
            url: remote.url,
            push_url: remote.push_url,
            repo_path: Some(repo_path.to_string()),
            source: "local_git_config".to_string(),
            purpose: vec![purpose.to_string()],
            credential_mode,
            credential_ref,
            commit_name: identity.as_ref().and_then(|identity| identity.name.clone()),
            commit_email: identity.and_then(|identity| identity.email),
            verify_status: "unverified".to_string(),
            capabilities: "unknown".to_string(),
        });
    }
    Ok(())
}

fn push_remote_config_entries_for_existing_repo(
    entries: &mut Vec<RemoteConfigEntry>,
    data: &DataHub,
    seen_paths: &mut std::collections::HashSet<String>,
    repo_path: &str,
    purpose: &str,
) {
    let repo_path = repo_path.trim();
    if repo_path.is_empty() || !Path::new(repo_path).exists() {
        return;
    }
    if !seen_paths.insert(repo_path.to_string()) {
        return;
    }
    let _ = push_remote_config_entries_for_repo(entries, data, repo_path, purpose);
}

pub(super) fn collect_remote_configs(state: &AppState) -> Result<Vec<RemoteConfigEntry>, String> {
    collect_remote_configs_with_base_dir(state, store_base_dir())
}

pub(super) fn collect_remote_configs_with_base_dir(
    state: &AppState,
    base_dir: PathBuf,
) -> Result<Vec<RemoteConfigEntry>, String> {
    let active_workdir = {
        let lock = state.repo.lock().unwrap();
        lock.as_ref()
            .and_then(|repo| repo.workdir().map(|p| p.display().to_string()))
    };

    let data = state.data.lock().unwrap();
    let workspace = data.workspace().snapshot();
    let workspace_active_repo = workspace.active_repo;
    let mut entries: Vec<RemoteConfigEntry> = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    if let Some(active_path) = active_workdir.as_deref() {
        push_remote_config_entries_for_existing_repo(
            &mut entries,
            &data,
            &mut seen_paths,
            active_path,
            "current_repo_remote",
        );
    }
    if let Some(active_path) = workspace_active_repo.as_deref() {
        push_remote_config_entries_for_existing_repo(
            &mut entries,
            &data,
            &mut seen_paths,
            active_path,
            "current_repo_remote",
        );
    }

    let mut repo_paths = workspace.bound_repos;
    repo_paths.extend(data.credentials().project_token_repo_paths());

    for repo_path in repo_paths {
        push_remote_config_entries_for_existing_repo(
            &mut entries,
            &data,
            &mut seen_paths,
            &repo_path,
            "bound_repo_remote",
        );
    }

    let sync_config = {
        let engine = na_data::SyncEngine::new(&base_dir);
        engine.config().ok().flatten().map(|config| {
            let local_path = engine.config_repo_path(&config);
            (config, local_path)
        })
    };

    if let Some((config, local_path)) = sync_config {
        if !entries.iter().any(|entry| {
            entry.url == config.url
                && entry
                    .purpose
                    .iter()
                    .any(|purpose| purpose == "data_center_sync")
        }) {
            let (credential_mode, credential_ref) = config_repo_credential_summary(&data);
            let identity = default_commit_identity_config(&data);
            let repo_path = if GitRepo::is_repo(&local_path) {
                Some(local_path.to_string_lossy().to_string())
            } else {
                None
            };
            entries.push(RemoteConfigEntry {
                name: config_repo_remote_name(&config.url),
                url: config.url,
                push_url: None,
                repo_path,
                source: "noteaura_config".to_string(),
                purpose: vec!["data_center_sync".to_string()],
                credential_mode,
                credential_ref,
                commit_name: identity.name,
                commit_email: identity.email,
                verify_status: "configured".to_string(),
                capabilities: "config-sync".to_string(),
            });
        }
    }

    Ok(entries)
}
