//! Git 凭证 + 数据中心配置 token 的读写命令。
//!
//! 普通设置通过类型化 SettingsRepository 写入；Secret 仍由兼容 Store 适配器承载，
//! 后续迁移到 OS Keychain。

use na_data::setting_keys;
use tauri::State;

use crate::AppState;

#[tauri::command]
pub(crate) fn get_git_credentials(state: State<'_, AppState>) -> na_data::GitCredentials {
    let data = state.data.lock().unwrap();
    data.credentials().summary()
}

#[tauri::command]
pub(crate) fn get_data_center_config_credential_status(
    state: State<'_, AppState>,
) -> na_data::DataCenterConfigCredentialStatus {
    let data = state.data.lock().unwrap();
    data.credentials().data_center_config_status()
}

#[tauri::command]
pub(crate) fn set_git_username(username: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.settings_mut()
        .set(setting_keys::GIT_USERNAME, username)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_email(email: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.settings_mut()
        .set(setting_keys::GIT_EMAIL, email)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_remote_url(url: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.remote_metadata_mut()
        .set_default_remote_url(&url)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.credentials_mut()
        .set_global_token(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn clear_git_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.credentials_mut()
        .clear_global_token()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_data_center_config_token(
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.credentials_mut()
        .set_data_center_config_token(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn clear_data_center_config_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.credentials_mut()
        .clear_data_center_config_token()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn set_git_ssh_key(
    path: String,
    passphrase: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap();
    data.credentials_mut()
        .set_ssh_key(&path, passphrase.as_deref())
        .map_err(|e| e.to_string())
}
