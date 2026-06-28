use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use gt_flow::{
    CloudEvent, EventDefinition, EventDraft, EventPool, EventReceipt, FlowActionExecutor,
    FlowActionOutcome, FlowBuildDraft, FlowBuildRequest, FlowExecutionContext, FlowNodeDefinition,
    FlowNodeRegistry, FlowNodeSpec, FlowRecord, FlowRunReport, FlowRunRequest, FlowSummary,
};
use gt_git::{
    AuthMethod, BranchInfo, CommitInfo, FileDiff, FileStatus, GitRepo, LogEntry, RemoteInfo,
    RepoOverview,
};
use gt_store::Store;
use serde_json::{json, Value};
use tauri::{Manager, State};

/// 应用状态
pub struct AppState {
    pub repo: Mutex<Option<GitRepo>>,
    pub store: Mutex<Store>,
    pub event_pool: Mutex<EventPool>,
    pub node_registry: Mutex<FlowNodeRegistry>,
}

/// 打开一个 Git 仓库并返回概况
#[tauri::command]
fn open_repo(path: String, state: State<'_, AppState>) -> Result<RepoOverview, String> {
    let repo = GitRepo::open(&path).map_err(|e| e.to_string())?;
    set_active_repo_state(repo, &state)
}

/// 获取仓库概况(需已打开)
#[tauri::command]
fn get_overview(state: State<'_, AppState>) -> Result<RepoOverview, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.overview().map_err(|e| e.to_string())
}

/// 获取变更文件列表
#[tauri::command]
fn get_status(state: State<'_, AppState>) -> Result<Vec<FileStatus>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.status().map_err(|e| e.to_string())
}

/// 暂存所有变更
#[tauri::command]
fn stage_all(state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.stage_all().map_err(|e| e.to_string())
}

/// 暂存指定文件
#[tauri::command]
fn stage_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let path_refs: Vec<&std::path::Path> = paths
        .iter()
        .map(|p| std::path::Path::new(p.as_str()))
        .collect();
    repo.stage_files(&path_refs).map_err(|e| e.to_string())
}

/// 暂存所有并提交
#[tauri::command]
fn commit_all(message: String, state: State<'_, AppState>) -> Result<CommitInfo, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let repo_path = repo
        .workdir()
        .map(|path| path.to_string_lossy().to_string());
    let branch = repo.current_branch().unwrap_or_else(|_| "HEAD".to_string());
    repo.stage_all().map_err(|e| e.to_string())?;
    let commit = repo.commit(&message).map_err(|e| e.to_string())?;
    drop(lock);
    if let Some(repo_path) = repo_path {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                source: "gittributary://gt-git".to_string(),
                event_type: "git.commit.created".to_string(),
                subject: Some(format!("repo:{repo_path}")),
                data: json!({
                    "repo": repo_path,
                    "branch": branch,
                    "commit": commit.id.clone(),
                }),
            },
        );
    }
    Ok(commit)
}

/// 暂存指定文件并提交
#[tauri::command]
fn commit_selected(
    paths: Vec<String>,
    message: String,
    state: State<'_, AppState>,
) -> Result<CommitInfo, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let repo_path = repo
        .workdir()
        .map(|path| path.to_string_lossy().to_string());
    let branch = repo.current_branch().unwrap_or_else(|_| "HEAD".to_string());
    let path_refs: Vec<&std::path::Path> = paths
        .iter()
        .map(|p| std::path::Path::new(p.as_str()))
        .collect();
    repo.stage_files(&path_refs).map_err(|e| e.to_string())?;
    let commit = repo.commit(&message).map_err(|e| e.to_string())?;
    drop(lock);
    if let Some(repo_path) = repo_path {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                source: "gittributary://gt-git".to_string(),
                event_type: "git.commit.created".to_string(),
                subject: Some(format!("repo:{repo_path}")),
                data: json!({
                    "repo": repo_path,
                    "branch": branch,
                    "commit": commit.id.clone(),
                }),
            },
        );
    }
    Ok(commit)
}

/// 获取单个文件的 diff
#[tauri::command]
fn get_file_diff(path: String, state: State<'_, AppState>) -> Result<FileDiff, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.diff_file(&path).map_err(|e| e.to_string())
}

// ─── Branch commands ──────────────────────────────────────────────────

/// 获取本地分支列表
#[tauri::command]
fn get_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.local_branches().map_err(|e| e.to_string())
}

/// 创建新分支
#[tauri::command]
fn create_branch(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.create_branch(&name).map_err(|e| e.to_string())
}

/// 切换分支
#[tauri::command]
fn checkout_branch(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.checkout_branch(&name).map_err(|e| e.to_string())?;
    // 同步分支状态到 store
    drop(lock);
    let mut store = state.store.lock().unwrap();
    let _ = store.sync_workspace(None, Some(&name));
    Ok(())
}

/// 删除分支
#[tauri::command]
fn delete_branch(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.delete_branch(&name).map_err(|e| e.to_string())
}

// ─── Log commands ─────────────────────────────────────────────────────

/// 获取提交历史(默认 100 条)
#[tauri::command]
fn get_log(limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<LogEntry>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.log(limit.unwrap_or(100)).map_err(|e| e.to_string())
}

