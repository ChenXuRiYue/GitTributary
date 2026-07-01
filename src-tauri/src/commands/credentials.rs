//! Git 凭证 + 数据中心配置 token 的读写命令。
//!
//! 全部是对 `gt-store::credentials` 模块的直接转发,不含跨领域编排逻辑。

use tauri::State;

use crate::AppState;

#[tauri::command]
pub(crate) fn get_git_credentials(state: State<'_, AppState>) -> gt_store::GitCredentials {
    let store = state.store.lock().unwrap();
    store.get_git_credentials()
}

#[tauri::command]
pub(crate) fn get_data_center_config_credential_status(
    state: State<'_, AppState>,
) -> gt_store::DataCenterConfigCredentialStatus {
    let store = state.store.lock().unwrap();
    store.get_data_center_config_credential_status()
}

#[tauri::command]
pub(crate) fn set_git_username(username: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_username(&username).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_email(email: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_email(&email).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_remote_url(url: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_remote_url(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.set_git_token(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn clear_git_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.clear_git_token().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_data_center_config_token(
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store
        .set_data_center_config_token(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn clear_data_center_config_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store
        .clear_data_center_config_token()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_ssh_key(
    path: String,
    passphrase: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store
        .set_git_ssh_key(&path, passphrase.as_deref())
        .map_err(|e| e.to_string())
}
