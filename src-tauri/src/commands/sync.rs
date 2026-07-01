//! 数据中心远程同步命令:绑定/解绑配置仓库、立即同步、查询同步状态。
//!
//! 详见 `doc/数据引擎/数据中心远程同步设计.md`(Phase 1 传输模型)。

use tauri::State;

use gt_git::AuthMethod;
use gt_store::Store;

use crate::config_dir::store_base_dir;
use crate::error::classify_config_repo_check_error;
use crate::AppState;

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct SyncConfigPayload {
    url: String,
    branch: String,
    active_environment_id: Option<String>,
    local_database_path: Option<std::path::PathBuf>,
    auto_sync: bool,
    interval_seconds: u64,
}

#[derive(serde::Serialize)]
pub(crate) struct ConfigRepoCheckReport {
    ok: bool,
    status: String,
    message: String,
    default_branch: Option<String>,
    refs_count: usize,
}

/// 校验数据中心配置仓库的 URL + 专用 Access Token 是否齐备。
/// 强制规则:必须 HTTPS,必须有专用 token,不能回退到系统凭据。
pub(crate) fn require_config_repo_url_and_token(
    store: &Store,
    url: &str,
) -> Result<String, String> {
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
pub(crate) fn sync_get_config(
    state: State<'_, AppState>,
) -> Result<Option<SyncConfigPayload>, String> {
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
fn apply_sync_config(
    config: SyncConfigPayload,
    state: &State<'_, AppState>,
) -> Result<(), String> {
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
pub(crate) fn sync_set_config(
    config: SyncConfigPayload,
    state: State<'_, AppState>,
) -> Result<(), String> {
    apply_sync_config(config, &state)
}

#[tauri::command]
pub(crate) fn update_data_center_config_remote(
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
pub(crate) fn unbind_data_center_config_remote(
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
pub(crate) fn check_data_center_config_repo(
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

/// 立即执行一次数据中心同步:pull → import(LWW) → export → commit → push。
/// 供 `sync_now` command 和 Flow 的 `store/sync-now` action 共用。
pub(crate) fn sync_data_center_now(state: &AppState) -> Result<String, String> {
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

#[tauri::command]
pub(crate) fn sync_now(state: State<'_, AppState>) -> Result<String, String> {
    sync_data_center_now(&state)
}

#[tauri::command]
pub(crate) fn sync_get_state(state: State<'_, AppState>) -> Result<gt_store::SyncState, String> {
    let _store = state.store.lock().unwrap();
    let base_dir = store_base_dir();
    let engine = gt_store::SyncEngine::new(&base_dir);
    engine.state().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_store() -> (TempDir, Store) {
        let dir = TempDir::new().unwrap();
        let store = Store::open(dir.path()).unwrap();
        (dir, store)
    }

    #[test]
    fn require_config_repo_url_and_token_rejects_non_https() {
        let (_dir, store) = temp_store();
        let err =
            require_config_repo_url_and_token(&store, "git@github.com:a/b.git").unwrap_err();
        assert!(err.contains("HTTPS"));
    }

    #[test]
    fn require_config_repo_url_and_token_requires_token_when_https() {
        let (_dir, store) = temp_store();
        let err =
            require_config_repo_url_and_token(&store, "https://github.com/a/b.git").unwrap_err();
        assert!(err.contains("Access Token"));
    }

    #[test]
    fn require_config_repo_url_and_token_returns_token_when_set() {
        let (_dir, mut store) = temp_store();
        store.set_data_center_config_token("tok123").unwrap();
        let token =
            require_config_repo_url_and_token(&store, "https://github.com/a/b.git").unwrap();
        assert_eq!(token, "tok123");
    }
}