/// 获取指定分支的提交历史
#[tauri::command]
fn get_branch_log(
    branch: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<LogEntry>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.log_branch(&branch, limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

/// 获取某次提交涉及的变更文件列表
#[tauri::command]
fn get_commit_files(
    commit_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileStatus>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.commit_files(&commit_id).map_err(|e| e.to_string())
}

/// 获取某次提交中指定文件的 diff
#[tauri::command]
fn get_commit_file_diff(
    commit_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<FileDiff, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.commit_file_diff(&commit_id, &path)
        .map_err(|e| e.to_string())
}

// ─── Remote commands ──────────────────────────────────────────────────

/// 解析认证方式:项目级 token 优先 → 公共级 token → SSH → Agent → None
fn resolve_auth(state: &AppState) -> AuthMethod {
    let store = state.store.lock().unwrap();
    let repo_lock = state.repo.lock().unwrap();

    // 1. 项目级 token(从当前仓库路径对应的 store key)
    if let Some(repo) = repo_lock.as_ref() {
        if let Some(workdir) = repo.workdir() {
            let project_key = format!("project.{}.token", workdir.display());
            if let Some(val) = store.get("private.credentials", &project_key) {
                if let Some(token) = val.as_str() {
                    if !token.is_empty() {
                        return AuthMethod::Token(token.to_string());
                    }
                }
            }
        }
    }

    // 2. 公共级 token
    if let Some(token) = store.get_git_token_raw() {
        if !token.is_empty() {
            return AuthMethod::Token(token);
        }
    }

    // 3. SSH key
    if let Some((key_path, passphrase)) = store.get_git_ssh_key() {
        return AuthMethod::SshKey {
            private_key: key_path,
            passphrase,
        };
    }

    // 4. 尝试 SSH agent
    AuthMethod::Agent
}

/// 获取远程列表
#[tauri::command]
fn get_remotes(state: State<'_, AppState>) -> Result<Vec<RemoteInfo>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.remotes().map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct RemoteConfigEntry {
    name: String,
    url: String,
    push_url: Option<String>,
    repo_path: Option<String>,
    source: String,
    purpose: Vec<String>,
    credential_mode: String,
    credential_ref: Option<String>,
    verify_status: String,
    capabilities: String,
}

fn credential_summary_for_remote(
    store: &Store,
    workdir: Option<&str>,
    url: &str,
) -> (String, Option<String>) {
    if let Some(path) = workdir {
        let project_key = format!("project.{}.token", path);
        if let Some(val) = store.get("private.credentials", &project_key) {
            if val.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
                return ("repo_token".to_string(), Some(format!("repo:{}", path)));
            }
        }
    }

    if let Some(token) = store.get_git_token_raw() {
        if !token.is_empty() {
            return (
                "app_global_token".to_string(),
                Some("global:git.access_token".to_string()),
            );
        }
    }

    if let Some((key_path, _)) = store.get_git_ssh_key() {
        return ("ssh_key".to_string(), Some(format!("ssh:{}", key_path)));
    }

    if url.starts_with("git@") || url.starts_with("ssh://") {
        return (
            "ssh_agent".to_string(),
            Some("system:ssh-agent".to_string()),
        );
    }

    (
        "system".to_string(),
        Some("system:credential-helper".to_string()),
    )
}

fn config_repo_credential_summary(store: &Store) -> (String, Option<String>) {
    let status = store.get_data_center_config_credential_status();
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

fn classify_project_remote_check_error(error: &str) -> (String, String) {
    let lower = error.to_lowercase();
    if lower.contains("authentication")
        || lower.contains("auth")
        || lower.contains("credential")
        || lower.contains("401")
        || lower.contains("403")
    {
        return (
            "auth_failed".to_string(),
            "认证失败,请检查 Access Token 权限".to_string(),
        );
    }
    if lower.contains("not found")
        || lower.contains("404")
        || lower.contains("repository not found")
    {
        return (
            "not_found".to_string(),
            "仓库不存在或当前 Token 无权访问".to_string(),
        );
    }
    if lower.contains("resolve")
        || lower.contains("network")
        || lower.contains("timeout")
        || lower.contains("couldn't connect")
        || lower.contains("failed to connect")
    {
        return (
            "network_failed".to_string(),
            "网络连接失败,请检查网络或代理".to_string(),
        );
    }

    ("invalid".to_string(), error.to_string())
}

fn validate_project_remote_token(url: &str, token: &str) -> Result<(), String> {
    let normalized_url = url.trim();
    if !normalized_url.starts_with("https://") {
        return Err("remote 使用 Token 校验时请填写 HTTPS URL".to_string());
    }

    let token = token.trim();
    if token.is_empty() {
        return Err("请先填写 Access Token".to_string());
    }

    match gt_git::check_remote_access(normalized_url, &AuthMethod::Token(token.to_string())) {
        Ok(_) => Ok(()),
        Err(e) => {
            let (_, message) = classify_project_remote_check_error(&e.to_string());
            Err(message)
        }
    }
}

fn repo_path_for_repo(repo: &GitRepo) -> Result<String, String> {
    repo.workdir()
        .map(|path| path.display().to_string())
        .ok_or_else(|| "无法获取仓库路径".to_string())
}

fn project_token_key_for_path(path: &str) -> String {
    format!("project.{}.token", path)
}

fn repo_path_from_project_token_key(key: &str) -> Option<String> {
    key.strip_prefix("project.")
        .and_then(|path| path.strip_suffix(".token"))
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string)
}

fn save_project_token_and_bind_repo(
    state: &State<'_, AppState>,
    repo_path: &str,
    token: &str,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store
        .set(
            "private.credentials",
            &project_token_key_for_path(repo_path),
            serde_json::json!(token),
        )
        .map_err(|e| e.to_string())?;
    store.bind_repo(repo_path).map_err(|e| e.to_string())
}

fn remote_url_for(repo: &GitRepo, name: &str) -> Result<String, String> {
    repo.remotes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|remote| remote.name == name)
        .map(|remote| remote.url)
        .ok_or_else(|| format!("远程 '{}' 不存在", name))
}

