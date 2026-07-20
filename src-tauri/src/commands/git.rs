//! 基础 Git 仓库命令:打开、状态、暂存、提交、分支、历史。
//!
//! 远程相关命令(add/set/remove remote、clone、fetch/push/pull)在
//! `commands::remote` 里,因为它们涉及认证解析,和这里的"纯本地仓库操作"
//! 职责不同。

use gt_git::{BranchInfo, CommitInfo, FileDiff, FileStatus, GitRepo, LogEntry, RepoOverview};
use serde_json::json;
use tauri::State;

use gt_flow::{EventDraft, FlowNodeDefinition};

use crate::identity::{
    commit_identity_for_repo_remote, fallback_commit_identity, preferred_commit_remote,
};
use crate::{publish_flow_event, set_active_repo_state, AppState};

pub(crate) fn flow_node_definitions() -> Vec<FlowNodeDefinition> {
    vec![FlowNodeDefinition {
        uses: "gittributary/git/commit-all@v1".to_string(),
        name: "提交全部变更".to_string(),
        node_type: "git".to_string(),
        summary: "暂存并提交指定仓库的全部变更".to_string(),
        description: "没有变更时返回 skipped，不创建空提交。".to_string(),
        inputs_schema: std::collections::BTreeMap::from([
            ("repo".to_string(), "string".to_string()),
            ("message".to_string(), "string".to_string()),
        ]),
        outputs_schema: std::collections::BTreeMap::from([
            ("commit".to_string(), "string?".to_string()),
            ("branch".to_string(), "string".to_string()),
        ]),
    }]
}

/// 打开一个 Git 仓库并返回概况
#[tauri::command]
pub(crate) fn open_repo(path: String, state: State<'_, AppState>) -> Result<RepoOverview, String> {
    let repo = GitRepo::open(&path).map_err(|e| e.to_string())?;
    set_active_repo_state(repo, &state)
}

/// 获取仓库概况(需已打开)
#[tauri::command]
pub(crate) fn get_overview(state: State<'_, AppState>) -> Result<RepoOverview, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.metadata().map_err(|e| e.to_string())
}

/// 获取变更文件列表
#[tauri::command]
pub(crate) fn get_status(state: State<'_, AppState>) -> Result<Vec<FileStatus>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.status().map_err(|e| e.to_string())
}

/// 暂存所有变更
#[tauri::command]
pub(crate) fn stage_all(state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.stage_all().map_err(|e| e.to_string())
}

/// 暂存指定文件
#[tauri::command]
pub(crate) fn stage_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
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
pub(crate) fn commit_all(
    message: String,
    state: State<'_, AppState>,
) -> Result<CommitInfo, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    let repo_path = repo
        .workdir()
        .map(|path| path.to_string_lossy().to_string());
    let branch = repo.current_branch().unwrap_or_else(|_| "HEAD".to_string());
    let remote_name = preferred_commit_remote(repo);
    let identity = repo_path
        .as_deref()
        .map(|path| commit_identity_for_repo_remote(&state, path, remote_name.as_deref()))
        .unwrap_or_else(|| fallback_commit_identity(&state, None));
    repo.stage_all().map_err(|e| e.to_string())?;
    let commit = repo
        .commit_with_identity(&message, &identity)
        .map_err(|e| e.to_string())?;
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
pub(crate) fn commit_selected(
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
    let remote_name = preferred_commit_remote(repo);
    let identity = repo_path
        .as_deref()
        .map(|path| commit_identity_for_repo_remote(&state, path, remote_name.as_deref()))
        .unwrap_or_else(|| fallback_commit_identity(&state, None));
    let path_refs: Vec<&std::path::Path> = paths
        .iter()
        .map(|p| std::path::Path::new(p.as_str()))
        .collect();
    repo.stage_files(&path_refs).map_err(|e| e.to_string())?;
    let commit = repo
        .commit_with_identity(&message, &identity)
        .map_err(|e| e.to_string())?;
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
pub(crate) fn get_file_diff(path: String, state: State<'_, AppState>) -> Result<FileDiff, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.diff_file(&path).map_err(|e| e.to_string())
}

// ─── Branch commands ──────────────────────────────────────────────────

/// 获取本地分支列表
#[tauri::command]
pub(crate) fn get_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.local_branches().map_err(|e| e.to_string())
}

/// 创建新分支
#[tauri::command]
pub(crate) fn create_branch(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.create_branch(&name).map_err(|e| e.to_string())
}

/// 切换分支
#[tauri::command]
pub(crate) fn checkout_branch(name: String, state: State<'_, AppState>) -> Result<(), String> {
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
pub(crate) fn delete_branch(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.delete_branch(&name).map_err(|e| e.to_string())
}

// ─── Log commands ─────────────────────────────────────────────────────

/// 获取提交历史(默认 100 条)
#[tauri::command]
pub(crate) fn get_log(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<LogEntry>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.log(limit.unwrap_or(100)).map_err(|e| e.to_string())
}

/// 获取指定分支的提交历史
#[tauri::command]
pub(crate) fn get_branch_log(
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
pub(crate) fn get_commit_files(
    commit_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileStatus>, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.commit_files(&commit_id).map_err(|e| e.to_string())
}

/// 获取某次提交中指定文件的 diff
#[tauri::command]
pub(crate) fn get_commit_file_diff(
    commit_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<FileDiff, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock.as_ref().ok_or("尚未打开仓库")?;
    repo.commit_file_diff(&commit_id, &path)
        .map_err(|e| e.to_string())
}
