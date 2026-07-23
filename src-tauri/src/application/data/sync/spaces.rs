use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::support::config_dir::store_base_dir;
use crate::AppState;

use super::require_config_repo_url_and_token;

pub(super) fn valid_space_id(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_' | '.'))
}

pub(super) fn initialize_space(checkout: &Path, space_id: &str) -> Result<PathBuf, String> {
    let root = checkout.join("environments").join(space_id);
    if root.exists() {
        return Err(format!("空间 '{space_id}' 已存在"));
    }
    std::fs::create_dir_all(root.join("data")).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(root.join("profiles")).map_err(|error| error.to_string())?;
    std::fs::write(root.join(".gitkeep"), []).map_err(|error| error.to_string())?;
    Ok(root)
}

#[tauri::command]
pub(crate) fn sync_list_environments() -> Result<Vec<String>, String> {
    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
    let Some(config) = engine.config().map_err(|error| error.to_string())? else {
        return Ok(vec!["default".to_string()]);
    };

    let mut spaces = BTreeSet::from([na_data::SyncEngine::active_environment(&config)]);
    let root = engine.config_repo_path(&config).join("environments");
    if root.exists() {
        for entry in std::fs::read_dir(root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if valid_space_id(&name) {
                spaces.insert(name);
            }
        }
    }
    Ok(spaces.into_iter().collect())
}

#[tauri::command]
pub(crate) fn sync_switch_environment(environment_id: String) -> Result<(), String> {
    let space_id = environment_id.trim();
    if !valid_space_id(space_id) {
        return Err("空间名称仅支持文字、数字、点、短横线和下划线".to_string());
    }

    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
    let mut config = engine
        .config()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "请先绑定远程数据仓库".to_string())?;
    let root = engine
        .config_repo_path(&config)
        .join("environments")
        .join(space_id);
    if !root.is_dir() {
        return Err(format!("空间 '{space_id}' 不存在"));
    }
    config.active_environment_id = Some(space_id.to_string());
    engine
        .set_config(&config)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn sync_create_space(
    space_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let space_id = space_id.trim();
    if !valid_space_id(space_id) {
        return Err("空间名称仅支持文字、数字、点、短横线和下划线".to_string());
    }

    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
    let mut config = engine
        .config()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "请先绑定远程数据仓库".to_string())?;
    let token = {
        let data = state.data.lock().unwrap();
        require_config_repo_url_and_token(&data, &config.url)?
    };
    let auth = na_data::ConfigRepoAuth { token: &token };
    let checkout = engine
        .ensure_config_repo(&auth)
        .map_err(|error| error.to_string())?;
    let created_root = initialize_space(&checkout, space_id)?;

    config.active_environment_id = Some(space_id.to_string());
    if let Err(error) = engine.set_config(&config) {
        let _ = std::fs::remove_dir_all(created_root);
        return Err(error.to_string());
    }
    Ok(())
}