fn maybe_unbind_repo_without_remotes(
    state: &State<'_, AppState>,
    repo_path: &str,
    has_remotes: bool,
) -> Result<(), String> {
    if !has_remotes {
        let mut store = state.store.lock().unwrap();
        store.unbind_repo(repo_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn set_active_repo_state(
    repo: GitRepo,
    state: &State<'_, AppState>,
) -> Result<RepoOverview, String> {
    let overview = repo.overview().map_err(|e| e.to_string())?;
    let branch = overview.current_branch.clone();
    let repo_path = overview.path.to_string_lossy().to_string();
    {
        let mut repo_lock = state.repo.lock().unwrap();
        *repo_lock = Some(repo);
    }
    {
        let mut store = state.store.lock().unwrap();
        let _ = store.sync_workspace(Some(&repo_path), Some(&branch));
    }
    let _ = publish_flow_event(
        state,
        EventDraft {
            source: "gittributary://gt-git".to_string(),
            event_type: "git.repo.opened".to_string(),
            subject: Some(format!("repo:{repo_path}")),
            data: json!({
                "repo": repo_path,
                "branch": branch,
            }),
        },
    );
    Ok(overview)
}

fn push_remote_config_entries_for_repo(
    entries: &mut Vec<RemoteConfigEntry>,
    store: &Store,
    repo_path: &str,
    purpose: &str,
) -> Result<(), String> {
    let repo = GitRepo::open(repo_path).map_err(|e| e.to_string())?;
    for remote in repo.remotes().map_err(|e| e.to_string())? {
        let (credential_mode, credential_ref) =
            credential_summary_for_remote(store, Some(repo_path), &remote.url);
        entries.push(RemoteConfigEntry {
            name: remote.name,
            url: remote.url,
            push_url: remote.push_url,
            repo_path: Some(repo_path.to_string()),
            source: "local_git_config".to_string(),
            purpose: vec![purpose.to_string()],
            credential_mode,
            credential_ref,
            verify_status: "unverified".to_string(),
            capabilities: "unknown".to_string(),
        });
    }
    Ok(())
}

/// 获取远程配置的聚合视图。
/// 这里只描述配置状态,不做 fetch/pull/push 等仓库操作。
#[tauri::command]
fn get_remote_configs(state: State<'_, AppState>) -> Result<Vec<RemoteConfigEntry>, String> {
    let active_workdir = {
        let lock = state.repo.lock().unwrap();
        lock.as_ref()
            .and_then(|repo| repo.workdir().map(|p| p.display().to_string()))
    };

    let store = state.store.lock().unwrap();
    let mut entries: Vec<RemoteConfigEntry> = Vec::new();
    let mut repo_paths = store.bound_repos();
    repo_paths.extend(
        store
            .scan("private.credentials", "project.")
            .into_iter()
            .filter_map(|(key, value)| {
                if !value.as_str().map(|token| !token.is_empty()).unwrap_or(false) {
                    return None;
                }
                repo_path_from_project_token_key(&key)
            }),
    );

    let mut seen_paths = std::collections::HashSet::new();
    for repo_path in repo_paths {
        let repo_path = repo_path.trim();
        if repo_path.is_empty() || !seen_paths.insert(repo_path.to_string()) {
            continue;
        }
        if Path::new(repo_path).exists() {
            push_remote_config_entries_for_repo(
                &mut entries,
                &store,
                repo_path,
                "bound_repo_remote",
            )?;
        }
    }

    if let Some(active_path) = active_workdir.as_deref() {
        if !seen_paths.contains(active_path) && Path::new(active_path).exists() {
            push_remote_config_entries_for_repo(
                &mut entries,
                &store,
                active_path,
                "current_repo_remote",
            )?;
        }
    }

    let sync_config = {
        let base_dir = store_base_dir();
        let engine = gt_store::SyncEngine::new(&base_dir);
        engine.config().ok().flatten()
    };

    if let Some(config) = sync_config {
        if !entries.iter().any(|entry| {
            entry.url == config.url
                && entry
                    .purpose
                    .iter()
                    .any(|purpose| purpose == "data_center_sync")
        }) {
            let (credential_mode, credential_ref) = config_repo_credential_summary(&store);
            entries.push(RemoteConfigEntry {
                name: config_repo_remote_name(&config.url),
                url: config.url,
                push_url: None,
                repo_path: None,
                source: "gittributary_config".to_string(),
                purpose: vec!["data_center_sync".to_string()],
                credential_mode,
                credential_ref,
                verify_status: "configured".to_string(),
                capabilities: "config-sync".to_string(),
            });
        }
    }

    Ok(entries)
}

/// Clone 远程仓库到保存位置下的仓库子目录,成功后自动打开该仓库。
#[tauri::command]
fn clone_remote_repo(
    url: String,
    parent_path: String,
    token: String,
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
    save_project_token_and_bind_repo(&state, &repo_path, token)?;
    set_active_repo_state(repo, &state)
}

/// 添加远程
#[tauri::command]
fn add_remote(
    name: String,
    url: String,
    token: Option<String>,
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
    if let Err(e) = save_project_token_and_bind_repo(&state, &repo_path, &token) {
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
fn set_remote_url(
    name: String,
    url: String,
    repo_path: Option<String>,
    token: Option<String>,
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
        repo.set_remote_url(&name, &url).map_err(|e| e.to_string())?;
        if let Err(e) = save_project_token_and_bind_repo(&state, &repo_path, &token) {
            let _ = repo.set_remote_url(&name, &previous_url);
            return Err(e);
        }
        return Ok(());
    }

    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let previous_url = remote_url_for(repo, &name)?;
    let repo_path = repo_path_for_repo(repo)?;
    repo.set_remote_url(&name, &url).map_err(|e| e.to_string())
        ?;
    drop(lock);
    if let Err(e) = save_project_token_and_bind_repo(&state, &repo_path, &token) {
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
fn remove_remote(
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
        let has_remotes = !repo.remotes().map_err(|e| e.to_string())?.is_empty();
        maybe_unbind_repo_without_remotes(&state, &repo_path, has_remotes)?;
        return Ok(());
    }

    let (repo_path, has_remotes) = {
        let lock = state.repo.lock().unwrap();
        let repo = lock.as_ref().ok_or("尚未打开仓库")?;
        let repo_path = repo_path_for_repo(repo)?;
        repo.remove_remote(&name).map_err(|e| e.to_string())?;
        let has_remotes = !repo.remotes().map_err(|e| e.to_string())?.is_empty();
        (repo_path, has_remotes)
    };
    maybe_unbind_repo_without_remotes(&state, &repo_path, has_remotes)
}

/// Fetch
#[tauri::command]
fn git_fetch(remote: String, state: State<'_, AppState>) -> Result<(), String> {
    let auth = resolve_auth(&state);
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.fetch(&remote, &auth).map_err(|e| e.to_string())
}

/// Push 当前分支
#[tauri::command]
fn git_push(remote: String, branch: String, state: State<'_, AppState>) -> Result<(), String> {
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
fn git_pull(remote: String, branch: String, state: State<'_, AppState>) -> Result<(), String> {
    let auth = resolve_auth(&state);
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.pull(&remote, &branch, &auth)
        .map_err(|e| e.to_string())
}

/// 设置项目级 token(存入 private.credentials 命名空间)
#[tauri::command]
fn set_project_token(
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

// ─── Store commands ───────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct NamespaceInfo {
    name: String,
    count: usize,
    visibility: String, // "public" | "private"
}

#[derive(serde::Serialize)]
struct KvEntry {
    key: String,
    value: Value,
}

#[derive(serde::Serialize)]
struct FlowListItem {
    id: String,
    key: String,
    summary: FlowSummary,
    enabled: bool,
    folder: String,
    created_at: String,
    updated_at: String,
}

#[derive(serde::Deserialize)]
struct FlowSaveRequest {
    workflow: String,
    folder: Option<String>,
}

fn flow_record_from_store_value(value: Value) -> Result<FlowRecord, String> {
    gt_flow::record_from_value(value).map_err(|e| e.to_string())
}

fn flow_record_to_store_value(record: &FlowRecord) -> Result<Value, String> {
    gt_flow::record_to_value(record).map_err(|e| e.to_string())
}

fn flow_records_from_store(store: &Store) -> Vec<FlowRecord> {
    store
        .scan(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_KEY_PREFIX)
        .into_iter()
        .filter_map(|(_, value)| flow_record_from_store_value(value).ok())
        .collect()
}

fn publish_flow_event(
    state: &State<'_, AppState>,
    event: EventDraft,
) -> Result<EventReceipt, String> {
    let flows = {
        let store = state.store.lock().unwrap();
        flow_records_from_store(&store)
    };
    let mut event_pool = state.event_pool.lock().unwrap();
    event_pool
        .publish(event, &flows)
        .map_err(|error| error.to_string())
}

fn match_flow_event(
    state: &State<'_, AppState>,
    event: EventDraft,
) -> Result<EventReceipt, String> {
    let flows = {
        let store = state.store.lock().unwrap();
        flow_records_from_store(&store)
    };
    let event_pool = state.event_pool.lock().unwrap();
    event_pool
        .match_event(event, &flows)
        .map_err(|error| error.to_string())
}

fn workspace_context_from_store(store: &Store) -> Value {
    json!({
        "active_repo": store.active_repo(),
        "active_branch": store.active_branch(),
        "device_id": store.device_id(),
        "device_name": store.device_name(),
    })
}

fn sync_data_center_now(state: &AppState) -> Result<String, String> {
    let (device_id, token) = {
        let store = state.store.lock().unwrap();
        let config = {
            let base_dir = store_base_dir();
            let engine = gt_store::SyncEngine::new(&base_dir);
            engine.config().map_err(|e| e.to_string())?
        }
        .ok_or_else(|| "未配置同步远程仓库".to_string())?;
        let token = require_config_repo_url_and_token(&store, &config.url)?;
        (
            store.device_id().unwrap_or_else(|| "unknown".to_string()),
            token,
        )
    };

    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    let auth = gt_store::ConfigRepoAuth { token: &token };
    let checkout = engine
        .ensure_config_repo(&auth)
        .map_err(|e| e.to_string())?;
    engine.pull(&auth, &checkout).map_err(|e| e.to_string())?;
    {
        let mut store = state.store.lock().unwrap();
        engine
            .import_public_from_checkout(&mut store, &checkout)
            .map_err(|e| e.to_string())?;
        engine
            .export_public_to_checkout(&store, &checkout)
            .map_err(|e| e.to_string())?;
    }
    engine
        .commit(&device_id, &checkout)
        .map_err(|e| e.to_string())?;
    engine.push(&auth, &checkout).map_err(|e| e.to_string())?;
    Ok("同步完成".to_string())
}

struct AppFlowActionExecutor<'a> {
    state: &'a AppState,
}

impl<'a> AppFlowActionExecutor<'a> {
    fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl FlowActionExecutor for AppFlowActionExecutor<'_> {
    fn execute(
        &mut self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let outcome = match node.uses.as_str() {
            "gittributary/workspace/resolve-publish-context@v1" => {
                self.resolve_publish_context(inputs, context)
            }
            "gittributary/notes/build-html@v1" => self.build_html_placeholder(inputs),
            "gittributary/files/assert-exists@v1" => self.assert_exists(inputs),
            "gittributary/files/sync-dir@v1" => self.sync_dir(inputs),
            "gittributary/git/commit-all@v1" => self.commit_all(inputs),
            "gittributary/git/push@v1" => self.push(inputs),
            "gittributary/store/sync-now@v1" => self.sync_store(),
            "gittributary/ui/notify@v1" => Ok(FlowActionOutcome {
                outputs: json!({}),
                skipped: false,
                message: Some(format!(
                    "{}: {}",
                    inputs.get("title").cloned().unwrap_or_default(),
                    inputs.get("message").cloned().unwrap_or_default()
                )),
            }),
            _ => Err(gt_flow::FlowError::Validation(format!(
                "节点动作未实现: {}",
                node.uses
            ))),
        }?;
        Ok(outcome)
    }
}

impl AppFlowActionExecutor<'_> {
    fn resolve_publish_context(
        &self,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let workspace_repo = context
            .workspace
            .get("active_repo")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let workspace_branch = context
            .workspace
            .get("active_branch")
            .and_then(Value::as_str)
            .unwrap_or("main");
        let source_repo = input_or_default(inputs, "source_repo", workspace_repo);
        let target_repo = input_or_default(inputs, "target_repo", &source_repo);
        let target_branch = input_or_default(inputs, "target_branch", workspace_branch);
        let output_dir = PathBuf::from(&source_repo)
            .join(".gittributary")
            .join("output")
            .to_string_lossy()
            .to_string();
        Ok(FlowActionOutcome {
            outputs: json!({
                "source_repo": source_repo,
                "target_repo": target_repo,
                "target_branch": target_branch,
                "output_dir": output_dir,
            }),
            skipped: false,
            message: Some("context_resolved".to_string()),
        })
    }

    fn build_html_placeholder(
        &self,
        inputs: &BTreeMap<String, String>,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let output = require_input(inputs, "output")?;
        Ok(FlowActionOutcome {
            outputs: json!({ "html_dir": output }),
            skipped: false,
            message: Some("build_html_placeholder".to_string()),
        })
    }

    fn assert_exists(
        &self,
        inputs: &BTreeMap<String, String>,
    ) -> gt_flow::Result<FlowActionOutcome> {
        let path = require_input(inputs, "path")?;
        let non_empty = inputs
            .get("non_empty")
            .map(|value| value == "true")
            .unwrap_or(false);
        let path_ref = Path::new(&path);
        if !path_ref.exists() {
            return Err(gt_flow::FlowError::Validation(format!(
                "路径不存在: {}",
                path
            )));
        }
        if non_empty && is_empty_path(path_ref).map_err(to_validation_error)? {
            return Err(gt_flow::FlowError::Validation(format!(
                "路径为空: {}",
                path
            )));
        }
        Ok(FlowActionOutcome {
            outputs: json!({ "path": path }),
            skipped: false,
            message: Some("path_exists".to_string()),
        })
    }

    fn sync_dir(&self, inputs: &BTreeMap<String, String>) -> gt_flow::Result<FlowActionOutcome> {
        let from = require_input(inputs, "from")?;
        let to = require_input(inputs, "to")?;
        let changed_count =
            copy_dir_recursive(Path::new(&from), Path::new(&to)).map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "changed_count": changed_count }),
            skipped: false,
            message: Some(format!("synced {changed_count} files")),
        })
    }

    fn commit_all(&self, inputs: &BTreeMap<String, String>) -> gt_flow::Result<FlowActionOutcome> {
        let repo_path = require_input(inputs, "repo")?;
        let message = require_input(inputs, "message")?;
        let repo = GitRepo::open(&repo_path).map_err(to_validation_error)?;
        let branch = repo.current_branch().unwrap_or_else(|_| "HEAD".to_string());
        repo.stage_all().map_err(to_validation_error)?;
        match repo.commit(&message) {
            Ok(commit) => Ok(FlowActionOutcome {
                outputs: json!({ "commit": commit.id, "branch": branch }),
                skipped: false,
                message: Some("committed".to_string()),
            }),
            Err(gt_git::GitError::NothingToCommit) => Ok(FlowActionOutcome {
                outputs: json!({ "commit": Value::Null, "branch": branch }),
                skipped: true,
                message: Some("nothing_to_commit".to_string()),
            }),
            Err(error) => Err(to_validation_error(error)),
        }
    }

    fn push(&self, inputs: &BTreeMap<String, String>) -> gt_flow::Result<FlowActionOutcome> {
        let repo_path = require_input(inputs, "repo")?;
        let remote = require_input(inputs, "remote")?;
        let branch = require_input(inputs, "branch")?;
        let auth = resolve_auth(self.state);
        let repo = GitRepo::open(&repo_path).map_err(to_validation_error)?;
        repo.push(&remote, &branch, &auth)
            .map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "remote": remote, "branch": branch }),
            skipped: false,
            message: Some("pushed".to_string()),
        })
    }

    fn sync_store(&self) -> gt_flow::Result<FlowActionOutcome> {
        let message = sync_data_center_now(self.state).map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "message": message }),
            skipped: false,
            message: Some("store_synced".to_string()),
        })
    }
}

