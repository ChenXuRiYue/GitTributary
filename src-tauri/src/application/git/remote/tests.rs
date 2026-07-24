use std::path::Path;

use na_data::DataHub;
use na_flow::{EventPool, FlowNodeRegistry};
use tempfile::TempDir;

use super::config::{collect_remote_configs_with_base_dir, config_repo_remote_name};
use super::*;
use crate::application::git::identity::remote_commit_identity_config;

fn temp_store() -> (TempDir, DataHub) {
    let dir = TempDir::new().unwrap();
    let data = DataHub::open(dir.path()).unwrap();
    (dir, data)
}

fn temp_app_state() -> (TempDir, AppState) {
    let (dir, store) = temp_store();
    let state = AppState {
        repo: std::sync::Mutex::new(None),
        data: std::sync::Mutex::new(store),
        event_pool: std::sync::Mutex::new(EventPool::new()),
        node_registry: std::sync::Mutex::new(FlowNodeRegistry::new()),
        flow_execution: std::sync::Mutex::new(()),
        extensions: crate::application::plugins::registry::ExtensionRegistry::default(),
        plugin_host: std::sync::Arc::new(
            crate::application::plugins::host::PluginHostSupervisor::default(),
        ),
    };
    (dir, state)
}

fn init_repo_with_commit(dir: &Path) -> GitRepo {
    let repo = GitRepo::init(dir).unwrap();
    std::fs::write(dir.join("README.md"), "# hi\n").unwrap();
    repo.stage_all().unwrap();
    repo.commit("init: first commit").unwrap();
    repo
}

#[test]
fn config_repo_remote_name_strips_git_suffix() {
    assert_eq!(
        config_repo_remote_name("https://github.com/user/na-config.git"),
        "data-center/na-config"
    );
}

#[test]
fn config_repo_remote_name_handles_trailing_slash() {
    assert_eq!(
        config_repo_remote_name("https://github.com/user/na-config/"),
        "data-center/na-config"
    );
}

#[test]
fn config_repo_remote_name_falls_back_when_empty() {
    assert_eq!(config_repo_remote_name(""), "data-center/config-repo");
}

#[test]
fn repo_path_for_repo_returns_workdir() {
    let dir = TempDir::new().unwrap();
    let repo = init_repo_with_commit(dir.path());
    let path = repo_path_for_repo(&repo).unwrap();
    assert_eq!(
        Path::new(&path).canonicalize().unwrap(),
        dir.path().canonicalize().unwrap()
    );
}

#[test]
fn remote_url_for_returns_error_when_missing() {
    let dir = TempDir::new().unwrap();
    let repo = init_repo_with_commit(dir.path());
    let err = remote_url_for(&repo, "origin").unwrap_err();
    assert!(err.contains("origin"));
}

#[test]
fn remote_url_for_returns_url_when_present() {
    let dir = TempDir::new().unwrap();
    let repo = init_repo_with_commit(dir.path());
    repo.add_remote("origin", "https://github.com/a/b.git")
        .unwrap();
    assert_eq!(
        remote_url_for(&repo, "origin").unwrap(),
        "https://github.com/a/b.git"
    );
}

#[test]
fn collect_remote_configs_includes_workspace_active_repo() {
    let (dir, state) = temp_app_state();
    let repo = init_repo_with_commit(dir.path());
    repo.add_remote("origin", "https://github.com/a/b.git")
        .unwrap();
    {
        let mut store = state.data.lock().unwrap();
        store
            .workspace_mut()
            .set_active_repo(&dir.path().display().to_string())
            .unwrap();
    }

    let entries = collect_remote_configs(&state).unwrap();
    let origin = entries
        .iter()
        .find(|entry| entry.name == "origin" && entry.url == "https://github.com/a/b.git")
        .unwrap();
    assert!(origin
        .purpose
        .iter()
        .any(|purpose| purpose == "current_repo_remote"));
}

#[test]
fn collect_remote_configs_keeps_recent_repos_after_switching() {
    let (_store_dir, state) = temp_app_state();
    let first_dir = TempDir::new().unwrap();
    let second_dir = TempDir::new().unwrap();
    let first_repo = init_repo_with_commit(first_dir.path());
    let second_repo = init_repo_with_commit(second_dir.path());
    first_repo
        .add_remote("origin", "https://github.com/a/first.git")
        .unwrap();
    second_repo
        .add_remote("origin", "https://github.com/a/second.git")
        .unwrap();
    {
        let mut store = state.data.lock().unwrap();
        store
            .workspace_mut()
            .set_active_repo(&first_dir.path().display().to_string())
            .unwrap();
        store
            .workspace_mut()
            .set_active_repo(&second_dir.path().display().to_string())
            .unwrap();
    }

    let entries = collect_remote_configs(&state).unwrap();
    let first = entries
        .iter()
        .find(|entry| entry.url == "https://github.com/a/first.git")
        .unwrap();
    assert!(first
        .purpose
        .iter()
        .any(|purpose| purpose == "saved_repo_remote"));
    let second = entries
        .iter()
        .find(|entry| entry.url == "https://github.com/a/second.git")
        .unwrap();
    assert!(second
        .purpose
        .iter()
        .any(|purpose| purpose == "current_repo_remote"));
}

