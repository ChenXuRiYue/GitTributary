use gt_flow::{parse_workflow, FlowRecord};

const VALID_WORKFLOW: &str = r#"
name: 每日晚间备份

gt:
  id: flow.daily_evening_backup
  enabled: false
  description: 每天 18:00 检查当前仓库

on:
  schedule:
    - cron: "0 18 * * *"
      timezone: Asia/Shanghai
  workflow_dispatch:

permissions:
  git: [status, commit, push]
  store: [read]
  network: true

jobs:
  backup:
    runs-on: gittributary-local
    steps:
      - id: commit
        uses: gittributary/git/commit-all@v1
      - id: push
        uses: gittributary/git/push@v1
"#;

#[test]
fn parses_valid_workflow_summary() {
    let summary = parse_workflow(VALID_WORKFLOW).unwrap();

    assert_eq!(summary.id, "flow.daily_evening_backup");
    assert_eq!(summary.name, "每日晚间备份");
    assert!(!summary.enabled);
    assert_eq!(summary.triggers.len(), 2);
    assert!(summary.triggers.iter().any(|trigger| trigger.kind == "schedule"));
    assert!(summary.permissions.iter().any(|permission| {
        permission.scope == "git" && permission.values == ["status", "commit", "push"]
    }));
    assert_eq!(summary.jobs[0].id, "backup");
    assert_eq!(summary.step_count, 2);
}

#[test]
fn rejects_missing_gt_id() {
    let workflow = VALID_WORKFLOW.replace("  id: flow.daily_evening_backup\n", "");
    let err = parse_workflow(&workflow).unwrap_err().to_string();

    assert!(err.contains("缺少必填字段 id"));
}

#[test]
fn rejects_step_without_uses() {
    let workflow = VALID_WORKFLOW.replace("        uses: gittributary/git/push@v1", "        name: Push");
    let err = parse_workflow(&workflow).unwrap_err().to_string();

    assert!(err.contains("steps[1].uses"));
}

#[test]
fn flow_record_round_trips_as_json() {
    let summary = parse_workflow(VALID_WORKFLOW).unwrap();
    let record = FlowRecord::new(
        VALID_WORKFLOW.to_string(),
        summary,
        Some("定时".to_string()),
        "2026-06-25T00:00:00Z".to_string(),
        "2026-06-25T00:00:00Z".to_string(),
    );

    let value = gt_flow::record_to_value(&record).unwrap();
    let restored = gt_flow::record_from_value(value).unwrap();

    assert_eq!(restored.summary.id, "flow.daily_evening_backup");
    assert_eq!(restored.enabled, record.enabled);
    assert_eq!(restored.folder.as_deref(), Some("定时"));
}
