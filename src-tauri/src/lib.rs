use std::sync::Mutex;

use gt_git::{GitRepo, RepoOverview, FileStatus, CommitInfo, FileDiff, BranchInfo, LogEntry};
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
    let mut repo_lock = state.repo.lock().unwrap();
    *repo_lock = Some(repo);
    // 持久化到数据中心
    let mut store = state.store.lock().unwrap();
    let _ = store.set_active_repo(&path);
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
    repo.checkout_branch(&name).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化数据中心(存放在用户 home 下 .gittributary/)
    let store_dir = dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".gittributary");
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
