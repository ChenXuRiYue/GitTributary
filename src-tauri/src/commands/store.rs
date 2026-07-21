//! 数据中心(`gt-data`)动态 KV、命名空间浏览、Profile/环境切换命令。
//!
//! `store_set` / `store_delete` 根据数据层 `EventPolicy` 决定是否发出
//! `store.key.changed` CloudEvent。同步、敏感性和事件暴露不再共享字符串判断。

use serde_json::Value;
use tauri::State;

use crate::publish_flow_event;
use crate::AppState;
use gt_flow::EventDraft;

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

#[tauri::command]
pub(crate) fn store_get(
    namespace: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<Value>, String> {
    let store = state.data.lock().unwrap();
    store
        .dynamic()
        .get(&namespace, &key)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn store_set(
    namespace: String,
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let should_publish = {
        let mut store = state.data.lock().unwrap();
        store
            .dynamic_mut()
            .set(&namespace, &key, value)
            .map_err(|e| e.to_string())?
    };
    if should_publish {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                // Stable event source identifier retained for existing Flow filters.
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
    let should_publish = {
        let mut store = state.data.lock().unwrap();
        store
            .dynamic_mut()
            .delete(&namespace, &key)
            .map_err(|e| e.to_string())?
    };
    if should_publish {
        let _ = publish_flow_event(
            &state,
            EventDraft {
                // Stable event source identifier retained for existing Flow filters.
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
pub(crate) fn store_keys(
    namespace: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let store = state.data.lock().unwrap();
    store
        .dynamic()
        .keys(&namespace)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn store_namespaces(state: State<'_, AppState>) -> Vec<NamespaceInfo> {
    let store = state.data.lock().unwrap();
    store
        .dynamic()
        .namespaces()
        .into_iter()
        .map(|namespace| {
            let visibility = match namespace.visibility {
                gt_data::Visibility::Private => "private",
                _ => "public",
            };
            NamespaceInfo {
                name: namespace.name,
                count: namespace.count,
                visibility: visibility.to_string(),
            }
        })
        .collect()
}

#[tauri::command]
pub(crate) fn store_entries(
    namespace: String,
    state: State<'_, AppState>,
) -> Result<Vec<KvEntry>, String> {
    let store = state.data.lock().unwrap();
    Ok(store
        .dynamic()
        .entries(&namespace)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(key, value)| KvEntry { key, value })
        .collect())
}

#[tauri::command]
pub(crate) fn store_scan(
    namespace: String,
    prefix: String,
    state: State<'_, AppState>,
) -> Result<Vec<KvEntry>, String> {
    let store = state.data.lock().unwrap();
    Ok(store
        .dynamic()
        .scan(&namespace, &prefix)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|(key, value)| KvEntry { key, value })
        .collect())
}

#[tauri::command]
pub(crate) fn store_compact(namespace: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.data.lock().unwrap();
    store
        .dynamic_mut()
        .compact(&namespace)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn store_list_profiles(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let store = state.data.lock().unwrap();
    store.profiles().list().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn store_list_environments(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    store_list_profiles(state)
}

#[tauri::command]
pub(crate) fn store_active_profile(state: State<'_, AppState>) -> Option<String> {
    let store = state.data.lock().unwrap();
    store.profiles().active()
}

#[tauri::command]
pub(crate) fn store_active_environment(state: State<'_, AppState>) -> Option<String> {
    store_active_profile(state)
}

#[tauri::command]
pub(crate) fn store_switch_profile(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = state.data.lock().unwrap();
    store
        .profiles_mut()
        .switch(&name)
        .map_err(|e| e.to_string())
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
    let mut store = state.data.lock().unwrap();
    store
        .profiles_mut()
        .create(&name)
        .map_err(|e| e.to_string())
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
    let mut store = state.data.lock().unwrap();
    store
        .profiles_mut()
        .delete(&name)
        .map_err(|e| e.to_string())
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
    use tempfile::TempDir;

    #[test]
    fn dynamic_store_api_rejects_secret_namespaces() {
        let directory = TempDir::new().unwrap();
        let data = gt_data::DataHub::open(directory.path()).unwrap();

        assert!(data.dynamic().get("private.credentials", "key").is_err());
        assert!(data
            .dynamic()
            .get("private.any-future-secret", "key")
            .is_err());
        assert!(data.dynamic().get("secrets", "key").is_err());
        assert!(data.dynamic().get("ui-state", "key").is_ok());
        assert!(data.dynamic().get("plugin.example", "key").is_ok());
    }

    #[test]
    fn dynamic_store_writes_cannot_bypass_domain_repositories() {
        let directory = TempDir::new().unwrap();
        let mut data = gt_data::DataHub::open(directory.path()).unwrap();
        let value = serde_json::json!(true);

        assert!(data
            .dynamic_mut()
            .set("settings", "key", value.clone())
            .is_err());
        assert!(data
            .dynamic_mut()
            .set("flows", "key", value.clone())
            .is_err());
        assert!(data
            .dynamic_mut()
            .set("workspace", "key", value.clone())
            .is_err());
        assert!(data
            .dynamic_mut()
            .set("private.local", "key", value.clone())
            .is_err());
        assert!(data
            .dynamic_mut()
            .set("ui-state", "key", value.clone())
            .is_ok());
        assert!(data
            .dynamic_mut()
            .set("sites", "key", value.clone())
            .is_err());
        assert!(data
            .dynamic_mut()
            .set("plugin.example", "key", value)
            .is_err());
    }

    #[test]
    fn dynamic_store_compaction_cannot_touch_domain_namespaces() {
        let directory = TempDir::new().unwrap();
        let mut data = gt_data::DataHub::open(directory.path()).unwrap();
        assert!(data.dynamic_mut().compact("settings").is_err());
        assert!(data.dynamic_mut().compact("flows").is_err());
        data.dynamic_mut()
            .set("ui-state", "key", serde_json::json!(true))
            .unwrap();
        assert!(data.dynamic_mut().compact("ui-state").is_ok());
    }
}
