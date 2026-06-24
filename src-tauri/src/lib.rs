use std::sync::Mutex;

use gt_git::{GitRepo, RepoOverview, FileStatus, CommitInfo, FileDiff, BranchInfo, LogEntry};
use tauri::State;

/// 应用状态:持有当前打开的 Git 仓库(可空)
pub struct AppState {
    pub repo: Mutex<Option<GitRepo>>,
}

/// 打开一个 Git 仓库并返回概况
#[tauri::command]
fn open_repo(path: String, state: State<'_, AppState>) -> Result<RepoOverview, String> {
    let repo = GitRepo::open(&path).map_err(|e| e.to_string())?;
    let overview = repo.overview().map_err(|e| e.to_string())?;
    let mut lock = state.repo.lock().unwrap();
    *lock = Some(repo);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            repo: Mutex::new(None),
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
