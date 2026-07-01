//! 数据中心(`gt-store`)KV 读写、命名空间浏览、Profile/环境切换命令。
//!
//! `store_set` / `store_delete` 在写入 public 命名空间后会发出
//! `store.key.changed` CloudEvent,让 Flow 可以监听配置变化;
//! private/secrets 命名空间不触发事件(参见 `is_public_event_namespace`)。

use serde_json::Value;
use tauri::State;

use gt_flow::EventDraft;

use crate::publish_flow_event;
use crate::AppState;

#[derive(serde::Serialize)]
pub(crate) struct NamespaceInfo {
    name: String,
    count: usize,
    visibility: String, // "public" | "private"
}

#[derive(serde::Serialize)]
pub(crate) struct KvEntry {
    key: String,
    value: Value,
}

/// private/secrets 命名空间不对外广播变更事件,避免把敏感 key 名/操作暴露给 Flow。
fn is_public_event_namespace(namespace: &str) -> bool {
    !(namespace == "secrets" || namespace.starts_with("private."))
}

#[tauri::command]
pub(crate) fn store_get(namespace: String, key: String, state: State<'_, AppState>) -> Option<Value> {
    let store = state.store.lock().unwrap();
    store.get(&namespace, &key)
}

#[tauri::command]
pub(crate) fn store_set(
    namespace: String,
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().unwrap();
        store
            .set(&namespace, &key, value)
            .map_err(|e| e.to_string())?;
    }
    if is_public_event_namespace(&namespace) {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                source: "gittributary://gt-store".to_string(),
                event_type: "store.key.changed".to_string(),
                subject: Some(format!("store:{namespace}/{key}")),
                data: serde_json::json!({
                    "namespace": namespace,
                    "key": key,
                    "operation": "set",
                }),
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn store_delete(
    namespace: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut store = state.store.lock().unwrap();
        store.delete(&namespace, &key).map_err(|e| e.to_string())?;
    }
    if is_public_event_namespace(&namespace) {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                source: "gittributary://gt-store".to_string(),
                event_type: "store.key.changed".to_string(),
                subject: Some(format!("store:{namespace}/{key}")),
                data: serde_json::json!({
                    "namespace": namespace,
                    "key": key,
                    "operation": "delete",
                }),
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn store_keys(namespace: String, state: State<'_, AppState>) -> Vec<String> {
    let store = state.store.lock().unwrap();
    store.keys(&namespace)
}

#[tauri::command]
pub(crate) fn store_namespaces(state: State<'_, AppState>) -> Vec<NamespaceInfo> {
    let store = state.store.lock().unwrap();
    store
        .namespaces()
        .into_iter()
        .map(|name| {
            let count = store.namespace_len(&name);
            let visibility = match store.namespace_visibility(&name) {
                Some(gt_store::Visibility::Private) => "private",
                _ => "public",
            };
            NamespaceInfo {
                name,
                count,
                visibility: visibility.to_string(),
            }
        })
        .collect()
}

#[tauri::command]
pub(crate) fn store_entries(namespace: String, state: State<'_, AppState>) -> Vec<KvEntry> {
    let store = state.store.lock().unwrap();
    store
        .entries(&namespace)
        .into_iter()
        .map(|(key, value)| KvEntry { key, value })
        .collect()
}

#[tauri::command]
pub(crate) fn store_scan(
    namespace: String,
    prefix: String,
    state: State<'_, AppState>,
) -> Vec<KvEntry> {
    let store = state.store.lock().unwrap();
    store
        .scan(&namespace, &prefix)
        .into_iter()
        .map(|(key, value)| KvEntry { key, value })
        .collect()
}

#[tauri::command]
pub(crate) fn store_compact(namespace: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.compact(&namespace).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn store_list_profiles(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let store = state.store.lock().unwrap();
    store.list_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn store_list_environments(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    store_list_profiles(state)
}

#[tauri::command]
pub(crate) fn store_active_profile(state: State<'_, AppState>) -> Option<String> {
    let store = state.store.lock().unwrap();
    store.active_profile().map(|s| s.to_string())
}

#[tauri::command]
pub(crate) fn store_active_environment(state: State<'_, AppState>) -> Option<String> {
    store_active_profile(state)
}

#[tauri::command]
pub(crate) fn store_switch_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.switch_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn store_switch_environment(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    store_switch_profile(name, state)
}

#[tauri::command]
pub(crate) fn store_create_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.create_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn store_create_environment(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    store_create_profile(name, state)
}

#[tauri::command]
pub(crate) fn store_delete_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.delete_profile(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn store_delete_environment(
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    store_delete_profile(name, state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_public_event_namespace_rejects_private_and_secrets() {
        assert!(!is_public_event_namespace("secrets"));
        assert!(!is_public_event_namespace("private.credentials"));
        assert!(is_public_event_namespace("settings"));
        assert!(is_public_event_namespace("workspace"));
    }
}
