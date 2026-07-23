use crate::{setting_keys, DataHub, RemoteCommitIdentity};
use na_flow::{parse_workflow, FlowRecord};

fn sample_flow() -> FlowRecord {
    let yaml = r#"
name: Demo
gn:
  id: demo
  enabled: true
on:
  workflow_dispatch:
jobs:
  main:
    steps:
      - uses: noteaura/files/assert-exists@v1
"#
    .trim()
    .to_string();
    let summary = parse_workflow(&yaml).unwrap();
    FlowRecord::new(
        yaml,
        summary,
        Some("未分类".to_string()),
        "2026-07-21T00:00:00Z".to_string(),
        "2026-07-21T00:00:00Z".to_string(),
    )
}

#[test]
fn settings_repository_round_trips_typed_values() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();

    data.settings_mut()
        .set(setting_keys::GIT_USERNAME, "Alice".to_string())
        .unwrap();

    assert_eq!(
        data.settings().get(setting_keys::GIT_USERNAME).unwrap(),
        Some("Alice".to_string())
    );
}

#[test]
fn workspace_repository_exposes_a_typed_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();
    data.workspace_mut().initialize().unwrap();
    data.workspace_mut()
        .sync(Some("/tmp/repo"), Some("main"))
        .unwrap();

    let snapshot = data.workspace().snapshot();
    assert_eq!(snapshot.active_repo.as_deref(), Some("/tmp/repo"));
    assert_eq!(snapshot.active_branch.as_deref(), Some("main"));
    assert_eq!(snapshot.recent_repos, vec!["/tmp/repo"]);
}

#[test]
fn flow_repository_round_trips_domain_records() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();
    let flow = sample_flow();

    data.flows_mut().save(&flow).unwrap();
    assert_eq!(data.flows().get("demo").unwrap(), Some(flow.clone()));
    assert_eq!(data.flows().list().unwrap(), vec![flow]);

    data.flows_mut().delete("demo").unwrap();
    assert_eq!(data.flows().get("demo").unwrap(), None);
}

#[test]
fn malformed_flow_blocks_strict_reads_but_can_be_overwritten() {
    let directory = tempfile::tempdir().unwrap();
    let mut raw = crate::storage::Store::open(directory.path()).unwrap();
    raw.set(
        na_flow::FLOW_NAMESPACE,
        &na_flow::workflow_key("demo"),
        serde_json::json!({ "schema": "obsolete" }),
    )
    .unwrap();
    let mut data = DataHub::from_store(raw);

    assert!(data.flows().get("demo").is_err());
    assert!(data.flows().list().is_err());

    let flow = sample_flow();
    data.flows_mut().save(&flow).unwrap();
    assert_eq!(data.flows().get("demo").unwrap(), Some(flow));
}

#[test]
fn credentials_repository_preserves_legacy_storage_contract() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();

    data.credentials_mut()
        .set_global_token("global-token")
        .unwrap();
    data.credentials_mut()
        .set_data_center_config_token("config-token")
        .unwrap();
    data.credentials_mut()
        .set_project_token("/repo/a", "project-token")
        .unwrap();
    data.credentials_mut()
        .set_ssh_key("/keys/id_ed25519", Some("passphrase"))
        .unwrap();

    drop(data);
    let raw = crate::storage::Store::open(directory.path()).unwrap();
    assert_eq!(
        raw.get("private.credentials", "git.access_token"),
        Some(serde_json::json!("global-token"))
    );
    assert_eq!(
        raw.get("private.credentials", "project./repo/a.token"),
        Some(serde_json::json!("project-token"))
    );
    assert_eq!(
        raw.get("private.credentials", "data_center.config_repo.token")
            .and_then(|value| value.as_str().map(str::to_string))
            .as_deref(),
        Some("config-token")
    );
    assert_eq!(
        raw.get("private.credentials", "git.ssh_key_path"),
        Some(serde_json::json!("/keys/id_ed25519"))
    );

    drop(raw);
    let mut data = DataHub::open(directory.path()).unwrap();
    data.credentials_mut()
        .set_ssh_key("/keys/id_ed25519-new", None)
        .unwrap();
    drop(data);
    let raw = crate::storage::Store::open(directory.path()).unwrap();
    assert!(raw
        .get("private.credentials", "git.ssh_passphrase")
        .is_none());
}

