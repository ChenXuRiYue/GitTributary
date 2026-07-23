use std::collections::BTreeMap;
use std::fs;

use na_data::{RunResultStore, RunResultStoreConfig};
use na_flow::{FlowJobRun, FlowNodeRun, FlowRunReport, FlowRunStatus};

fn sensitive_report(run_id: &str, finished_at: &str) -> FlowRunReport {
    FlowRunReport {
        run_id: run_id.to_string(),
        flow_id: "flow.demo".to_string(),
        flow_name: "Secret flow name".to_string(),
        status: FlowRunStatus::Failed,
        trigger: "secret-trigger".to_string(),
        reason: "secret-reason".to_string(),
        started_at: "2026-07-21T00:00:00Z".to_string(),
        finished_at: finished_at.to_string(),
        jobs: vec![FlowJobRun {
            run_id: run_id.to_string(),
            flow_id: "flow.demo".to_string(),
            job_id: "publish".to_string(),
            status: FlowRunStatus::Failed,
            started_at: Some("2026-07-21T00:00:00Z".to_string()),
            finished_at: Some(finished_at.to_string()),
            nodes: vec![FlowNodeRun {
                run_id: run_id.to_string(),
                flow_id: "flow.demo".to_string(),
                job_id: "publish".to_string(),
                node_id: "upload".to_string(),
                uses: "secret-plugin-action".to_string(),
                status: FlowRunStatus::Failed,
                started_at: Some("2026-07-21T00:00:00Z".to_string()),
                finished_at: Some(finished_at.to_string()),
                inputs: BTreeMap::from([("token".to_string(), "secret-input".to_string())]),
                outputs: serde_json::json!({ "credential": "secret-output" }),
                message: Some("secret-message".to_string()),
                error: Some("secret-error".to_string()),
            }],
            error: Some("secret-job-error".to_string()),
        }],
        event: serde_json::json!({ "token": "secret-event" }),
        inputs: serde_json::json!({ "password": "secret-run-input" }),
        error: Some("secret-run-error".to_string()),
    }
}

#[test]
fn result_store_persists_only_whitelisted_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let store = RunResultStore::new(directory.path());
    let projected = store
        .write(&sensitive_report("run-safe", "2026-07-21T00:00:01Z"))
        .unwrap();

    assert_eq!(store.read("run-safe").unwrap(), Some(projected));
    let result_file = fs::read_dir(store.root())
        .unwrap()
        .find_map(|entry| {
            let path = entry.unwrap().path().join("result.json");
            path.exists().then_some(path)
        })
        .unwrap();
    let text = fs::read_to_string(result_file).unwrap();
    for secret in [
        "secret-input",
        "secret-output",
        "secret-message",
        "secret-error",
        "secret-event",
        "secret-run-input",
        "secret-trigger",
        "secret-reason",
        "Secret flow name",
        "secret-plugin-action",
    ] {
        assert!(
            !text.contains(secret),
            "persisted forbidden value: {secret}"
        );
    }
}

#[test]
fn result_store_is_immutable_and_rejects_non_terminal_reports() {
    let directory = tempfile::tempdir().unwrap();
    let store = RunResultStore::new(directory.path());
    let report = sensitive_report("run-once", "2026-07-21T00:00:01Z");
    store.write(&report).unwrap();
    assert!(store.write(&report).is_err());

    let mut running = sensitive_report("run-running", "");
    running.status = FlowRunStatus::Running;
    assert!(store.write(&running).is_err());
    assert_eq!(store.read("run-running").unwrap(), None);
}

#[test]
fn result_store_enforces_size_and_retention_limits() {
    let directory = tempfile::tempdir().unwrap();
    let tiny = RunResultStore::with_config(
        directory.path(),
        RunResultStoreConfig {
            max_result_bytes: 32,
            max_completed_results: 10,
        },
    );
    assert!(tiny
        .write(&sensitive_report("run-large", "2026-07-21T00:00:01Z"))
        .is_err());

    let retained = RunResultStore::with_config(
        directory.path(),
        RunResultStoreConfig {
            max_result_bytes: 1024 * 1024,
            max_completed_results: 1,
        },
    );
    retained
        .write(&sensitive_report("run-old", "2026-07-21T00:00:01Z"))
        .unwrap();
    retained
        .write(&sensitive_report("run-new", "2026-07-21T00:00:02Z"))
        .unwrap();
    assert_eq!(retained.read("run-old").unwrap(), None);
    assert!(retained.read("run-new").unwrap().is_some());
}