fn input_or_default(inputs: &BTreeMap<String, String>, key: &str, fallback: &str) -> String {
    inputs
        .get(key)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

fn require_input(inputs: &BTreeMap<String, String>, key: &str) -> gt_flow::Result<String> {
    inputs
        .get(key)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| gt_flow::FlowError::Validation(format!("缺少输入: {key}")))
}

fn is_empty_path(path: &Path) -> std::io::Result<bool> {
    if path.is_dir() {
        Ok(fs::read_dir(path)?.next().is_none())
    } else {
        Ok(path.metadata()?.len() == 0)
    }
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<usize> {
    if !from.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("源目录不存在: {}", from.display()),
        ));
    }
    fs::create_dir_all(to)?;
    let mut changed_count = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            changed_count += copy_dir_recursive(&source, &target)?;
        } else {
            fs::copy(&source, &target)?;
            changed_count += 1;
        }
    }
    Ok(changed_count)
}

fn to_validation_error(error: impl ToString) -> gt_flow::FlowError {
    gt_flow::FlowError::Validation(error.to_string())
}

#[tauri::command]
fn flow_validate(workflow: String) -> Result<FlowSummary, String> {
    gt_flow::parse_workflow(&workflow).map_err(|e| e.to_string())
}

#[tauri::command]
fn flow_build_draft(
    request: FlowBuildRequest,
    state: State<'_, AppState>,
) -> Result<FlowBuildDraft, String> {
    let events = {
        let event_pool = state.event_pool.lock().unwrap();
        event_pool.catalog()
    };
    let registry = state.node_registry.lock().unwrap();
    gt_flow::build_flow_draft(request, &events, &registry).map_err(|e| e.to_string())
}

