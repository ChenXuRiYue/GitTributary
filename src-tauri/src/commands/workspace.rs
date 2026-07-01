//! Workspace 相关命令:当前/最近打开的仓库、设备信息。
//!
//! 这些命令只读 `gt-store` 的 workspace 命名空间,不涉及跨领域编排。

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
    let store = state.store.lock().unwrap();
    WorkspaceInfo {
        active_repo: store.active_repo(),
        recent_repos: store.recent_repos(),
        device_id: store.device_id(),
        device_name: store.device_name(),
    }
}

#[tauri::command]
pub(crate) fn get_recent_repos(state: State<'_, AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    store.recent_repos()
}
