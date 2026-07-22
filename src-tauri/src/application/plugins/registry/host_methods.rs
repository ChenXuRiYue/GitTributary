use std::path::PathBuf;

use gt_data::validate_namespace_name;
use gt_files::replace_tree;
use serde_json::{json, Value};
use tauri::State;

use crate::application::data::commands::{store_delete, store_get, store_set};
use crate::application::data::workspace::get_workspace_info;
use crate::application::files::commands::{files_list, files_read_text, files_scan, files_search};
use crate::application::flow::commands::flow_records_from_data;
use crate::application::git::remote::{add_remote, get_remote_configs};
use crate::AppState;

use super::path_update;
use super::payload::{field, optional_field, serialize};
use super::state::ExtensionRegistry;

pub(super) fn required_permission(method: &str) -> Option<&'static str> {
    match method {
        "repositories.active" | "repositories.configs" | "workspace.info" => {
            Some("repository:read")
        }
        "git.overview" | "git.log" => Some("git:read"),
        "flow.list" => Some("flow:read"),
        "files.list" | "files.scan" | "files.search" | "files.readText" => Some("files:read"),
        "files.replaceTree" => Some("files:write"),
        "git.pathUpdate.prepare" | "git.pathUpdate.commit" | "repositories.addRemote" => {
            Some("git:write")
        }
        "store.get" => Some("store:read"),
        "store.set" | "store.delete" => Some("store:write"),
        "shell.openPath" | "shell.revealPath" | "shell.openUrl" => Some("shell:open"),
        _ => None,
    }
}

