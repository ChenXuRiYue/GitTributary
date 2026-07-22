use std::collections::BTreeMap;

use gt_flow::{
    build_flow_draft, parse_workflow, EventPool, FlowBuildRequest, FlowBuildStepRequest,
    FlowBuildTriggerRequest, FlowRecord,
};

use super::support::test_node_registry;

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
