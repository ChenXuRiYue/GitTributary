use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::AppState;

use super::backend_payload::enrich_backend_payload;
use super::host_methods::{dispatch, required_permission};
use super::state::ExtensionListItem;

pub fn extension_list(state: State<'_, AppState>) -> Vec<ExtensionListItem> {
    state.extensions.list()
}

pub async fn extension_call(
    plugin_id: String,
    generation: u64,
    method: String,
    payload: Option<Value>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    state
        .extensions
        .validate_generation(&plugin_id, generation)?;
    let payload = payload.unwrap_or(Value::Null);
    if method == "backend.invoke" {
        return invoke_backend(plugin_id, generation, payload, state).await;
    }

    let required = required_permission(&method).ok_or_else(|| "unknown_method".to_string())?;
    if !state.extensions.has_permission(&plugin_id, required) {
        return Err("permission_denied".to_string());
    }
    let _lifecycle = state.extensions.lifecycle_lock();
    state
        .extensions
        .validate_generation(&plugin_id, generation)?;
    dispatch(&plugin_id, &method, payload, state.clone())
}

async fn invoke_backend(
    plugin_id: String,
    generation: u64,
    payload: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let backend_method = payload
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "invalid_backend_method".to_string())?
        .to_string();
    let expected_snapshot = state
        .extensions
        .backend_method_snapshot(&plugin_id, &backend_method)?;
    for permission in &expected_snapshot.permissions {
        if !state.extensions.has_permission(&plugin_id, permission) {
            return Err("permission_denied".to_string());
        }
    }
    let backend_payload = enrich_backend_payload(
        &plugin_id,
        &backend_method,
        payload.get("payload").cloned().unwrap_or(Value::Null),
        &state,
    )?;
    let extensions = state.extensions.clone();
    let plugin_host = Arc::clone(&state.plugin_host);
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = extensions.lifecycle_lock();
        extensions.validate_generation(&plugin_id, generation)?;
        let current_snapshot = extensions.backend_method_snapshot(&plugin_id, &backend_method)?;
        if current_snapshot != expected_snapshot {
            return Err("extension_changed_during_request".to_string());
        }
        plugin_host.invoke_plugin(&current_snapshot.path, &backend_method, backend_payload)
    })
    .await
    .map_err(|error| error.to_string())?
}
