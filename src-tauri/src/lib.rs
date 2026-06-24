use std::sync::Mutex;

use gt_git::{GitRepo, RepoOverview, FileStatus, CommitInfo, FileDiff, BranchInfo, LogEntry, RemoteInfo, AuthMethod};
use gt_store::Store;
use serde_json::Value;
use tauri::State;

/// 应用状态
pub struct AppState {
    pub repo: Mutex<Option<GitRepo>>,
    pub store: Mutex<Store>,
}

/// 打开一个 Git 仓库并返回概况
#[tauri::command]
fn open_repo(path: String, state: State<'_, AppState>) -> Result<RepoOverview, String> {
    let repo = GitRepo::open(&path).map_err(|e| e.to_string())?;
    let overview = repo.overview().map_err(|e| e.to_string())?;
    let branch = overview.current_branch.clone();
    let mut repo_lock = state.repo.lock().unwrap();
    *repo_lock = Some(repo);
    // 统一同步 workspace 状态(一个调用搞定)
    let mut store = state.store.lock().unwrap();
    let _ = store.sync_workspace(Some(&path), Some(&branch));
    Ok(overview)
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
    let path_refs: Vec<&std::path::Path> = paths.iter().map(|p| std::path::Path::new(p.as_str())).collect();
    repo.stage_files(&path_refs).map_err(|e| e.to_string())
}

/// 暂存所有并提交
#[tauri::command]
fn commit_all(message: String, state: State<'_, AppState>) -> Result<CommitInfo, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.stage_all().map_err(|e| e.to_string())?;
    repo.commit(&message).map_err(|e| e.to_string())
}

