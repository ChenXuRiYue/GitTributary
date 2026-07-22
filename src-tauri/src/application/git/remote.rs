//! Git 远程仓库配置命令:列表、聚合视图、clone、增删改、fetch/push/pull。
//!
//! 和 `application::git::commands` 的区别:这里的命令涉及认证解析(`auth::resolve_auth*`)
//! 和凭证绑定(`gt-data` 的 CredentialsRepository),本地 Git commands
//! 只做纯本地仓库操作。

use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::State;

use gt_data::{DataHub, RemoteCommitIdentity};
use gt_flow::{EventDraft, FlowNodeDefinition};
use gt_git::{AuthMethod, GitRepo, RemoteInfo, RepoOverview};

use crate::application::git::auth::{
    credential_summary_for_remote, resolve_auth, validate_project_remote_token,
};
use crate::application::git::identity::{
    default_commit_identity_config, remote_commit_identity_config,
};
use crate::support::config_dir::store_base_dir;
use crate::{publish_flow_event, set_active_repo_state, AppState};

pub(crate) fn flow_node_definitions() -> Vec<FlowNodeDefinition> {
    vec![FlowNodeDefinition {
        uses: "gittributary/git/push@v1".to_string(),
        name: "推送分支".to_string(),
        node_type: "git".to_string(),
        summary: "把指定仓库分支推送到远程".to_string(),
        description: "使用宿主认证配置将本地分支推送到指定 remote。".to_string(),
        inputs_schema: std::collections::BTreeMap::from([
            ("repo".to_string(), "string".to_string()),
            ("remote".to_string(), "string".to_string()),
            ("branch".to_string(), "string".to_string()),
        ]),
        outputs_schema: std::collections::BTreeMap::from([
            ("remote".to_string(), "string".to_string()),
            ("branch".to_string(), "string".to_string()),
        ]),
    }]
}

#[derive(serde::Serialize)]
pub(crate) struct RemoteConfigEntry {
    name: String,
    url: String,
    push_url: Option<String>,
    repo_path: Option<String>,
    source: String,
    purpose: Vec<String>,
    credential_mode: String,
    credential_ref: Option<String>,
    commit_name: Option<String>,
    commit_email: Option<String>,
    verify_status: String,
    capabilities: String,
}

fn config_repo_credential_summary(data: &DataHub) -> (String, Option<String>) {
    let status = data.credentials().data_center_config_status();
    if status.has_token {
        ("config_repo_token".to_string(), Some(status.credential_ref))
    } else {
        ("none".to_string(), None)
    }
}

fn config_repo_remote_name(url: &str) -> String {
    let trimmed = url.trim_end_matches(".git").trim_end_matches('/');
    let name = trimmed
        .rsplit('/')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("config-repo");
    format!("data-center/{}", name)
}

fn repo_path_for_repo(repo: &GitRepo) -> Result<String, String> {
    repo.workdir()
        .map(|path| path.display().to_string())
        .ok_or_else(|| "无法获取仓库路径".to_string())
}

