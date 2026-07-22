use gt_flow::{FlowNodeDefinition, FlowNodeRegistry};

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

pub(super) fn test_node_registry() -> FlowNodeRegistry {
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

pub(super) const VALID_WORKFLOW: &str = r#"
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
