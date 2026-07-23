use super::*;
use tempfile::TempDir;

fn temp_store() -> (TempDir, DataHub) {
    let dir = TempDir::new().unwrap();
    let data = DataHub::open(dir.path()).unwrap();
    (dir, data)
}

#[test]
fn space_id_rejects_paths_and_accepts_stable_names() {
    assert!(valid_space_id("prod-cn.1"));
    assert!(valid_space_id("staging_blue"));
    assert!(valid_space_id("测试空间"));
    assert!(!valid_space_id("../prod"));
    assert!(!valid_space_id("prod/cn"));
    assert!(!valid_space_id(""));
}

#[test]
fn initialize_space_creates_sync_directories_and_marker() {
    let checkout = TempDir::new().unwrap();
    let root = initialize_space(checkout.path(), "staging").unwrap();

    assert!(root.join("data").is_dir());
    assert!(root.join("profiles").is_dir());
    assert!(root.join(".gitkeep").is_file());
    assert!(initialize_space(checkout.path(), "staging")
        .unwrap_err()
        .contains("已存在"));
}

#[test]
fn configured_remote_reuses_project_token() {
    let repo_dir = TempDir::new().unwrap();
    let repo = GitRepo::init(repo_dir.path()).unwrap();
    repo.add_remote("origin", "https://github.com/example/data.git")
        .unwrap();
    let data_dir = TempDir::new().unwrap();
    let mut data = DataHub::open(data_dir.path()).unwrap();
    data.credentials_mut()
        .set_project_token(&repo_dir.path().display().to_string(), "project-token")
        .unwrap();

    let selected =
        configured_remote_url_and_token(&data, &repo_dir.path().display().to_string(), "origin")
            .unwrap();

    assert_eq!(selected.0, "https://github.com/example/data.git");
    assert_eq!(selected.1, "project-token");
}

#[test]
fn configured_remote_rejects_ssh_and_missing_token() {
    let repo_dir = TempDir::new().unwrap();
    let repo = GitRepo::init(repo_dir.path()).unwrap();
    repo.add_remote("origin", "git@github.com:example/data.git")
        .unwrap();
    let data_dir = TempDir::new().unwrap();
    let data = DataHub::open(data_dir.path()).unwrap();

    let error =
        configured_remote_url_and_token(&data, &repo_dir.path().display().to_string(), "origin")
            .unwrap_err();
    assert!(error.contains("HTTPS"));
}

#[test]
fn require_config_repo_url_and_token_rejects_non_https() {
    let (_dir, store) = temp_store();
    let err = require_config_repo_url_and_token(&store, "git@github.com:a/b.git").unwrap_err();
    assert!(err.contains("HTTPS"));
}

#[test]
fn require_config_repo_url_and_token_requires_token_when_https() {
    let (_dir, store) = temp_store();
    let err = require_config_repo_url_and_token(&store, "https://github.com/a/b.git").unwrap_err();
    assert!(err.contains("Access Token"));
}

#[test]
fn require_config_repo_url_and_token_returns_token_when_set() {
    let (_dir, mut store) = temp_store();
    store
        .credentials_mut()
        .set_data_center_config_token("tok123")
        .unwrap();
    let token = require_config_repo_url_and_token(&store, "https://github.com/a/b.git").unwrap();
    assert_eq!(token, "tok123");
}