fn save_project_remote_config_and_bind_repo(
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

fn save_project_token_and_bind_repo(
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

fn maybe_unbind_repo_without_remotes(
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

fn delete_remote_commit_identity(
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
) -> Result<(), String> {
    let repo_path = repo_path.trim();
    if repo_path.is_empty() || !Path::new(repo_path).exists() {
        return Ok(());
    }
    if !seen_paths.insert(repo_path.to_string()) {
        return Ok(());
    }
    match push_remote_config_entries_for_repo(entries, data, repo_path, purpose) {
        Ok(()) => Ok(()),
        Err(_) => Ok(()),
    }
}

/// 获取远程列表
#[tauri::command]
pub(crate) fn get_remotes(state: State<'_, AppState>) -> Result<Vec<RemoteInfo>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.remotes().map_err(|e| e.to_string())
}

/// 获取远程配置的聚合视图。
/// 这里只描述配置状态,不做 fetch/pull/push 等仓库操作。
#[tauri::command]
pub(crate) fn get_remote_configs(
    state: State<'_, AppState>,
) -> Result<Vec<RemoteConfigEntry>, String> {
    collect_remote_configs(&state)
}

fn collect_remote_configs(state: &AppState) -> Result<Vec<RemoteConfigEntry>, String> {
    collect_remote_configs_with_base_dir(state, store_base_dir())
}

fn collect_remote_configs_with_base_dir(
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
        )?;
    }
    if let Some(active_path) = workspace_active_repo.as_deref() {
        push_remote_config_entries_for_existing_repo(
            &mut entries,
            &data,
            &mut seen_paths,
            active_path,
            "current_repo_remote",
        )?;
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
        )?;
    }

    let sync_config = {
        let engine = gt_data::SyncEngine::new(&base_dir);
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
                source: "gittributary_config".to_string(),
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

/// Clone 远程仓库到保存位置下的仓库子目录,成功后自动打开该仓库。
#[tauri::command]
pub(crate) fn clone_remote_repo(
    url: String,
    parent_path: String,
    token: String,
    commit_name: Option<String>,
    commit_email: Option<String>,
    state: State<'_, AppState>,
) -> Result<RepoOverview, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("请先填写 Access Token".to_string());
    }
    validate_project_remote_token(&url, token)?;

    let repo = gt_git::clone_remote_repo_into_parent(
        &url,
        parent_path.trim(),
        &AuthMethod::Token(token.to_string()),
    )
    .map_err(|e| e.to_string())?;
    let repo_path = repo_path_for_repo(&repo)?;
    save_project_remote_config_and_bind_repo(
        &state,
        &repo_path,
        "origin",
        token,
        commit_name.as_deref(),
        commit_email.as_deref(),
    )?;
    set_active_repo_state(repo, &state)
}

/// 添加远程
#[tauri::command]
pub(crate) fn add_remote(
    name: String,
    url: String,
    token: Option<String>,
    commit_name: Option<String>,
    commit_email: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请先填写 Access Token".to_string())?
        .to_string();
    validate_project_remote_token(&url, &token)?;

    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let repo_path = repo_path_for_repo(repo)?;
    repo.add_remote(&name, &url).map_err(|e| e.to_string())?;
    drop(lock);
    if let Err(e) = save_project_remote_config_and_bind_repo(
        &state,
        &repo_path,
        &name,
        &token,
        commit_name.as_deref(),
        commit_email.as_deref(),
    ) {
        let lock = state.repo.lock().unwrap();
        if let Some(repo) = lock.as_ref() {
            let _ = repo.remove_remote(&name);
        }
        return Err(e);
    }
    Ok(())
}

/// 修改远程 URL
#[tauri::command]
pub(crate) fn set_remote_url(
    name: String,
    url: String,
    repo_path: Option<String>,
    token: Option<String>,
    commit_name: Option<String>,
    commit_email: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请先填写 Access Token".to_string())?
        .to_string();
    validate_project_remote_token(&url, &token)?;

    if let Some(path) = repo_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let repo = GitRepo::open(path).map_err(|e| e.to_string())?;
        let previous_url = remote_url_for(&repo, &name)?;
        let repo_path = repo_path_for_repo(&repo)?;
        repo.set_remote_url(&name, &url)
            .map_err(|e| e.to_string())?;
        if let Err(e) = save_project_remote_config_and_bind_repo(
            &state,
            &repo_path,
            &name,
            &token,
            commit_name.as_deref(),
            commit_email.as_deref(),
        ) {
            let _ = repo.set_remote_url(&name, &previous_url);
            return Err(e);
        }
        return Ok(());
    }

    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let previous_url = remote_url_for(repo, &name)?;
    let repo_path = repo_path_for_repo(repo)?;
    repo.set_remote_url(&name, &url)
        .map_err(|e| e.to_string())?;
    drop(lock);
    if let Err(e) = save_project_remote_config_and_bind_repo(
        &state,
        &repo_path,
        &name,
        &token,
        commit_name.as_deref(),
        commit_email.as_deref(),
    ) {
        let lock = state.repo.lock().unwrap();
        if let Some(repo) = lock.as_ref() {
            let _ = repo.set_remote_url(&name, &previous_url);
        }
        return Err(e);
    }
    Ok(())
}

