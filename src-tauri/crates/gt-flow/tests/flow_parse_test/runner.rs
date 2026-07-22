use gt_flow::{
    parse_workflow, run_flow_with_executor, run_flow_with_executor_and_observer,
    DryRunActionExecutor, FlowLifecycleEvent, FlowLifecycleEventKind, FlowRecord, FlowRunObserver,
    FlowRunRequest, FlowRunStatus,
};
use serde_json::json;

use super::support::test_node_registry;

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

#[test]
fn runner_observer_receives_only_safe_ordered_lifecycle_metadata() {
    #[derive(Default)]
    struct Collector(Vec<FlowLifecycleEvent>);
    impl FlowRunObserver for Collector {
        fn observe(&mut self, event: &FlowLifecycleEvent) {
            self.0.push(event.clone());
        }
    }

    let workflow = r#"
name: 观察测试

gt:
  id: flow.observer_test
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
          path: ${{ inputs.secret_path }}
"#;
    let summary = parse_workflow(workflow).unwrap();
    let record = FlowRecord::new(
        workflow.to_string(),
        summary,
        None,
        "2026-07-21T00:00:00Z".to_string(),
        "2026-07-21T00:00:00Z".to_string(),
    );
    let mut executor = DryRunActionExecutor;
    let mut observer = Collector::default();
    let report = run_flow_with_executor_and_observer(
        &record,
        FlowRunRequest {
            intent: None,
            inputs: json!({ "secret_path": "must-not-be-observed" }),
        },
        &test_node_registry(),
        json!({}),
        &mut executor,
        &mut observer,
    );

    assert_eq!(report.status, FlowRunStatus::Succeeded);
    assert_eq!(
        observer
            .0
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        vec![
            FlowLifecycleEventKind::RunStarted,
            FlowLifecycleEventKind::JobStarted,
            FlowLifecycleEventKind::NodeStarted,
            FlowLifecycleEventKind::NodeFinished,
            FlowLifecycleEventKind::JobFinished,
            FlowLifecycleEventKind::RunFinished,
        ]
    );
    let persisted_shape = serde_json::to_string(&observer.0).unwrap();
    assert!(!persisted_shape.contains("must-not-be-observed"));
    assert!(!persisted_shape.contains("inputs"));
    assert!(!persisted_shape.contains("outputs"));
    assert!(!persisted_shape.contains("error"));
}