/// 暂存指定文件并提交
#[tauri::command]
fn commit_selected(paths: Vec<String>, message: String, state: State<'_, AppState>) -> Result<CommitInfo, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let path_refs: Vec<&std::path::Path> = paths.iter().map(|p| std::path::Path::new(p.as_str())).collect();
    repo.stage_files(&path_refs).map_err(|e| e.to_string())?;
    repo.commit(&message).map_err(|e| e.to_string())
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
fn get_branch_log(branch: String, limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<LogEntry>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.log_branch(&branch, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

/// 获取某次提交涉及的变更文件列表
#[tauri::command]
fn get_commit_files(commit_id: String, state: State<'_, AppState>) -> Result<Vec<FileStatus>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.commit_files(&commit_id).map_err(|e| e.to_string())
}

/// 获取某次提交中指定文件的 diff
#[tauri::command]
fn get_commit_file_diff(commit_id: String, path: String, state: State<'_, AppState>) -> Result<FileDiff, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.commit_file_diff(&commit_id, &path).map_err(|e| e.to_string())
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

/// 添加远程
#[tauri::command]
fn add_remote(name: String, url: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.add_remote(&name, &url).map_err(|e| e.to_string())
}

/// 修改远程 URL
#[tauri::command]
fn set_remote_url(name: String, url: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.set_remote_url(&name, &url).map_err(|e| e.to_string())
}

/// 删除远程
#[tauri::command]
fn remove_remote(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.remove_remote(&name).map_err(|e| e.to_string())
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
    repo.push(&remote, &branch, &auth).map_err(|e| e.to_string())
}

/// Pull(fetch + fast-forward)
#[tauri::command]
fn git_pull(remote: String, branch: String, state: State<'_, AppState>) -> Result<(), String> {
    let auth = resolve_auth(&state);
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.pull(&remote, &branch, &auth).map_err(|e| e.to_string())
}

/// 设置项目级 token(存入 private.credentials 命名空间)
#[tauri::command]
fn set_project_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let repo_lock = state.repo.lock().unwrap();
    let repo = repo_lock.as_ref().ok_or("尚未打开仓库")?;
    let workdir = repo.workdir().ok_or("无法获取仓库路径")?;
    let project_key = format!("project.{}.token", workdir.display());
    drop(repo_lock);
    let mut store = state.store.lock().unwrap();
    store.set("private.credentials", &project_key, serde_json::json!(token))
        .map_err(|e| e.to_string())
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

#[tauri::command]
fn store_get(namespace: String, key: String, state: State<'_, AppState>) -> Option<Value> {
    let store = state.store.lock().unwrap();
    store.get(&namespace, &key)
}

#[tauri::command]
fn store_set(namespace: String, key: String, value: Value, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set(&namespace, &key, value).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_delete(namespace: String, key: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.delete(&namespace, &key).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_keys(namespace: String, state: State<'_, AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    store.keys(&namespace)
}

#[tauri::command]
fn store_namespaces(state: State<'_, AppState>) -> Vec<NamespaceInfo> {
    let store = state.store.lock().unwrap();
    store.namespaces().into_iter().map(|name| {
        let count = store.namespace_len(&name);
        let visibility = match store.namespace_visibility(&name) {
            Some(gt_store::Visibility::Private) => "private",
            _ => "public",
        };
        NamespaceInfo { name, count, visibility: visibility.to_string() }
    }).collect()
}

#[tauri::command]
fn store_entries(namespace: String, state: State<'_, AppState>) -> Vec<KvEntry> {
    let store = state.store.lock().unwrap();
    store.entries(&namespace).into_iter().map(|(key, value)| KvEntry { key, value }).collect()
}

#[tauri::command]
fn store_scan(namespace: String, prefix: String, state: State<'_, AppState>) -> Vec<KvEntry> {
    let store = state.store.lock().unwrap();
    store.scan(&namespace, &prefix).into_iter().map(|(key, value)| KvEntry { key, value }).collect()
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
fn store_active_profile(state: State<'_, AppState>) -> Option<String> {
    let store = state.store.lock().unwrap();
    store.active_profile().map(|s| s.to_string())
}

#[tauri::command]
fn store_switch_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.switch_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_create_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.create_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_delete_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.delete_profile(&name).map_err(|e| e.to_string())
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
    auto_sync: bool,
    interval_seconds: u64,
}

#[tauri::command]
fn sync_get_config(state: State<'_, AppState>) -> Result<Option<SyncConfigPayload>, String> {
    let store = state.store.lock().unwrap();
    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    match engine.config() {
        Ok(Some(c)) => Ok(Some(SyncConfigPayload {
            url: c.url, branch: c.branch, auto_sync: c.auto_sync, interval_seconds: c.interval_seconds,
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn sync_set_config(config: SyncConfigPayload, state: State<'_, AppState>) -> Result<(), String> {
    let _store = state.store.lock().unwrap();
    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    engine.set_config(&gt_store::SyncConfig {
        url: config.url, branch: config.branch, auto_sync: config.auto_sync, interval_seconds: config.interval_seconds,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_now(state: State<'_, AppState>) -> Result<String, String> {
    let store = state.store.lock().unwrap();
    let device_id = store.device_id().unwrap_or_else(|| "unknown".to_string());
    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    engine.sync(&device_id).map_err(|e| e.to_string())?;
    Ok("同步完成".to_string())
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
fn set_git_ssh_key(path: String, passphrase: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_ssh_key(&path, passphrase.as_deref()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化数据中心(存放在用户 home 下 .gittributary/)
    let store_dir = dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".git-tributary");
    let mut store = Store::open(&store_dir).expect("无法初始化数据中心");
    store.init_workspace().expect("无法初始化 workspace");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            repo: Mutex::new(None),
            store: Mutex::new(store),
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
            add_remote,
            set_remote_url,
            remove_remote,
            git_fetch,
            git_push,
            git_pull,
            set_project_token,
            store_get,
            store_set,
            store_delete,
            store_keys,
            store_namespaces,
            store_entries,
            store_scan,
            store_compact,
            store_list_profiles,
            store_active_profile,
            store_switch_profile,
            store_create_profile,
            store_delete_profile,
            get_workspace_info,
            get_recent_repos,
            sync_get_config,
            sync_set_config,
            sync_now,
            sync_get_state,
            get_git_credentials,
            set_git_username,
            set_git_email,
            set_git_remote_url,
            set_git_token,
            clear_git_token,
            set_git_ssh_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