/// 删除远程
#[tauri::command]
pub(crate) fn remove_remote(
    name: String,
    repo_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(path) = repo_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let repo = GitRepo::open(path).map_err(|e| e.to_string())?;
        let repo_path = repo_path_for_repo(&repo)?;
        repo.remove_remote(&name).map_err(|e| e.to_string())?;
        delete_remote_commit_identity(&state, &repo_path, &name)?;
        let has_remotes = !repo.remotes().map_err(|e| e.to_string())?.is_empty();
        maybe_unbind_repo_without_remotes(&state, &repo_path, has_remotes)?;
        return Ok(());
    }

    let (repo_path, has_remotes) = {
        let lock = state.repo.lock().unwrap();
        let repo = lock.as_ref().ok_or("尚未打开仓库")?;
        let repo_path = repo_path_for_repo(repo)?;
        repo.remove_remote(&name).map_err(|e| e.to_string())?;
        delete_remote_commit_identity(&state, &repo_path, &name)?;
        let has_remotes = !repo.remotes().map_err(|e| e.to_string())?.is_empty();
        (repo_path, has_remotes)
    };
    maybe_unbind_repo_without_remotes(&state, &repo_path, has_remotes)
}

/// Fetch
#[tauri::command]
pub(crate) fn git_fetch(remote: String, state: State<'_, AppState>) -> Result<(), String> {
    let auth = resolve_auth(&state);
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.fetch(&remote, &auth).map_err(|e| e.to_string())
}

/// Push 当前分支
#[tauri::command]
pub(crate) fn git_push(
    remote: String,
    branch: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth = resolve_auth(&state);
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let repo_path = repo
        .workdir()
        .map(|path| path.to_string_lossy().to_string());
    repo.push(&remote, &branch, &auth)
        .map_err(|e| e.to_string())?;
    drop(lock);
    if let Some(repo_path) = repo_path {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                source: "gittributary://gt-git".to_string(),
                event_type: "git.push.completed".to_string(),
                subject: Some(format!("repo:{repo_path}")),
                data: json!({
                    "repo": repo_path,
                    "branch": branch,
                    "remote": remote,
                }),
            },
        );
    }
    Ok(())
}

/// Pull(fetch + fast-forward)
#[tauri::command]
pub(crate) fn git_pull(
    remote: String,
    branch: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let auth = resolve_auth(&state);
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.pull(&remote, &branch, &auth)
        .map_err(|e| e.to_string())
}