#[tauri::command]
fn flow_save(request: FlowSaveRequest, state: State<'_, AppState>) -> Result<FlowRecord, String> {
    let summary = gt_flow::parse_workflow(&request.workflow).map_err(|e| e.to_string())?;
    let key = gt_flow::workflow_key(&summary.id);
    let now = gt_flow::now_rfc3339();
    let mut store = state.store.lock().unwrap();
    let existing = store
        .get(gt_flow::FLOW_NAMESPACE, &key)
        .and_then(|value| flow_record_from_store_value(value).ok());
    let created_at = existing
        .as_ref()
        .map(|record| record.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let requested_folder = request.folder.as_deref();
    let existing_folder = existing
        .as_ref()
        .and_then(|record| record.folder.as_deref());
    let folder = gt_flow::normalize_folder(requested_folder.or(existing_folder), Some(&summary));

    let record = FlowRecord::new(
        request.workflow,
        summary,
        Some(folder.clone()),
        created_at,
        now,
    );
    let value = flow_record_to_store_value(&record)?;
    store
        .set(gt_flow::FLOW_NAMESPACE, &key, value)
        .map_err(|e| e.to_string())?;
    let mut folders = flow_folders_from_store(&store);
    if !folders.contains(&folder) {
        folders.push(folder);
        save_flow_folders_to_store(&mut store, folders)?;
    }
    Ok(record)
}

#[tauri::command]
fn flow_list(state: State<'_, AppState>) -> Vec<FlowListItem> {
    let store = state.store.lock().unwrap();
    let mut items = flow_records_from_store(&store)
        .into_iter()
        .map(|record| {
            let key = gt_flow::workflow_key(&record.summary.id);
            FlowListItem {
                id: record.summary.id.clone(),
                key,
                folder: gt_flow::normalize_folder(record.folder.as_deref(), Some(&record.summary)),
                summary: record.summary,
                enabled: record.enabled,
                created_at: record.created_at,
                updated_at: record.updated_at,
            }
        })
        .collect::<Vec<_>>();
    items.sort_by(|a, b| {
        a.summary
            .name
            .cmp(&b.summary.name)
            .then_with(|| a.id.cmp(&b.id))
    });
    items
}

#[tauri::command]
fn flow_get(id: String, state: State<'_, AppState>) -> Result<Option<FlowRecord>, String> {
    let store = state.store.lock().unwrap();
    let key = gt_flow::workflow_key(&id);
    store
        .get(gt_flow::FLOW_NAMESPACE, &key)
        .map(flow_record_from_store_value)
        .transpose()
}

#[tauri::command]
fn flow_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    let key = gt_flow::workflow_key(&id);
    store
        .delete(gt_flow::FLOW_NAMESPACE, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn flow_set_enabled(
    id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<FlowRecord, String> {
    let mut store = state.store.lock().unwrap();
    let key = gt_flow::workflow_key(&id);
    let value = store
        .get(gt_flow::FLOW_NAMESPACE, &key)
        .ok_or_else(|| format!("Flow 不存在: {id}"))?;
    let mut record = flow_record_from_store_value(value)?;
    record.set_enabled(enabled, gt_flow::now_rfc3339());
    let value = flow_record_to_store_value(&record)?;
    store
        .set(gt_flow::FLOW_NAMESPACE, &key, value)
        .map_err(|e| e.to_string())?;
    Ok(record)
}

#[tauri::command]
fn flow_list_folders(state: State<'_, AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    flow_folders_from_store(&store)
}

#[tauri::command]
fn flow_create_folder(path: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut store = state.store.lock().unwrap();
    let folder = gt_flow::normalize_folder(Some(&path), None);
    let mut folders = flow_folders_from_store(&store);
    if !folders.contains(&folder) {
        folders.push(folder);
    }
    save_flow_folders_to_store(&mut store, folders)
}

#[tauri::command]
fn flow_delete_folder(path: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut store = state.store.lock().unwrap();
    let folder = gt_flow::normalize_folder(Some(&path), None);
    let has_children = flow_folders_from_store(&store)
        .iter()
        .any(|item| item != &folder && item.starts_with(&format!("{folder}/")));
    if has_children {
        return Err("文件夹非空: 请先删除子文件夹".to_string());
    }
    let has_flows = store
        .scan(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_KEY_PREFIX)
        .into_iter()
        .filter_map(|(_, value)| flow_record_from_store_value(value).ok())
        .any(|record| {
            gt_flow::normalize_folder(record.folder.as_deref(), Some(&record.summary)) == folder
        });
    if has_flows {
        return Err("文件夹非空: 请先移动或删除其中的 Flow".to_string());
    }

    let folders = flow_folders_from_store(&store)
        .into_iter()
        .filter(|item| item != &folder)
        .collect::<Vec<_>>();
    save_flow_folders_to_store(&mut store, folders)
}

fn flow_folders_from_store(store: &Store) -> Vec<String> {
    let mut folders = store
        .get(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_FOLDERS_KEY)
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|folder| gt_flow::normalize_folder(Some(&folder), None))
        .collect::<Vec<_>>();

    for (_, value) in store.scan(gt_flow::FLOW_NAMESPACE, gt_flow::FLOW_KEY_PREFIX) {
        if let Ok(record) = flow_record_from_store_value(value) {
            folders.push(gt_flow::normalize_folder(
                record.folder.as_deref(),
                Some(&record.summary),
            ));
        }
    }

    folders.sort();
    folders.dedup();
    folders
}

fn save_flow_folders_to_store(
    store: &mut Store,
    folders: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut folders = folders
        .into_iter()
        .map(|folder| gt_flow::normalize_folder(Some(&folder), None))
        .collect::<Vec<_>>();
    folders.sort();
    folders.dedup();
    store
        .set(
            gt_flow::FLOW_NAMESPACE,
            gt_flow::FLOW_FOLDERS_KEY,
            serde_json::json!(folders),
        )
        .map_err(|e| e.to_string())?;
    Ok(folders)
}

#[tauri::command]
fn flow_event_catalog(state: State<'_, AppState>) -> Vec<EventDefinition> {
    let event_pool = state.event_pool.lock().unwrap();
    event_pool.catalog()
}

#[tauri::command]
fn flow_recent_events(state: State<'_, AppState>) -> Vec<CloudEvent> {
    let event_pool = state.event_pool.lock().unwrap();
    event_pool.recent_events()
}

#[tauri::command]
fn flow_emit_event(event: EventDraft, state: State<'_, AppState>) -> Result<EventReceipt, String> {
    publish_flow_event(&state, event)
}

#[tauri::command]
fn flow_match_event(event: EventDraft, state: State<'_, AppState>) -> Result<EventReceipt, String> {
    match_flow_event(&state, event)
}

#[tauri::command]
fn flow_node_catalog(state: State<'_, AppState>) -> Vec<FlowNodeDefinition> {
    let registry = state.node_registry.lock().unwrap();
    registry.list()
}

#[tauri::command]
fn flow_nodes(id: String, state: State<'_, AppState>) -> Result<Vec<FlowNodeSpec>, String> {
    let record = {
        let store = state.store.lock().unwrap();
        let key = gt_flow::workflow_key(&id);
        store
            .get(gt_flow::FLOW_NAMESPACE, &key)
            .map(flow_record_from_store_value)
            .transpose()?
            .ok_or_else(|| format!("Flow 不存在: {id}"))?
    };
    let registry = state.node_registry.lock().unwrap();
    Ok(registry.compile_record(&record))
}

#[tauri::command]
fn flow_run(
    id: String,
    request: Option<FlowRunRequest>,
    state: State<'_, AppState>,
) -> Result<FlowRunReport, String> {
    let (record, workspace) = {
        let store = state.store.lock().unwrap();
        let key = gt_flow::workflow_key(&id);
        let record = store
            .get(gt_flow::FLOW_NAMESPACE, &key)
            .map(flow_record_from_store_value)
            .transpose()?
            .ok_or_else(|| format!("Flow 不存在: {id}"))?;
        let workspace = workspace_context_from_store(&store);
        (record, workspace)
    };
    let registry = state.node_registry.lock().unwrap();
    let mut executor = AppFlowActionExecutor::new(&state);
    let report = gt_flow::run_flow_with_executor(
        &record,
        request.unwrap_or(FlowRunRequest {
            intent: None,
            inputs: Value::Object(Default::default()),
        }),
        &registry,
        workspace,
        &mut executor,
    );
    drop(registry);

    let _ = publish_flow_event(
        &state,
        EventDraft {
            source: "gittributary://gt-flow".to_string(),
            event_type: match report.status {
                gt_flow::FlowRunStatus::Succeeded => "flow.run.succeeded",
                gt_flow::FlowRunStatus::Skipped => "flow.run.skipped",
                _ => "flow.run.failed",
            }
            .to_string(),
            subject: Some(format!("flow:{}", report.flow_id)),
            data: json!({
                "flow_id": report.flow_id,
                "run_id": report.run_id,
                "status": format!("{:?}", report.status).to_ascii_lowercase(),
            }),
        },
    );

    Ok(report)
}

fn is_public_event_namespace(namespace: &str) -> bool {
    !(namespace == "secrets" || namespace.starts_with("private."))
}

#[tauri::command]
fn store_get(namespace: String, key: String, state: State<'_, AppState>) -> Option<Value> {
    let store = state.store.lock().unwrap();
    store.get(&namespace, &key)
}

#[tauri::command]
fn store_set(
    namespace: String,
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().unwrap();
        store
            .set(&namespace, &key, value)
            .map_err(|e| e.to_string())?;
    }
    if is_public_event_namespace(&namespace) {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                source: "gittributary://gt-store".to_string(),
                event_type: "store.key.changed".to_string(),
                subject: Some(format!("store:{namespace}/{key}")),
                data: json!({
                    "namespace": namespace,
                    "key": key,
                    "operation": "set",
                }),
            },
        );
    }
    Ok(())
}