#[test]
fn collect_remote_configs_skips_non_git_workspace_active_repo() {
    let (dir, state) = temp_app_state();
    let non_git_path = dir.path().display().to_string();
    {
        let mut store = state.data.lock().unwrap();
        store
            .workspace_mut()
            .set_active_repo(&non_git_path)
            .unwrap();
    }

    let entries = collect_remote_configs(&state).unwrap();
    assert!(!entries
        .iter()
        .any(|entry| entry.repo_path.as_deref() == Some(non_git_path.as_str())));
}

#[test]
fn collect_remote_configs_keeps_valid_repos_when_bound_repo_is_invalid() {
    let (_store_dir, state) = temp_app_state();
    let valid_dir = TempDir::new().unwrap();
    let invalid_dir = TempDir::new().unwrap();
    let repo = init_repo_with_commit(valid_dir.path());
    repo.add_remote("origin", "https://github.com/a/b.git")
        .unwrap();
    {
        let mut store = state.data.lock().unwrap();
        store
            .workspace_mut()
            .bind_repo(&invalid_dir.path().display().to_string())
            .unwrap();
        store
            .workspace_mut()
            .bind_repo(&valid_dir.path().display().to_string())
            .unwrap();
    }

    let entries = collect_remote_configs(&state).unwrap();
    assert!(entries
        .iter()
        .any(|entry| entry.name == "origin" && entry.url == "https://github.com/a/b.git"));
}

#[test]
fn collect_remote_configs_includes_config_repo_local_path_when_checkout_exists() {
    let (store_dir, state) = temp_app_state();
    let checkout_dir = TempDir::new().unwrap();
    let repo = init_repo_with_commit(checkout_dir.path());
    repo.add_remote("origin", "https://github.com/a/config.git")
        .unwrap();
    let engine = na_data::SyncEngine::new(store_dir.path());
    engine
        .set_config(&na_data::SyncConfig {
            url: "https://github.com/a/config.git".to_string(),
            branch: "main".to_string(),
            active_environment_id: None,
            local_database_path: Some(checkout_dir.path().to_path_buf()),
            auto_sync: true,
            interval_seconds: 300,
        })
        .unwrap();

    let entries =
        collect_remote_configs_with_base_dir(&state, store_dir.path().to_path_buf()).unwrap();
    let config = entries
        .iter()
        .find(|entry| entry.url == "https://github.com/a/config.git")
        .unwrap();
    assert_eq!(
        config.repo_path.as_deref(),
        Some(checkout_dir.path().to_string_lossy().as_ref())
    );
    assert!(config
        .purpose
        .iter()
        .any(|purpose| purpose == "data_center_sync"));
}

#[test]
fn save_project_remote_config_and_bind_repo_persists_token_identity_and_binding() {
    let (dir, state) = temp_app_state();
    let repo_path = dir.path().display().to_string();

    save_project_remote_config_and_bind_repo(
        &state,
        &repo_path,
        "origin",
        "tok",
        Some("Alice"),
        Some("alice@example.com"),
    )
    .unwrap();

    let store = state.data.lock().unwrap();
    let token = store.credentials().project_token(&repo_path);
    assert_eq!(token, Some("tok".to_string()));
    assert!(store
        .workspace()
        .snapshot()
        .bound_repos
        .contains(&repo_path));

    let identity = remote_commit_identity_config(&store, &repo_path, "origin").unwrap();
    assert_eq!(identity.name, Some("Alice".to_string()));
    assert_eq!(identity.email, Some("alice@example.com".to_string()));
}

#[test]
fn save_project_remote_config_and_bind_repo_clears_identity_when_omitted() {
    let (dir, state) = temp_app_state();
    let repo_path = dir.path().display().to_string();

    save_project_remote_config_and_bind_repo(&state, &repo_path, "origin", "tok", None, None)
        .unwrap();

    let store = state.data.lock().unwrap();
    assert!(remote_commit_identity_config(&store, &repo_path, "origin").is_none());
}

#[test]
fn maybe_unbind_repo_without_remotes_unbinds_when_no_remotes_left() {
    let (dir, state) = temp_app_state();
    let repo_path = dir.path().display().to_string();
    {
        let mut store = state.data.lock().unwrap();
        store.workspace_mut().bind_repo(&repo_path).unwrap();
    }
    maybe_unbind_repo_without_remotes(&state, &repo_path, false).unwrap();
    let store = state.data.lock().unwrap();
    assert!(!store
        .workspace()
        .snapshot()
        .bound_repos
        .contains(&repo_path));
}

#[test]
fn maybe_unbind_repo_without_remotes_keeps_binding_when_remotes_exist() {
    let (dir, state) = temp_app_state();
    let repo_path = dir.path().display().to_string();
    {
        let mut store = state.data.lock().unwrap();
        store.workspace_mut().bind_repo(&repo_path).unwrap();
    }
    maybe_unbind_repo_without_remotes(&state, &repo_path, true).unwrap();
    let store = state.data.lock().unwrap();
    assert!(store
        .workspace()
        .snapshot()
        .bound_repos
        .contains(&repo_path));
}
