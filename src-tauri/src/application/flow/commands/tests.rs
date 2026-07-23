use std::collections::BTreeMap;
use std::fs;

use serde_json::json;

use super::executor::{
    copy_dir_recursive, decode_plugin_node_outcome, is_empty_path, require_input,
    MAX_PLUGIN_NODE_OUTCOME_BYTES,
};
use super::run::flow_run_blocking;
use super::*;

#[test]
fn event_catalog_registers_journal_failure_notification() {
    let pool = na_flow::EventPool::new();
    assert!(pool
        .catalog()
        .iter()
        .any(|event| event.event_type == "flow.run.journal_failed"));
    assert!(pool
        .catalog()
        .iter()
        .any(|event| event.event_type == "flow.run.result_persistence_failed"));
}

#[test]
fn plugin_node_outcome_is_bounded_before_entering_run_report() {
    let oversized = json!({
        "outputs": { "payload": "x".repeat(MAX_PLUGIN_NODE_OUTCOME_BYTES) },
        "skipped": false,
        "message": null
    });
    let error = decode_plugin_node_outcome("plugin/example@v1", oversized).unwrap_err();
    assert!(error.to_string().contains("返回值超过"));
}

#[test]
fn flow_run_persists_lifecycle_before_returning_report() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();
    let workflow = r#"
name: Journal Demo
gn:
  id: journal-demo
  enabled: true
on:
  workflow_dispatch:
jobs:
  main:
    steps:
      - uses: noteaura/files/assert-exists@v1
        with:
          path: README.md
"#
    .trim()
    .to_string();
    let summary = na_flow::parse_workflow(&workflow).unwrap();
    let record = FlowRecord::new(
        workflow,
        summary,
        None,
        na_flow::now_rfc3339(),
        na_flow::now_rfc3339(),
    );
    data.flows_mut().save(&record).unwrap();
    let state = AppState {
        repo: std::sync::Mutex::new(None),
        data: std::sync::Mutex::new(data),
        event_pool: std::sync::Mutex::new(na_flow::EventPool::new()),
        node_registry: std::sync::Mutex::new(FlowNodeRegistry::new()),
        flow_execution: std::sync::Mutex::new(()),
        extensions: ExtensionRegistry::default(),
        plugin_host: std::sync::Arc::new(
            crate::application::plugins::host::PluginHostSupervisor::default(),
        ),
    };

    let report = flow_run_blocking("journal-demo".to_string(), None, &state).unwrap();
    assert_eq!(report.status, na_flow::FlowRunStatus::Failed);
    let data = state.data.lock().unwrap();
    let records = data.run_journal().read_run(&report.run_id).unwrap();
    assert_eq!(records.len(), 6);
    assert_eq!(records[0].kind, na_data::RunJournalEventKind::RunStarted);
    assert_eq!(records[1].kind, na_data::RunJournalEventKind::JobStarted);
    assert_eq!(records[2].kind, na_data::RunJournalEventKind::NodeStarted);
    assert_eq!(records[3].kind, na_data::RunJournalEventKind::NodeFinished);
    assert_eq!(records[4].kind, na_data::RunJournalEventKind::JobFinished);
    assert_eq!(records[5].kind, na_data::RunJournalEventKind::RunCompleted);
    let result = data.run_results().read(&report.run_id).unwrap().unwrap();
    assert_eq!(result.status, report.status);
    assert_eq!(
        result.jobs[0].nodes[0].node_id,
        report.jobs[0].nodes[0].node_id
    );
}

#[test]
fn inspects_only_executable_core_node_sources() {
    let registry = inspect_flow_node_sources(&ExtensionRegistry::default()).unwrap();
    let uses = registry
        .list()
        .into_iter()
        .map(|definition| definition.uses)
        .collect::<Vec<_>>();
    assert_eq!(uses.len(), 5);
    assert!(uses.contains(&"noteaura/files/assert-exists@v1".to_string()));
    assert!(uses.contains(&"noteaura/files/sync-dir@v1".to_string()));
    assert!(uses.contains(&"noteaura/git/commit-all@v1".to_string()));
    assert!(uses.contains(&"noteaura/git/push@v1".to_string()));
    assert!(uses.contains(&"noteaura/store/sync-now@v1".to_string()));
    assert!(!uses.iter().any(|uses| uses.contains("build-html")));
    assert!(!uses.iter().any(|uses| uses.contains("notify")));
    assert!(!uses.iter().any(|uses| uses.contains("publish-context")));
}