#[tauri::command]
fn store_delete(namespace: String, key: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut store = state.store.lock().unwrap();
        store.delete(&namespace, &key).map_err(|e| e.to_string())?;
    }
    if is_public_event_namespace(&namespace) {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                source: "gittributary://gt-store".to_string(),
                event_type: "store.key.changed".to_string(),
                subject: Some(format!("store:{namespace}/{key}")),
                data: json!({
                    "namespace": namespace,
                    "key": key,
                    "operation": "delete",
                }),
            },
        );
    }
    Ok(())
}

#[tauri::command]
fn store_keys(namespace: String, state: State<'_, AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    store.keys(&namespace)
}

#[tauri::command]
fn store_namespaces(state: State<'_, AppState>) -> Vec<NamespaceInfo> {
    let store = state.store.lock().unwrap();
    store
        .namespaces()
        .into_iter()
        .map(|name| {
            let count = store.namespace_len(&name);
            let visibility = match store.namespace_visibility(&name) {
                Some(gt_store::Visibility::Private) => "private",
                _ => "public",
            };
            NamespaceInfo {
                name,
                count,
                visibility: visibility.to_string(),
            }
        })
        .collect()
}

#[tauri::command]
fn store_entries(namespace: String, state: State<'_, AppState>) -> Vec<KvEntry> {
    let store = state.store.lock().unwrap();
    store
        .entries(&namespace)
        .into_iter()
        .map(|(key, value)| KvEntry { key, value })
        .collect()
}