pub(super) fn dispatch(
    plugin_id: &str,
    method: &str,
    payload: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    match method {
        "repositories.active" | "git.overview" => repository_overview(&state),
        "git.log" => git_log(&state, &payload),
        "flow.list" => flow_list(&state),
        "store.get" => store_get_for_plugin(plugin_id, &payload, state),
        "store.set" => store_set_for_plugin(plugin_id, &payload, state),
        "store.delete" => store_delete_for_plugin(plugin_id, &payload, state),
        "files.list" => {
            let root = extension_file_root(&state, &payload)?;
            serialize(files_list(
                root,
                optional_field(&payload, "relativeDir")?,
                optional_field(&payload, "options")?,
            )?)
        }
        "files.scan" => {
            let root = extension_file_root(&state, &payload)?;
            serialize(files_scan(
                root,
                optional_field(&payload, "relativeDir")?,
                optional_field(&payload, "options")?,
            )?)
        }
        "files.search" => {
            let root = extension_file_root(&state, &payload)?;
            serialize(files_search(
                root,
                optional_field(&payload, "relativeDir")?,
                field(&payload, "query")?,
                optional_field(&payload, "options")?,
            )?)
        }
        "files.readText" => {
            let root = extension_file_root(&state, &payload)?;
            serialize(files_read_text(
                root,
                field(&payload, "path")?,
                optional_field(&payload, "maxBytes")?,
            )?)
        }
        "files.replaceTree" => replace_tree_for_plugin(plugin_id, &payload, &state),
        "git.pathUpdate.prepare" => path_update::prepare(&state, plugin_id, &payload),
        "git.pathUpdate.commit" => path_update::commit(&state, plugin_id, &payload),
        "repositories.configs" => serialize(get_remote_configs(state.clone())?),
        "repositories.addRemote" => add_repository_remote(&payload, state),
        "workspace.info" => serialize(get_workspace_info(state.clone())),
        "shell.openPath" => {
            tauri_plugin_opener::open_path(field::<String>(&payload, "path")?, None::<&str>)
                .map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        "shell.revealPath" => {
            tauri_plugin_opener::reveal_item_in_dir(field::<String>(&payload, "path")?)
                .map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        "shell.openUrl" => {
            tauri_plugin_opener::open_url(field::<String>(&payload, "url")?, None::<&str>)
                .map_err(|error| error.to_string())?;
            Ok(Value::Null)
        }
        "backend.invoke" => unreachable!("backend.invoke returns before synchronous dispatch"),
        _ => Err("unknown_method".to_string()),
    }
}

fn repository_overview(state: &AppState) -> Result<Value, String> {
    let lock = state.repo.lock().unwrap();
    let repo = lock
        .as_ref()
        .ok_or_else(|| "repository_not_open".to_string())?;
    let overview = repo
        .overview()
        .map_err(|_| "git_overview_failed".to_string())?;
    let display_name = overview
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repository");
    Ok(json!({
        "repositoryId": "active",
        "displayName": display_name,
        "currentBranch": overview.current_branch,
        "isDirty": overview.is_dirty,
        "changedCount": overview.changed_count,
        "hasRemote": overview.remote_url.is_some(),
    }))
}

fn git_log(state: &AppState, payload: &Value) -> Result<Value, String> {
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 100) as usize;
    let lock = state.repo.lock().unwrap();
    let repo = lock
        .as_ref()
        .ok_or_else(|| "repository_not_open".to_string())?;
    serde_json::to_value(repo.log(limit).map_err(|_| "git_log_failed".to_string())?)
        .map_err(|_| "serialization_failed".to_string())
}

fn flow_list(state: &AppState) -> Result<Value, String> {
    let store = state.data.lock().unwrap();
    let flows = flow_records_from_data(&store)?
        .into_iter()
        .map(|record| {
            json!({
                "id": record.summary.id,
                "name": record.summary.name,
                "enabled": record.enabled,
            })
        })
        .collect();
    Ok(Value::Array(flows))
}

fn store_get_for_plugin(
    plugin_id: &str,
    payload: &Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let namespace = extension_store_namespace(&state.extensions, plugin_id, payload)?;
    let key = field::<String>(payload, "key")?;
    if is_private_plugin_namespace(plugin_id, &namespace) {
        let data = state.data.lock().unwrap();
        Ok(data
            .plugin_data(plugin_id)
            .map_err(|error| error.to_string())?
            .get(&namespace, &key)
            .map_err(|error| error.to_string())?
            .unwrap_or(Value::Null))
    } else {
        Ok(store_get(namespace, key, state)?.unwrap_or(Value::Null))
    }
}

fn store_set_for_plugin(
    plugin_id: &str,
    payload: &Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let namespace = extension_store_namespace(&state.extensions, plugin_id, payload)?;
    let key = field::<String>(payload, "key")?;
    let value = payload
        .get("value")
        .cloned()
        .ok_or_else(|| "missing_payload_field:value".to_string())?;
    if is_private_plugin_namespace(plugin_id, &namespace) {
        state
            .data
            .lock()
            .unwrap()
            .plugin_data_mut(plugin_id)
            .map_err(|error| error.to_string())?
            .set(&namespace, &key, value)
            .map_err(|error| error.to_string())?;
    } else {
        store_set(namespace, key, value, state)?;
    }
    Ok(Value::Null)
}

fn store_delete_for_plugin(
    plugin_id: &str,
    payload: &Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let namespace = extension_store_namespace(&state.extensions, plugin_id, payload)?;
    let key = field::<String>(payload, "key")?;
    if is_private_plugin_namespace(plugin_id, &namespace) {
        state
            .data
            .lock()
            .unwrap()
            .plugin_data_mut(plugin_id)
            .map_err(|error| error.to_string())?
            .delete(&namespace, &key)
            .map_err(|error| error.to_string())?;
    } else {
        store_delete(namespace, key, state)?;
    }
    Ok(Value::Null)
}

fn replace_tree_for_plugin(
    plugin_id: &str,
    payload: &Value,
    state: &AppState,
) -> Result<Value, String> {
    if !state.extensions.has_permission(plugin_id, "git:write") {
        return Err("permission_denied".to_string());
    }
    let operation_id = field::<String>(payload, "operationId")?;
    let operation = state
        .extensions
        .path_update(plugin_id, &operation_id, false)?;
    let source = extension_source_directory(state, payload)?;
    let report = replace_tree(source, &operation.repository_path, &operation.pathspec)
        .map_err(|error| error.to_string())?;
    state
        .extensions
        .mark_path_update_materialized(&operation_id);
    serialize(report)
}

fn add_repository_remote(payload: &Value, state: State<'_, AppState>) -> Result<Value, String> {
    add_remote(
        field(payload, "name")?,
        field(payload, "url")?,
        optional_field(payload, "token")?,
        optional_field(payload, "commitName")?,
        optional_field(payload, "commitEmail")?,
        state,
    )?;
    Ok(Value::Null)
}

pub(super) fn extension_store_namespace(
    registry: &ExtensionRegistry,
    plugin_id: &str,
    payload: &Value,
) -> Result<String, String> {
    let requested = field::<String>(payload, "namespace")?;
    validate_namespace_name(&requested).map_err(|_| "store_namespace_denied".to_string())?;
    if registry.has_store_namespace(plugin_id, &requested) {
        return Ok(requested);
    }
    let scoped = format!("plugin.{plugin_id}");
    if requested == scoped || requested.starts_with(&format!("{scoped}.")) {
        return Ok(requested);
    }
    Err("store_namespace_denied".to_string())
}

fn is_private_plugin_namespace(plugin_id: &str, namespace: &str) -> bool {
    let scoped = format!("plugin.{plugin_id}");
    namespace == scoped || namespace.starts_with(&format!("{scoped}."))
}

pub(super) fn extension_source_directory(
    state: &AppState,
    payload: &Value,
) -> Result<PathBuf, String> {
    let requested = PathBuf::from(field::<String>(payload, "sourceRoot")?)
        .canonicalize()
        .map_err(|_| "file_root_missing".to_string())?;
    if !requested.is_dir() {
        return Err("file_root_not_directory".to_string());
    }
    let store = state.data.lock().unwrap();
    let workspace = store.workspace().snapshot();
    let allowed = workspace
        .active_repo
        .into_iter()
        .chain(workspace.recent_repos)
        .filter_map(|path| PathBuf::from(path).canonicalize().ok())
        .any(|root| requested.starts_with(root));
    if !allowed {
        return Err("file_root_denied".to_string());
    }
    Ok(requested)
}

pub(super) fn extension_file_root(state: &AppState, payload: &Value) -> Result<String, String> {
    let requested = PathBuf::from(field::<String>(payload, "root")?)
        .canonicalize()
        .map_err(|_| "file_root_missing".to_string())?;
    if !requested.is_dir() {
        return Err("file_root_not_directory".to_string());
    }

    let mut known_roots = {
        let store = state.data.lock().unwrap();
        let workspace = store.workspace().snapshot();
        let mut roots = workspace.recent_repos;
        if let Some(active) = workspace.active_repo {
            roots.push(active);
        }
        roots
    };
    if let Some(workdir) = state
        .repo
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|repo| repo.workdir())
    {
        known_roots.push(workdir.to_string_lossy().to_string());
    }

    let allowed = known_roots.into_iter().any(|root| {
        PathBuf::from(root)
            .canonicalize()
            .is_ok_and(|root| root == requested)
    });
    if !allowed {
        return Err("file_root_not_authorized".to_string());
    }
    Ok(requested.to_string_lossy().to_string())
}
