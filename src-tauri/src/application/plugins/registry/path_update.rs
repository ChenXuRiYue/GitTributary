use std::path::{Path, PathBuf};
use std::time::Instant;

use na_git::{
    commit_path_update, prepare_path_update, resolve_repo_root, verify_push_access,
    CommitPathUpdateOptions, GitRepo, PreparePathUpdateOptions,
};
use serde_json::{json, Value};

use crate::application::git::auth::{resolve_auth_for_remote, ResolvedAuth};
use crate::application::git::identity::commit_identity_for_repo_remote;
use crate::application::git::remote::remote_url_for;
use crate::AppState;

use super::payload::{field, optional_field};
use super::state::PathUpdateOperation;

fn git_operation_context(
    state: &AppState,
    repository_path: &Path,
    branch: &str,
    remote_name: &str,
    credential_ref: Option<&str>,
) -> Result<(PathBuf, String, String, ResolvedAuth), String> {
    let target_root = resolve_repo_root(repository_path).map_err(|error| error.to_string())?;
    let target_repo = GitRepo::open(&target_root).map_err(|error| error.to_string())?;
    let remote_url = remote_url_for(&target_repo, remote_name)?;
    let auth = resolve_auth_for_remote(state, &target_root, Some(&remote_url), credential_ref);
    Ok((
        target_root,
        branch.to_string(),
        remote_name.to_string(),
        auth,
    ))
}

pub(super) fn prepare(state: &AppState, plugin_id: &str, payload: &Value) -> Result<Value, String> {
    let repository_path = field::<String>(payload, "repositoryPath")?;
    let branch = field::<String>(payload, "branch")?;
    let remote_name = field::<String>(payload, "remoteName")?;
    let pathspec = field::<String>(payload, "pathspec")?;
    let credential_ref = optional_field::<String>(payload, "credentialRef")?;
    let (target_root, branch, remote_name, auth) = git_operation_context(
        state,
        Path::new(&repository_path),
        &branch,
        &remote_name,
        credential_ref.as_deref(),
    )?;
    authorize_repository(state, &target_root)?;
    prepare_path_update(PreparePathUpdateOptions {
        target_local_path: target_root.clone(),
        branch: branch.clone(),
        remote_name: remote_name.clone(),
        allowed_dirty_pathspec: Some(pathspec.clone()),
        auth: auth.method.clone(),
    })
    .map_err(|error| error.to_string())?;
    verify_push_access(&target_root, &remote_name, &branch, &auth.method)
        .map_err(|error| error.to_string())?;
    let operation_id = state.extensions.begin_path_update(PathUpdateOperation {
        plugin_id: plugin_id.to_string(),
        repository_path: target_root.clone(),
        branch: branch.clone(),
        remote_name: remote_name.clone(),
        pathspec: pathspec.clone(),
        credential_ref: credential_ref.clone(),
        materialized: false,
        created_at: Instant::now(),
    });
    Ok(json!({
        "operationId": operation_id,
        "repositoryPath": target_root,
        "branch": branch,
        "remoteName": remote_name,
        "pathspec": pathspec,
        "credentialMode": auth.mode,
        "credentialRef": auth.credential_ref,
    }))
}

pub(super) fn commit(state: &AppState, plugin_id: &str, payload: &Value) -> Result<Value, String> {
    let operation_id = field::<String>(payload, "operationId")?;
    let commit_message = field::<String>(payload, "commitMessage")?;
    let operation = state
        .extensions
        .path_update(plugin_id, &operation_id, true)?;
    let (target_root, branch, remote_name, auth) = git_operation_context(
        state,
        &operation.repository_path,
        &operation.branch,
        &operation.remote_name,
        operation.credential_ref.as_deref(),
    )?;
    let commit_identity =
        commit_identity_for_repo_remote(state, &target_root.to_string_lossy(), Some(&remote_name));
    let report = commit_path_update(CommitPathUpdateOptions {
        target_local_path: target_root,
        branch,
        remote_name,
        pathspec: operation.pathspec,
        commit_message,
        commit_identity,
        auth: auth.method,
    })
    .map_err(|error| error.to_string())?;
    state.extensions.finish_path_update(&operation_id);
    let mut value = serde_json::to_value(report).map_err(|error| error.to_string())?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "serialization_failed".to_string())?;
    object.insert("credentialMode".to_string(), Value::String(auth.mode));
    object.insert(
        "credentialRef".to_string(),
        auth.credential_ref
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    Ok(value)
}

fn authorize_repository(state: &AppState, repository: &Path) -> Result<(), String> {
    let store = state.data.lock().unwrap();
    let workspace = store.workspace().snapshot();
    let allowed = workspace
        .active_repo
        .into_iter()
        .chain(workspace.recent_repos)
        .chain(workspace.bound_repos)
        .filter_map(|path| PathBuf::from(path).canonicalize().ok())
        .any(|known| known == repository);
    if allowed {
        Ok(())
    } else {
        Err("git_repository_denied".to_string())
    }
}