#[tauri::command]
fn store_scan(namespace: String, prefix: String, state: State<'_, AppState>) -> Vec<KvEntry> {
    let store = state.store.lock().unwrap();
    store
        .scan(&namespace, &prefix)
        .into_iter()
        .map(|(key, value)| KvEntry { key, value })
        .collect()
}

#[tauri::command]
fn store_compact(namespace: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.compact(&namespace).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_list_profiles(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let store = state.store.lock().unwrap();
    store.list_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
fn store_list_environments(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    store_list_profiles(state)
}

#[tauri::command]
fn store_active_profile(state: State<'_, AppState>) -> Option<String> {
    let store = state.store.lock().unwrap();
    store.active_profile().map(|s| s.to_string())
}

#[tauri::command]
fn store_active_environment(state: State<'_, AppState>) -> Option<String> {
    store_active_profile(state)
}

#[tauri::command]
fn store_switch_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.switch_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_switch_environment(name: String, state: State<'_, AppState>) -> Result<(), String> {
    store_switch_profile(name, state)
}

#[tauri::command]
fn store_create_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.create_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_create_environment(name: String, state: State<'_, AppState>) -> Result<(), String> {
    store_create_profile(name, state)
}

#[tauri::command]
fn store_delete_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.delete_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_delete_environment(name: String, state: State<'_, AppState>) -> Result<(), String> {
    store_delete_profile(name, state)
}

// ─── Workspace commands ───────────────────────────────────────────────

#[derive(serde::Serialize)]
struct WorkspaceInfo {
    active_repo: Option<String>,
    recent_repos: Vec<String>,
    device_id: Option<String>,
    device_name: Option<String>,
}

#[tauri::command]
fn get_workspace_info(state: State<'_, AppState>) -> WorkspaceInfo {
    let store = state.store.lock().unwrap();
    WorkspaceInfo {
        active_repo: store.active_repo(),
        recent_repos: store.recent_repos(),
        device_id: store.device_id(),
        device_name: store.device_name(),
    }
}

#[tauri::command]
fn get_recent_repos(state: State<'_, AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    store.recent_repos()
}

// ─── Sync commands ────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct SyncConfigPayload {
    url: String,
    branch: String,
    active_environment_id: Option<String>,
    local_database_path: Option<std::path::PathBuf>,
    auto_sync: bool,
    interval_seconds: u64,
}

#[derive(serde::Serialize)]
struct ConfigRepoCheckReport {
    ok: bool,
    status: String,
    message: String,
    default_branch: Option<String>,
    refs_count: usize,
}

fn classify_config_repo_check_error(error: &str) -> (String, String) {
    let lower = error.to_lowercase();
    if lower.contains("authentication")
        || lower.contains("auth")
        || lower.contains("credential")
        || lower.contains("401")
        || lower.contains("403")
    {
        return (
            "auth_failed".to_string(),
            "认证失败,请检查配置中心专用 Access Token 权限".to_string(),
        );
    }
    if lower.contains("not found")
        || lower.contains("404")
        || lower.contains("repository not found")
    {
        return (
            "not_found".to_string(),
            "仓库不存在或当前 Token 无权访问".to_string(),
        );
    }
    if lower.contains("resolve")
        || lower.contains("network")
        || lower.contains("timeout")
        || lower.contains("couldn't connect")
        || lower.contains("failed to connect")
    {
        return (
            "network_failed".to_string(),
            "网络连接失败,请检查网络或代理".to_string(),
        );
    }

    ("invalid".to_string(), error.to_string())
}

fn require_config_repo_url_and_token(store: &Store, url: &str) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err(
            "数据中心配置仓库只支持 HTTPS URL + 明确 Access Token,不能使用 SSH 或系统凭据"
                .to_string(),
        );
    }

    store
        .get_data_center_config_token_raw()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "请先为数据中心配置仓库设置专用 Access Token".to_string())
}

