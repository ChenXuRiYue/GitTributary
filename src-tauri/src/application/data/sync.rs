//! 数据中心远程同步命令:绑定/解绑配置仓库、立即同步、查询同步状态。
//!
//! 详见 `doc/数据引擎/数据中心远程同步设计.md`(Phase 1 传输模型)。

use tauri::State;

use na_data::DataHub;
use na_flow::FlowNodeDefinition;
use na_git::{AuthMethod, GitRepo};

use crate::support::config_dir::store_base_dir;
use crate::support::error::classify_config_repo_check_error;
use crate::AppState;

pub(crate) mod spaces;

#[cfg(test)]
use spaces::{initialize_space, valid_space_id};

pub(crate) fn flow_node_definitions() -> Vec<FlowNodeDefinition> {
    vec![FlowNodeDefinition {
        uses: "noteaura/store/sync-now@v1".to_string(),
        name: "同步数据中心".to_string(),
        node_type: "sync".to_string(),
        summary: "立即同步数据中心配置仓库".to_string(),
        description: "执行 pull、导入、导出、提交和 push 的完整同步。".to_string(),
        inputs_schema: std::collections::BTreeMap::new(),
        outputs_schema: std::collections::BTreeMap::from([(
            "message".to_string(),
            "string".to_string(),
        )]),
    }]
}

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
    data: &DataHub,
    url: &str,
) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err(
            "数据中心配置仓库只支持 HTTPS URL + 明确 Access Token,不能使用 SSH 或系统凭据"
                .to_string(),
        );
    }

    data.credentials()
        .data_center_config_token()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "请先为数据中心配置仓库设置专用 Access Token".to_string())
}

#[tauri::command]
pub(crate) fn sync_get_config(
    _state: State<'_, AppState>,
) -> Result<Option<SyncConfigPayload>, String> {
    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
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

fn configured_remote_url_and_token(
    data: &DataHub,
    repo_path: &str,
    remote_name: &str,
) -> Result<(String, String), String> {
    let repo_path = repo_path.trim();
    let remote_name = remote_name.trim();
    if repo_path.is_empty() || remote_name.is_empty() {
        return Err("请选择已配置的远程仓库".to_string());
    }

    let repo = GitRepo::open(repo_path).map_err(|error| error.to_string())?;
    let remote = repo
        .remotes()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|remote| remote.name == remote_name)
        .ok_or_else(|| format!("远程仓库 '{remote_name}' 不存在"))?;
    if !remote.url.starts_with("https://") {
        return Err("数据同步只支持使用 HTTPS 的远程仓库".to_string());
    }

    let token = data
        .credentials()
        .project_token(repo_path)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            data.credentials()
                .global_token()
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| "所选远程仓库没有可复用的 Access Token".to_string())?;
    Ok((remote.url, token))
}

#[tauri::command]
pub(crate) fn bind_data_center_config_remote(
    repo_path: String,
    remote_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (url, token) = {
        let data = state.data.lock().unwrap();
        configured_remote_url_and_token(&data, &repo_path, &remote_name)?
    };
    let report = na_git::check_remote_access(&url, &AuthMethod::Token(token.clone()))
        .map_err(|error| classify_config_repo_check_error(&error.to_string()).1)?;

    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
    let existing = engine.config().map_err(|error| error.to_string())?;
    let same_remote = existing.as_ref().is_some_and(|config| config.url == url);
    let config = SyncConfigPayload {
        url,
        branch: report.default_branch.unwrap_or_else(|| "main".to_string()),
        active_environment_id: same_remote
            .then(|| {
                existing
                    .as_ref()
                    .and_then(|config| config.active_environment_id.clone())
            })
            .flatten()
            .or_else(|| Some("default".to_string())),
        local_database_path: same_remote
            .then(|| {
                existing
                    .as_ref()
                    .and_then(|config| config.local_database_path.clone())
            })
            .flatten(),
        auto_sync: existing.as_ref().is_none_or(|config| config.auto_sync),
        interval_seconds: existing
            .as_ref()
            .map_or(300, |config| config.interval_seconds),
    };

    {
        let mut data = state.data.lock().unwrap();
        data.credentials_mut()
            .set_data_center_config_token(&token)
            .map_err(|error| error.to_string())?;
    }
    apply_sync_config(config, &state)
}

/// 把 payload 落为 SyncConfig、ensure checkout、并按需 import 远端数据。
/// `active_environment_id` 为空时默认 "default"。
fn apply_sync_config(config: SyncConfigPayload, state: &State<'_, AppState>) -> Result<(), String> {
    let token = {
        let data = state.data.lock().unwrap();
        require_config_repo_url_and_token(&data, &config.url)?
    };

    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
    let active_environment_id = config
        .active_environment_id
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| Some("default".to_string()));
    let cfg = na_data::SyncConfig {
        url: config.url,
        branch: config.branch,
        active_environment_id,
        local_database_path: config.local_database_path,
        auto_sync: config.auto_sync,
        interval_seconds: config.interval_seconds,
    };
    engine.set_config(&cfg).map_err(|e| e.to_string())?;
    let auth = na_data::ConfigRepoAuth { token: &token };
    let checkout = engine
        .ensure_config_repo(&auth)
        .map_err(|e| e.to_string())?;
    // 绑定后若远端已有数据,import 进本地;空仓库则跳过,等首次 sync_now export
    {
        let mut data = state.data.lock().unwrap();
        data.import_public_from_checkout(&engine, &checkout)
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
        let mut data = state.data.lock().unwrap();
        if clear_token {
            data.credentials_mut()
                .clear_data_center_config_token()
                .map_err(|e| e.to_string())?;
        }
        if let Some(token) = token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            data.credentials_mut()
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
    let engine = na_data::SyncEngine::new(&base_dir);
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
        let mut data = state.data.lock().unwrap();
        data.credentials_mut()
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
        let data = state.data.lock().unwrap();
        data.credentials()
            .data_center_config_token()
            .unwrap_or_default()
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

    match na_git::check_remote_access(&normalized_url, &AuthMethod::Token(effective_token)) {
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
        let data = state.data.lock().unwrap();
        let config = {
            let base_dir = store_base_dir();
            let engine = na_data::SyncEngine::new(&base_dir);
            engine.config().map_err(|e| e.to_string())?
        }
        .ok_or_else(|| "未配置同步远程仓库".to_string())?;
        let token = require_config_repo_url_and_token(&data, &config.url)?;
        (
            data.workspace()
                .snapshot()
                .device_id
                .unwrap_or_else(|| "unknown".to_string()),
            token,
        )
    };

    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
    let auth = na_data::ConfigRepoAuth { token: &token };
    let checkout = engine
        .ensure_config_repo(&auth)
        .map_err(|e| e.to_string())?;
    engine.pull(&auth, &checkout).map_err(|e| e.to_string())?;
    {
        let mut data = state.data.lock().unwrap();
        data.import_public_from_checkout(&engine, &checkout)
            .map_err(|e| e.to_string())?;
        data.export_public_to_checkout(&engine, &checkout)
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
pub(crate) fn sync_get_state(_state: State<'_, AppState>) -> Result<na_data::SyncState, String> {
    let base_dir = store_base_dir();
    let engine = na_data::SyncEngine::new(&base_dir);
    engine.state().map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;
