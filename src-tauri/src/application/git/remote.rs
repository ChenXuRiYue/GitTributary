//! Git 远程仓库配置命令:列表、聚合视图、clone、增删改、fetch/push/pull。
//!
//! 和 `application::git::commands` 的区别:这里的命令涉及认证解析(`auth::resolve_auth*`)
//! 和凭证绑定(`gt-data` 的 CredentialsRepository),本地 Git commands
//! 只做纯本地仓库操作。

use serde_json::json;
use tauri::State;

use gt_flow::{EventDraft, FlowNodeDefinition};
use gt_git::{AuthMethod, GitRepo, RemoteInfo, RepoOverview};

use crate::application::git::auth::{resolve_auth, validate_project_remote_token};
use crate::{publish_flow_event, set_active_repo_state, AppState};

mod config;

pub(crate) use config::remote_url_for;
use config::{
    collect_remote_configs, delete_remote_commit_identity, maybe_unbind_repo_without_remotes,
    repo_path_for_repo, save_project_remote_config_and_bind_repo, save_project_token_and_bind_repo,
    RemoteConfigEntry,
};

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
mod tests;