#[test]
fn credentials_repository_lists_only_non_empty_project_tokens() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();
    data.credentials_mut()
        .set_project_token("/repo/a", "token")
        .unwrap();
    data.credentials_mut()
        .set_project_token("/repo/empty", "")
        .unwrap();
    drop(data);
    let mut raw = crate::storage::Store::open(directory.path()).unwrap();
    raw.set(
        "private.credentials",
        "project..token",
        serde_json::json!("invalid"),
    )
    .unwrap();
    raw.set(
        "private.credentials",
        "project./repo/not-a-string.token",
        serde_json::json!(42),
    )
    .unwrap();
    let data = DataHub::from_store(raw);

    assert_eq!(
        data.credentials().project_token_repo_paths(),
        vec!["/repo/a"]
    );
}

#[test]
fn credentials_repository_persists_project_token_deletion() {
    let directory = tempfile::tempdir().unwrap();
    {
        let mut data = DataHub::open(directory.path()).unwrap();
        data.credentials_mut()
            .set_project_token("/repo/a", "token")
            .unwrap();
        data.credentials_mut()
            .clear_project_token("/repo/a")
            .unwrap();
    }

    let reopened = DataHub::open(directory.path()).unwrap();
    assert_eq!(reopened.credentials().project_token("/repo/a"), None);
    assert!(reopened.credentials().project_token_repo_paths().is_empty());
}

#[test]
fn remote_metadata_repository_normalizes_and_deletes_identity() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();
    let identity = RemoteCommitIdentity::normalized(Some(" Alice "), Some(" alice@example.com "));

    data.remote_metadata_mut()
        .save_commit_identity("/repo/a", "origin", &identity)
        .unwrap();
    assert_eq!(
        data.remote_metadata()
            .commit_identity("/repo/a", "origin")
            .unwrap(),
        Some(RemoteCommitIdentity {
            name: Some("Alice".to_string()),
            email: Some("alice@example.com".to_string()),
        })
    );
    drop(data);
    let raw = crate::storage::Store::open(directory.path()).unwrap();
    assert!(raw
        .get("private.local", "remote./repo/a.origin.meta")
        .is_some());
    let mut data = DataHub::from_store(raw);

    let empty = RemoteCommitIdentity::normalized(Some(" "), None);
    data.remote_metadata_mut()
        .save_commit_identity("/repo/a", "origin", &empty)
        .unwrap();
    assert_eq!(
        data.remote_metadata()
            .commit_identity("/repo/a", "origin")
            .unwrap(),
        None
    );
}

#[test]
fn remote_metadata_repository_migrates_legacy_default_remote_url() {
    let directory = tempfile::tempdir().unwrap();
    let mut raw = crate::storage::Store::open(directory.path()).unwrap();
    raw.set(
        "settings",
        "git.default_remote_url",
        serde_json::json!("https://example.com/config.git"),
    )
    .unwrap();
    let mut data = DataHub::from_store(raw);

    assert_eq!(
        data.remote_metadata().default_remote_url().as_deref(),
        Some("https://example.com/config.git")
    );
    data.remote_metadata_mut()
        .migrate_default_remote_url()
        .unwrap();

    drop(data);
    let raw = crate::storage::Store::open(directory.path()).unwrap();
    assert!(raw.get("settings", "git.default_remote_url").is_none());
    assert_eq!(
        raw.get("private.local", "git.default_remote_url"),
        Some(serde_json::json!("https://example.com/config.git"))
    );
}
