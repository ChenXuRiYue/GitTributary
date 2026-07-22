use gt_flow::{parse_workflow, EventDraft, EventPool, FlowRecord};
use serde_json::json;

use super::support::VALID_WORKFLOW;

#[test]
fn event_pool_matches_enabled_flow_by_event_and_filters() {
    let workflow = r#"
name: 提交后检查

gt:
  id: flow.after_commit_check
  enabled: true

on:
  git.commit.created:
    branches: [main]
    repositories:
      - /Users/mi/note

jobs:
  check:
    runs-on: gittributary-local
    steps:
      - id: notify
        uses: gittributary/files/assert-exists@v1
"#;
    let summary = parse_workflow(workflow).unwrap();
    assert_eq!(summary.triggers[0].filters["branches"], ["main"]);
    assert_eq!(
        summary.triggers[0].filters["repositories"],
        ["/Users/mi/note"]
    );

    let record = FlowRecord::new(
        workflow.to_string(),
        summary,
        Some("Git 事件".to_string()),
        "2026-06-25T00:00:00Z".to_string(),
        "2026-06-25T00:00:00Z".to_string(),
    );
    let mut pool = EventPool::new();

    let receipt = pool
        .publish(
            EventDraft {
                source: "gittributary://gt-git".to_string(),
                event_type: "git.commit.created".to_string(),
                subject: Some("repo:/Users/mi/note".to_string()),
                data: json!({
                    "repo": "/Users/mi/note",
                    "branch": "main",
                    "commit": "abc123",
                }),
            },
            &[record],
        )
        .unwrap();

    assert_eq!(receipt.event.specversion, "1.0");
    assert_eq!(receipt.matches.len(), 1);
    assert!(receipt.matches[0].matched);
    assert_eq!(receipt.run_intents.len(), 1);
    assert_eq!(receipt.run_intents[0].flow_id, "flow.after_commit_check");
    assert_eq!(pool.recent_events().len(), 1);
}

#[test]
fn event_pool_reports_filter_mismatch() {
    let workflow = VALID_WORKFLOW
        .replace("  enabled: false", "  enabled: true")
        .replace("  schedule:\n    - cron: \"0 18 * * *\"\n      timezone: Asia/Shanghai\n  workflow_dispatch:", "  git.commit.created:\n    branches: [main]");
    let record = FlowRecord::new(
        workflow.clone(),
        parse_workflow(&workflow).unwrap(),
        Some("Git 事件".to_string()),
        "2026-06-25T00:00:00Z".to_string(),
        "2026-06-25T00:00:00Z".to_string(),
    );
    let mut pool = EventPool::new();
    let receipt = pool
        .publish(
            EventDraft {
                source: "gittributary://gt-git".to_string(),
                event_type: "git.commit.created".to_string(),
                subject: None,
                data: json!({
                    "repo": "/Users/mi/note",
                    "branch": "dev",
                    "commit": "abc123",
                }),
            },
            &[record],
        )
        .unwrap();

    assert!(!receipt.matches[0].matched);
    assert_eq!(receipt.matches[0].reason, "filter_mismatch:branches");
    assert!(receipt.run_intents.is_empty());
}
