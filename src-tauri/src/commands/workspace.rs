//! Workspace 相关命令:当前/最近打开的仓库、设备信息。
//!
//! 这些命令只通过 `gt-data` 的 WorkspaceRepository 读取工作区状态。

use tauri::State;

use crate::AppState;

#[derive(serde::Serialize)]
pub(crate) struct WorkspaceInfo {
    active_repo: Option<String>,
    recent_repos: Vec<String>,
    device_id: Option<String>,
    device_name: Option<String>,
}

#[tauri::command]
pub(crate) fn get_workspace_info(state: State<'_, AppState>) -> WorkspaceInfo {
    let data = state.data.lock().unwrap();
    let workspace = data.workspace().snapshot();
    WorkspaceInfo {
        active_repo: workspace.active_repo,
        recent_repos: workspace.recent_repos,
        device_id: workspace.device_id,
        device_name: workspace.device_name,
    }
}

#[tauri::command]
pub(crate) fn get_recent_repos(state: State<'_, AppState>) -> Vec<String> {
    let data = state.data.lock().unwrap();
    data.workspace().recent_repos()
}