#[test]
fn inspects_active_plugin_node_sources() {
    let directory = tempfile::tempdir().unwrap();
    let backend = directory.path().join("backend");
    std::fs::create_dir_all(&backend).unwrap();
    let library = if cfg!(target_os = "windows") {
        "demo.dll"
    } else if cfg!(target_os = "macos") {
        "libdemo.dylib"
    } else {
        "libdemo.so"
    };
    std::fs::write(backend.join(library), b"placeholder").unwrap();
    std::fs::write(
        directory.path().join("manifest.json"),
        r#"{
          "schemaVersion": 1,
          "apiVersion": "1",
          "id": "com.example.demo",
          "name": "Demo",
          "version": "0.1.0",
          "contributes": {"flowNodes": [{
            "uses": "com.example.demo/action@v1",
            "name": "Demo action",
            "type": "action",
            "summary": "Run demo",
            "method": "flow.action"
          }]},
          "backend": {
            "runtime": "rust-cdylib",
            "entry": "backend",
            "library": "demo",
            "methods": {"flow.action": []}
          }
        }"#,
    )
    .unwrap();
    let extensions = ExtensionRegistry::default();
    extensions.register_path(directory.path()).unwrap();

    let registry = inspect_flow_node_sources(&extensions).unwrap();
    assert_eq!(registry.list().len(), 6);
    assert_eq!(
        registry.owner_of("com.example.demo/action@v1"),
        Some(&FlowNodeOwner::Plugin("com.example.demo".to_string()))
    );
}

#[test]
fn serializes_flow_node_catalog_source() {
    let item = FlowNodeCatalogItem {
        definition: FlowNodeDefinition {
            uses: "com.example.demo/action@v1".to_string(),
            name: "Demo".to_string(),
            node_type: "action".to_string(),
            summary: "Demo action".to_string(),
            description: String::new(),
            inputs_schema: BTreeMap::new(),
            outputs_schema: BTreeMap::new(),
        },
        source: FlowNodeCatalogSource {
            kind: "plugin",
            id: Some("com.example.demo".to_string()),
            name: "Demo Plugin".to_string(),
            version: Some("1.2.3".to_string()),
        },
    };
    let value = serde_json::to_value(item).unwrap();
    assert_eq!(value["uses"], "com.example.demo/action@v1");
    assert_eq!(value["source"]["kind"], "plugin");
    assert_eq!(value["source"]["id"], "com.example.demo");
    assert_eq!(value["source"]["name"], "Demo Plugin");
    assert_eq!(value["source"]["version"], "1.2.3");
}

#[test]
fn require_input_errors_when_missing() {
    let inputs: BTreeMap<String, String> = BTreeMap::new();
    assert!(require_input(&inputs, "path").is_err());
}

#[test]
fn require_input_returns_value_when_present() {
    let mut inputs = BTreeMap::new();
    inputs.insert("path".to_string(), "/tmp/x".to_string());
    assert_eq!(require_input(&inputs, "path").unwrap(), "/tmp/x");
}

#[test]
fn is_empty_path_detects_empty_dir_and_file() {
    let dir = tempfile::TempDir::new().unwrap();
    assert!(is_empty_path(dir.path()).unwrap());
    let file = dir.path().join("f.txt");
    fs::write(&file, "").unwrap();
    assert!(is_empty_path(&file).unwrap());
    fs::write(&file, "content").unwrap();
    assert!(!is_empty_path(&file).unwrap());
}

#[test]
fn copy_dir_recursive_copies_nested_files() {
    let src = tempfile::TempDir::new().unwrap();
    let dst = tempfile::TempDir::new().unwrap();
    fs::create_dir_all(src.path().join("nested")).unwrap();
    fs::write(src.path().join("a.txt"), "a").unwrap();
    fs::write(src.path().join("nested/b.txt"), "b").unwrap();

    let count = copy_dir_recursive(src.path(), dst.path()).unwrap();
    assert_eq!(count, 2);
    assert!(dst.path().join("a.txt").exists());
    assert!(dst.path().join("nested/b.txt").exists());
}

#[test]
fn copy_dir_recursive_errors_on_missing_source() {
    let dst = tempfile::TempDir::new().unwrap();
    let missing = dst.path().join("does-not-exist");
    let err = copy_dir_recursive(&missing, dst.path()).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
}