#[tauri::command]
fn sync_get_config(state: State<'_, AppState>) -> Result<Option<SyncConfigPayload>, String> {
    let _store = state.store.lock().unwrap();
    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    match engine.config() {
        Ok(Some(c)) => {
            let local_database_path = Some(engine.config_repo_path(&c));
            Ok(Some(SyncConfigPayload {
                url: c.url,
                branch: c.branch,
                active_environment_id: c.active_environment_id,
                local_database_path,
                auto_sync: c.auto_sync,
                interval_seconds: c.interval_seconds,
            }))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 把 payload 落为 SyncConfig、ensure checkout、并按需 import 远端数据。
/// `active_environment_id` 为空时默认 "default"。
fn apply_sync_config(config: SyncConfigPayload, state: &State<'_, AppState>) -> Result<(), String> {
    let token = {
        let store = state.store.lock().unwrap();
        require_config_repo_url_and_token(&store, &config.url)?
    };

    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    let active_environment_id = config
        .active_environment_id
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| Some("default".to_string()));
    let cfg = gt_store::SyncConfig {
        url: config.url,
        branch: config.branch,
        active_environment_id,
        local_database_path: config.local_database_path,
        auto_sync: config.auto_sync,
        interval_seconds: config.interval_seconds,
    };
    engine.set_config(&cfg).map_err(|e| e.to_string())?;
    let auth = gt_store::ConfigRepoAuth { token: &token };
    let checkout = engine
        .ensure_config_repo(&auth)
        .map_err(|e| e.to_string())?;
    // 绑定后若远端已有数据,import 进本地;空仓库则跳过,等首次 sync_now export
    {
        let mut store = state.store.lock().unwrap();
        engine
            .import_public_from_checkout(&mut store, &checkout)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn sync_set_config(config: SyncConfigPayload, state: State<'_, AppState>) -> Result<(), String> {
    apply_sync_config(config, &state)
}

#[tauri::command]
fn update_data_center_config_remote(
    config: SyncConfigPayload,
    token: Option<String>,
    clear_token: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().unwrap();
        if clear_token {
            store
                .clear_data_center_config_token()
                .map_err(|e| e.to_string())?;
        }
        if let Some(token) = token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            store
                .set_data_center_config_token(token)
                .map_err(|e| e.to_string())?;
        }
    }
    apply_sync_config(config, &state)
}

#[tauri::command]
fn unbind_data_center_config_remote(
    clear_token: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    // 清除配置前先算出 checkout 路径,以便删除工作副本
    let checkout_to_remove = engine
        .config()
        .ok()
        .flatten()
        .map(|c| engine.config_repo_path(&c));
    engine.clear_config().map_err(|e| e.to_string())?;

    if let Some(path) = checkout_to_remove {
        if path.exists() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }

    if clear_token {
        let mut store = state.store.lock().unwrap();
        store
            .clear_data_center_config_token()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn check_data_center_config_repo(
    url: String,
    token: Option<String>,
    state: State<'_, AppState>,
) -> ConfigRepoCheckReport {
    let normalized_url = url.trim().to_string();
    if !normalized_url.starts_with("https://") {
        return ConfigRepoCheckReport {
            ok: false,
            status: "invalid_url".to_string(),
            message: "配置中心仓库只支持 HTTPS URL".to_string(),
            default_branch: None,
            refs_count: 0,
        };
    }

    let stored_token = {
        let store = state.store.lock().unwrap();
        store.get_data_center_config_token_raw().unwrap_or_default()
    };
    let effective_token = token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(stored_token);

    if effective_token.is_empty() {
        return ConfigRepoCheckReport {
            ok: false,
            status: "missing_token".to_string(),
            message: "请先填写配置中心专用 Access Token".to_string(),
            default_branch: None,
            refs_count: 0,
        };
    }

    match gt_git::check_remote_access(&normalized_url, &AuthMethod::Token(effective_token)) {
        Ok(report) => ConfigRepoCheckReport {
            ok: true,
            status: "valid".to_string(),
            message: "连接成功,仓库和 Token 可用".to_string(),
            default_branch: report.default_branch,
            refs_count: report.refs_count,
        },
        Err(e) => {
            let (status, message) = classify_config_repo_check_error(&e.to_string());
            ConfigRepoCheckReport {
                ok: false,
                status,
                message,
                default_branch: None,
                refs_count: 0,
            }
        }
    }
}

#[tauri::command]
fn sync_now(state: State<'_, AppState>) -> Result<String, String> {
    sync_data_center_now(&state)
}

#[tauri::command]
fn sync_get_state(state: State<'_, AppState>) -> Result<gt_store::SyncState, String> {
    let _store = state.store.lock().unwrap();
    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    engine.state().map_err(|e| e.to_string())
}

fn store_base_dir() -> std::path::PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".git-tributary")
}

// ─── Credentials commands ─────────────────────────────────────────────

#[tauri::command]
fn get_git_credentials(state: State<'_, AppState>) -> gt_store::GitCredentials {
    let store = state.store.lock().unwrap();
    store.get_git_credentials()
}

#[tauri::command]
fn get_data_center_config_credential_status(
    state: State<'_, AppState>,
) -> gt_store::DataCenterConfigCredentialStatus {
    let store = state.store.lock().unwrap();
    store.get_data_center_config_credential_status()
}

#[tauri::command]
fn set_git_username(username: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_username(&username).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_git_email(email: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_email(&email).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_git_remote_url(url: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_remote_url(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_git_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_token(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_git_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.clear_git_token().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_data_center_config_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store
        .set_data_center_config_token(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_data_center_config_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store
        .clear_data_center_config_token()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_git_ssh_key(
    path: String,
    passphrase: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store
        .set_git_ssh_key(&path, passphrase.as_deref())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化数据中心(存放在用户 home 下 .gittributary/)
    let store_dir = dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".git-tributary");
    let mut store = Store::open(&store_dir).expect("无法初始化数据中心");
    store.init_workspace().expect("无法初始化 workspace");
    store
        .migrate_git_remote_url_to_local()
        .expect("无法迁移 Git 默认远程配置");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            repo: Mutex::new(None),
            store: Mutex::new(store),
            event_pool: Mutex::new(EventPool::new()),
            node_registry: Mutex::new(FlowNodeRegistry::new()),
        })
        .setup(|app| {
            let state = app.state::<AppState>();
            let _ = publish_flow_event(
                &state,
                EventDraft {
                    source: "gittributary://app".to_string(),
                    event_type: "app.started".to_string(),
                    subject: Some("app:gittributary".to_string()),
                    data: json!({}),
                },
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_repo,
            get_overview,
            get_status,
            stage_all,
            stage_files,
            commit_all,
            commit_selected,
            get_file_diff,
            get_branches,
            create_branch,
            checkout_branch,
            delete_branch,
            get_log,
            get_branch_log,
            get_commit_files,
            get_commit_file_diff,
            get_remotes,
            get_remote_configs,
            clone_remote_repo,
            add_remote,
            set_remote_url,
            remove_remote,
            git_fetch,
            git_push,
            git_pull,
            set_project_token,
            flow_validate,
            flow_build_draft,
            flow_save,
            flow_list,
            flow_get,
            flow_delete,
            flow_set_enabled,
            flow_list_folders,
            flow_create_folder,
            flow_delete_folder,
            flow_event_catalog,
            flow_recent_events,
            flow_emit_event,
            flow_match_event,
            flow_node_catalog,
            flow_nodes,
            flow_run,
            store_get,
            store_set,
            store_delete,
            store_keys,
            store_namespaces,
            store_entries,
            store_scan,
            store_compact,
            store_list_profiles,
            store_list_environments,
            store_active_profile,
            store_active_environment,
            store_switch_profile,
            store_switch_environment,
            store_create_profile,
            store_create_environment,
            store_delete_profile,
            store_delete_environment,
            get_workspace_info,
            get_recent_repos,
            sync_get_config,
            sync_set_config,
            update_data_center_config_remote,
            unbind_data_center_config_remote,
            check_data_center_config_repo,
            sync_now,
            sync_get_state,
            get_git_credentials,
            get_data_center_config_credential_status,
            set_git_username,
            set_git_email,
            set_git_remote_url,
            set_git_token,
            clear_git_token,
            set_data_center_config_token,
            clear_data_center_config_token,
            set_git_ssh_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
