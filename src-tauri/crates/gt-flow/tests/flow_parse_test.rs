use serde_json::json;

use std::collections::BTreeMap;

use gt_flow::{
    build_flow_draft, parse_workflow, run_flow_with_executor, DryRunActionExecutor, EventDraft,
    EventPool, FlowBuildRequest, FlowBuildStepRequest, FlowBuildTriggerRequest, FlowNodeDefinition,
    FlowNodeRegistry, FlowRecord, FlowRunRequest, FlowRunStatus,
};

fn node_definition(
    uses: &str,
    node_type: &str,
    inputs: &[(&str, &str)],
    outputs: &[(&str, &str)],
) -> FlowNodeDefinition {
    FlowNodeDefinition {
        uses: uses.to_string(),
        name: uses.to_string(),
        node_type: node_type.to_string(),
        summary: uses.to_string(),
        description: String::new(),
        inputs_schema: inputs
            .iter()
            .map(|(name, kind)| ((*name).to_string(), (*kind).to_string()))
            .collect(),
        outputs_schema: outputs
            .iter()
            .map(|(name, kind)| ((*name).to_string(), (*kind).to_string()))
            .collect(),
    }
}

fn test_node_registry() -> FlowNodeRegistry {
    let mut registry = FlowNodeRegistry::new();
    registry
        .replace_core_nodes(vec![
            node_definition(
                "gittributary/files/assert-exists@v1",
                "validate",
                &[("path", "string")],
                &[("path", "string")],
            ),
            node_definition(
                "gittributary/git/push@v1",
                "git",
                &[
                    ("repo", "string"),
                    ("remote", "string"),
                    ("branch", "string"),
                ],
                &[("remote", "string"), ("branch", "string")],
            ),
        ])
        .unwrap();
    registry
        .replace_plugin_nodes(
            "com.example.publisher",
            vec![node_definition(
                "com.example.publisher/build@v1",
                "build",
                &[("repo", "string"), ("output", "string")],
                &[("html_dir", "string")],
            )],
        )
        .unwrap();
    registry
}

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
    assert!(summary
        .triggers
        .iter()
        .any(|trigger| trigger.kind == "schedule"));
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
    let workflow = VALID_WORKFLOW.replace(
        "        uses: gittributary/git/push@v1",
        "        name: Push",
    );
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

#[test]
fn compiles_flow_steps_into_node_specs() {
    let workflow = r#"
name: 发布笔记博客

gt:
  id: flow.publish_notes_blog
  enabled: true

on:
  workflow_dispatch:

jobs:
  publish:
    runs-on: gittributary-local
    steps:
      - id: build
        name: 构建 HTML
        uses: com.example.publisher/build@v1
        with:
          repo: ${{ gt.workspace.active_repo }}
          output: /tmp/blog-html
      - id: push
        uses: gittributary/git/push@v1
        with:
          repo: /tmp/blog
          remote: origin
          branch: main
"#;
    let summary = parse_workflow(workflow).unwrap();
    assert_eq!(summary.jobs[0].steps[0].inputs["output"], "/tmp/blog-html");

    let record = FlowRecord::new(
        workflow.to_string(),
        summary,
        Some("手动".to_string()),
        "2026-06-25T00:00:00Z".to_string(),
        "2026-06-25T00:00:00Z".to_string(),
    );
    let registry = test_node_registry();
    let nodes = registry.compile_record(&record);

    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].id, "build");
    assert_eq!(nodes[0].node_type, "build");
    assert!(nodes[0].known);
    assert_eq!(nodes[1].uses, "gittributary/git/push@v1");
    assert_eq!(nodes[1].inputs["branch"], "main");
}

#[test]
fn builds_flow_draft_from_event_and_nodes() {
    let pool = EventPool::new();
    let registry = test_node_registry();
    let request = FlowBuildRequest {
        id: "flow.publish_notes_blog".to_string(),
        name: "发布笔记博客".to_string(),
        description: Some("构建并发布笔记博客".to_string()),
        enabled: false,
        trigger: FlowBuildTriggerRequest {
            kind: "git.commit.created".to_string(),
            filters: BTreeMap::from([("branches".to_string(), vec!["main".to_string()])]),
        },
        job_id: "publish".to_string(),
        job_name: None,
        steps: vec![
            FlowBuildStepRequest {
                id: Some("context".to_string()),
                name: None,
                uses: "gittributary/files/assert-exists@v1".to_string(),
                inputs: BTreeMap::from([(
                    "path".to_string(),
                    "${{ gt.workspace.active_repo }}".to_string(),
                )]),
            },
            FlowBuildStepRequest {
                id: Some("build".to_string()),
                name: None,
                uses: "com.example.publisher/build@v1".to_string(),
                inputs: BTreeMap::from([
                    (
                        "repo".to_string(),
                        "${{ steps.context.outputs.path }}".to_string(),
                    ),
                    ("output".to_string(), "/tmp/output".to_string()),
                ]),
            },
        ],
    };

    let draft = build_flow_draft(request, &pool.catalog(), &registry).unwrap();

    assert!(draft.raw_yaml.contains("on:\n  git.commit.created:"));
    assert_eq!(draft.summary.id, "flow.publish_notes_blog");
    assert_eq!(draft.nodes.len(), 2);
    assert!(draft
        .diagnostics
        .iter()
        .all(|diagnostic| diagnostic.code != "unknown_node"));
}

#[test]
fn draft_reports_invalid_forward_output_reference() {
    let workflow = r#"
name: 引用错误

gt:
  id: flow.bad_reference
  enabled: true

on:
  workflow_dispatch:

jobs:
  test:
    runs-on: gittributary-local
    steps:
      - id: build
        uses: com.example.publisher/build@v1
        with:
          repo: ${{ steps.context.outputs.path }}
          output: /tmp/out
      - id: context
        uses: gittributary/files/assert-exists@v1
        with:
          path: /tmp/source
"#;
    let pool = EventPool::new();
    let registry = test_node_registry();
    let draft =
        gt_flow::build_flow_draft_from_yaml(workflow.to_string(), &pool.catalog(), &registry)
            .unwrap();

    assert!(draft
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "invalid_step_reference_order"));
}

#[test]
fn runner_executes_steps_and_resolves_outputs() {
    let workflow = r#"
name: 运行测试

gt:
  id: flow.runner_test
  enabled: true

on:
  workflow_dispatch:

jobs:
  publish:
    runs-on: gittributary-local
    steps:
      - id: source
        uses: gittributary/files/assert-exists@v1
        with:
          path: /tmp/source
      - id: verify
        uses: gittributary/files/assert-exists@v1
        with:
          path: ${{ steps.source.outputs.path }}
"#;
    let summary = parse_workflow(workflow).unwrap();
    let record = FlowRecord::new(
        workflow.to_string(),
        summary,
        Some("手动".to_string()),
        "2026-06-25T00:00:00Z".to_string(),
        "2026-06-25T00:00:00Z".to_string(),
    );
    let registry = test_node_registry();
    let mut executor = DryRunActionExecutor;

    let report = run_flow_with_executor(
        &record,
        FlowRunRequest {
            intent: None,
            inputs: json!({}),
        },
        &registry,
        json!({
            "active_repo": "/tmp/source",
            "active_branch": "main",
        }),
        &mut executor,
    );

    assert_eq!(report.status, FlowRunStatus::Succeeded);
    let verify = &report.jobs[0].nodes[1];
    assert_eq!(verify.inputs["path"], "/tmp/source");
    assert_eq!(verify.outputs["path"], "/tmp/source");
}