/// 设置项目级 token(存入 private.credentials 命名空间)
#[tauri::command]
pub(crate) fn set_project_token(
    token: String,
    repo_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo_path = repo_path.trim();
    if repo_path.is_empty() {
        return Err("项目 Token 必须绑定一个本地 repo 路径".to_string());
    }

    let repo = GitRepo::open(repo_path).map_err(|e| e.to_string())?;
    let repo_path = repo_path_for_repo(&repo)?;
    save_project_token_and_bind_repo(&state, &repo_path, &token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use gt_flow::{EventPool, FlowNodeRegistry};
    use tempfile::TempDir;

    fn temp_store() -> (TempDir, DataHub) {
        let dir = TempDir::new().unwrap();
        let data = DataHub::open(dir.path()).unwrap();
        (dir, data)
    }

    fn temp_app_state() -> (TempDir, AppState) {
        let (dir, store) = temp_store();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            data: std::sync::Mutex::new(store),
            event_pool: std::sync::Mutex::new(EventPool::new()),
            node_registry: std::sync::Mutex::new(FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: crate::application::plugins::registry::ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(
                crate::application::plugins::host::PluginHostSupervisor::default(),
            ),
        };
        (dir, state)
    }

    fn init_repo_with_commit(dir: &Path) -> GitRepo {
        let repo = GitRepo::init(dir).unwrap();
        std::fs::write(dir.join("README.md"), "# hi\n").unwrap();
        repo.stage_all().unwrap();
        repo.commit("init: first commit").unwrap();
        repo
    }

    // --- config repo naming ------------------------------------------------

    #[test]
    fn config_repo_remote_name_strips_git_suffix() {
        assert_eq!(
            config_repo_remote_name("https://github.com/user/gt-config.git"),
            "data-center/gt-config"
        );
    }

    #[test]
    fn config_repo_remote_name_handles_trailing_slash() {
        assert_eq!(
            config_repo_remote_name("https://github.com/user/gt-config/"),
            "data-center/gt-config"
        );
    }

    #[test]
    fn config_repo_remote_name_falls_back_when_empty() {
        assert_eq!(config_repo_remote_name(""), "data-center/config-repo");
    }

    // --- repo helpers -----------------------------------------------------

    #[test]
    fn repo_path_for_repo_returns_workdir() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(dir.path());
        let path = repo_path_for_repo(&repo).unwrap();
        // Compare canonicalized paths: on macOS `TempDir` paths often resolve
        // through a `/private` symlink, so raw string equality is unreliable.
        assert_eq!(
            Path::new(&path).canonicalize().unwrap(),
            dir.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn remote_url_for_returns_error_when_missing() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(dir.path());
        let err = remote_url_for(&repo, "origin").unwrap_err();
        assert!(err.contains("origin"));
    }

    #[test]
    fn remote_url_for_returns_url_when_present() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(dir.path());
        repo.add_remote("origin", "https://github.com/a/b.git")
            .unwrap();
        assert_eq!(
            remote_url_for(&repo, "origin").unwrap(),
            "https://github.com/a/b.git"
        );
    }

    #[test]
    fn collect_remote_configs_includes_workspace_active_repo() {
        let (dir, state) = temp_app_state();
        let repo = init_repo_with_commit(dir.path());
        repo.add_remote("origin", "https://github.com/a/b.git")
            .unwrap();
        {
            let mut store = state.data.lock().unwrap();
            store
                .workspace_mut()
                .set_active_repo(&dir.path().display().to_string())
                .unwrap();
        }

        let entries = collect_remote_configs(&state).unwrap();

        let origin = entries
            .iter()
            .find(|entry| entry.name == "origin" && entry.url == "https://github.com/a/b.git")
            .unwrap();
        assert!(origin
            .purpose
            .iter()
            .any(|purpose| purpose == "current_repo_remote"));
    }

    #[test]
    fn collect_remote_configs_skips_non_git_workspace_active_repo() {
        let (dir, state) = temp_app_state();
        let non_git_path = dir.path().display().to_string();
        {
            let mut store = state.data.lock().unwrap();
            store
                .workspace_mut()
                .set_active_repo(&non_git_path)
                .unwrap();
        }

        let entries = collect_remote_configs(&state).unwrap();

        assert!(!entries
            .iter()
            .any(|entry| entry.repo_path.as_deref() == Some(non_git_path.as_str())));
    }

    #[test]
    fn collect_remote_configs_keeps_valid_repos_when_bound_repo_is_invalid() {
        let (_store_dir, state) = temp_app_state();
        let valid_dir = TempDir::new().unwrap();
        let invalid_dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(valid_dir.path());
        repo.add_remote("origin", "https://github.com/a/b.git")
            .unwrap();
        {
            let mut store = state.data.lock().unwrap();
            store
                .workspace_mut()
                .bind_repo(&invalid_dir.path().display().to_string())
                .unwrap();
            store
                .workspace_mut()
                .bind_repo(&valid_dir.path().display().to_string())
                .unwrap();
        }

        let entries = collect_remote_configs(&state).unwrap();

        assert!(entries
            .iter()
            .any(|entry| entry.name == "origin" && entry.url == "https://github.com/a/b.git"));
    }

    #[test]
    fn collect_remote_configs_includes_config_repo_local_path_when_checkout_exists() {
        let (store_dir, state) = temp_app_state();
        let checkout_dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(checkout_dir.path());
        repo.add_remote("origin", "https://github.com/a/config.git")
            .unwrap();
        let engine = gt_data::SyncEngine::new(store_dir.path());
        engine
            .set_config(&gt_data::SyncConfig {
                url: "https://github.com/a/config.git".to_string(),
                branch: "main".to_string(),
                active_environment_id: None,
                local_database_path: Some(checkout_dir.path().to_path_buf()),
                auto_sync: true,
                interval_seconds: 300,
            })
            .unwrap();

        let entries =
            collect_remote_configs_with_base_dir(&state, store_dir.path().to_path_buf()).unwrap();

        let config = entries
            .iter()
            .find(|entry| entry.url == "https://github.com/a/config.git")
            .unwrap();
        assert_eq!(
            config.repo_path.as_deref(),
            Some(checkout_dir.path().to_string_lossy().as_ref())
        );
        assert!(config
            .purpose
            .iter()
            .any(|purpose| purpose == "data_center_sync"));
    }

    // --- store persistence via helpers -------------------------------------

    #[test]
    fn save_project_remote_config_and_bind_repo_persists_token_identity_and_binding() {
        let (dir, state) = temp_app_state();
        let repo_path = dir.path().display().to_string();

        save_project_remote_config_and_bind_repo(
            &state,
            &repo_path,
            "origin",
            "tok",
            Some("Alice"),
            Some("alice@example.com"),
        )
        .unwrap();

        let store = state.data.lock().unwrap();
        let token = store.credentials().project_token(&repo_path);
        assert_eq!(token, Some("tok".to_string()));
        assert!(store
            .workspace()
            .snapshot()
            .bound_repos
            .contains(&repo_path));

        let identity = remote_commit_identity_config(&store, &repo_path, "origin").unwrap();
        assert_eq!(identity.name, Some("Alice".to_string()));
        assert_eq!(identity.email, Some("alice@example.com".to_string()));
    }

    #[test]
    fn save_project_remote_config_and_bind_repo_clears_identity_when_omitted() {
        let (dir, state) = temp_app_state();
        let repo_path = dir.path().display().to_string();

        save_project_remote_config_and_bind_repo(&state, &repo_path, "origin", "tok", None, None)
            .unwrap();

        let store = state.data.lock().unwrap();
        assert!(remote_commit_identity_config(&store, &repo_path, "origin").is_none());
    }

    #[test]
    fn maybe_unbind_repo_without_remotes_unbinds_when_no_remotes_left() {
        let (dir, state) = temp_app_state();
        let repo_path = dir.path().display().to_string();
        {
            let mut store = state.data.lock().unwrap();
            store.workspace_mut().bind_repo(&repo_path).unwrap();
        }
        maybe_unbind_repo_without_remotes(&state, &repo_path, false).unwrap();
        let store = state.data.lock().unwrap();
        assert!(!store
            .workspace()
            .snapshot()
            .bound_repos
            .contains(&repo_path));
    }

    #[test]
    fn maybe_unbind_repo_without_remotes_keeps_binding_when_remotes_exist() {
        let (dir, state) = temp_app_state();
        let repo_path = dir.path().display().to_string();
        {
            let mut store = state.data.lock().unwrap();
            store.workspace_mut().bind_repo(&repo_path).unwrap();
        }
        maybe_unbind_repo_without_remotes(&state, &repo_path, true).unwrap();
        let store = state.data.lock().unwrap();
        assert!(store
            .workspace()
            .snapshot()
            .bound_repos
            .contains(&repo_path));
    }
}
