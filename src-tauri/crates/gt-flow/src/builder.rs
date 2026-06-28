use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{
    parse_workflow, EventDefinition, FlowError, FlowNodeRegistry, FlowNodeSpec, FlowSummary, Result,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowBuildTriggerRequest {
    pub kind: String,
    #[serde(default)]
    pub filters: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowBuildStepRequest {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub uses: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowBuildRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub trigger: FlowBuildTriggerRequest,
    #[serde(default = "default_job_id")]
    pub job_id: String,
    #[serde(default)]
    pub job_name: Option<String>,
    pub steps: Vec<FlowBuildStepRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FlowDiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowDiagnostic {
    pub severity: FlowDiagnosticSeverity,
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowBuildDraft {
    pub raw_yaml: String,
    pub summary: FlowSummary,
    pub nodes: Vec<FlowNodeSpec>,
    pub diagnostics: Vec<FlowDiagnostic>,
}

pub fn build_flow_draft(
    request: FlowBuildRequest,
    event_definitions: &[EventDefinition],
    registry: &FlowNodeRegistry,
) -> Result<FlowBuildDraft> {
    let raw_yaml = render_flow_yaml(&request);
    build_flow_draft_from_yaml(raw_yaml, event_definitions, registry)
}

pub fn build_flow_draft_from_yaml(
    raw_yaml: String,
    event_definitions: &[EventDefinition],
    registry: &FlowNodeRegistry,
) -> Result<FlowBuildDraft> {
    let summary = parse_workflow(&raw_yaml)?;
    let nodes = registry.compile_summary(&summary);
    let diagnostics = validate_flow_summary(&summary, event_definitions, registry);
    Ok(FlowBuildDraft {
        raw_yaml,
        summary,
        nodes,
        diagnostics,
    })
}

pub fn validate_flow_summary(
    summary: &FlowSummary,
    event_definitions: &[EventDefinition],
    registry: &FlowNodeRegistry,
) -> Vec<FlowDiagnostic> {
    let mut diagnostics = Vec::new();
    validate_triggers(summary, event_definitions, &mut diagnostics);
    validate_jobs(summary, registry, &mut diagnostics);
    diagnostics
}

fn validate_triggers(
    summary: &FlowSummary,
    event_definitions: &[EventDefinition],
    diagnostics: &mut Vec<FlowDiagnostic>,
) {
    let definitions: BTreeMap<&str, &EventDefinition> = event_definitions
        .iter()
        .map(|definition| (definition.event_type.as_str(), definition))
        .collect();

    for trigger in &summary.triggers {
        let definition = definitions
            .get(trigger.kind.as_str())
            .copied()
            .or_else(|| trigger_definition_alias(&trigger.kind, &definitions));
        let Some(definition) = definition else {
            if is_virtual_trigger(&trigger.kind) {
                continue;
            }
            diagnostics.push(diagnostic(
                FlowDiagnosticSeverity::Error,
                "unknown_event",
                format!("on.{}", trigger.kind),
                format!("事件未登记: {}", trigger.kind),
            ));
            continue;
        };

        for filter in trigger.filters.keys() {
            if !definition.filters.iter().any(|item| item == filter) {
                diagnostics.push(diagnostic(
                    FlowDiagnosticSeverity::Warning,
                    "unknown_event_filter",
                    format!("on.{}.{}", trigger.kind, filter),
                    format!("事件 {} 未声明过滤字段 {}", trigger.kind, filter),
                ));
            }
        }
    }
}

fn trigger_definition_alias<'a>(
    kind: &str,
    definitions: &'a BTreeMap<&str, &'a EventDefinition>,
) -> Option<&'a EventDefinition> {
    match kind {
        "store_changed" => definitions.get("store.key.changed").copied(),
        _ => None,
    }
}

fn is_virtual_trigger(kind: &str) -> bool {
    matches!(kind, "schedule" | "file_watch")
}

fn validate_jobs(
    summary: &FlowSummary,
    registry: &FlowNodeRegistry,
    diagnostics: &mut Vec<FlowDiagnostic>,
) {
    for job in &summary.jobs {
        let mut seen_ids = BTreeSet::new();
        let mut prior_outputs = BTreeMap::<String, BTreeSet<String>>::new();

        for (step_index, step) in job.steps.iter().enumerate() {
            let fallback_id = format!("{}-{}", job.id, step_index + 1);
            let step_id = step.id.as_deref().unwrap_or(&fallback_id);
            let step_path = format!("jobs.{}.steps[{}]", job.id, step_index);

            if !seen_ids.insert(step_id.to_string()) {
                diagnostics.push(diagnostic(
                    FlowDiagnosticSeverity::Error,
                    "duplicate_step_id",
                    format!("{step_path}.id"),
                    format!("同一 job 内 step id 重复: {step_id}"),
                ));
            }

            let Some(definition) = registry.get(&step.uses) else {
                diagnostics.push(diagnostic(
                    FlowDiagnosticSeverity::Error,
                    "unknown_node",
                    format!("{step_path}.uses"),
                    format!("节点动作未登记: {}", step.uses),
                ));
                continue;
            };

            for input in definition.inputs_schema.keys() {
                if !step.inputs.contains_key(input) {
                    diagnostics.push(diagnostic(
                        FlowDiagnosticSeverity::Warning,
                        "missing_input",
                        format!("{step_path}.with.{input}"),
                        format!("节点 {} 缺少输入 {}", step.uses, input),
                    ));
                }
            }

            for (input, value) in &step.inputs {
                validate_step_references(
                    value,
                    &prior_outputs,
                    diagnostics,
                    format!("{step_path}.with.{input}"),
                );
            }

            prior_outputs.insert(
                step_id.to_string(),
                definition.outputs_schema.keys().cloned().collect(),
            );
        }
    }
}

fn validate_step_references(
    value: &str,
    prior_outputs: &BTreeMap<String, BTreeSet<String>>,
    diagnostics: &mut Vec<FlowDiagnostic>,
    path: String,
) {
    for expression in extract_expressions(value) {
        let Some(rest) = expression.strip_prefix("steps.") else {
            continue;
        };
        let mut parts = rest.split('.');
        let Some(step_id) = parts.next() else {
            continue;
        };
        if parts.next() != Some("outputs") {
            continue;
        }
        let Some(output) = parts.next() else {
            diagnostics.push(diagnostic(
                FlowDiagnosticSeverity::Error,
                "invalid_step_output_reference",
                path.clone(),
                format!("输出引用缺少字段: ${{{{ {expression} }}}}"),
            ));
            continue;
        };

        let Some(outputs) = prior_outputs.get(step_id) else {
            diagnostics.push(diagnostic(
                FlowDiagnosticSeverity::Error,
                "invalid_step_reference_order",
                path.clone(),
                format!("只能引用前置节点输出: ${{{{ {expression} }}}}"),
            ));
            continue;
        };

        if !outputs.contains(output) {
            diagnostics.push(diagnostic(
                FlowDiagnosticSeverity::Error,
                "unknown_step_output",
                path.clone(),
                format!("节点 {step_id} 未声明输出 {output}"),
            ));
        }
    }
}

fn render_flow_yaml(request: &FlowBuildRequest) -> String {
    let mut yaml = String::new();
    push_kv(&mut yaml, 0, "name", &request.name);
    yaml.push('\n');
    yaml.push_str("gt:\n");
    push_kv(&mut yaml, 2, "id", &request.id);
    yaml.push_str(&format!("  enabled: {}\n", request.enabled));
    if let Some(description) = request
        .description
        .as_deref()
        .filter(|item| !item.is_empty())
    {
        push_kv(&mut yaml, 2, "description", description);
    }
    yaml.push('\n');
    yaml.push_str("on:\n");
    render_trigger(&mut yaml, &request.trigger);
    yaml.push('\n');
    yaml.push_str("jobs:\n");
    let job_id = normalize_identifier(&request.job_id, "flow");
    yaml.push_str(&format!("  {job_id}:\n"));
    if let Some(job_name) = request.job_name.as_deref().filter(|item| !item.is_empty()) {
        push_kv(&mut yaml, 4, "name", job_name);
    }
    yaml.push_str("    runs-on: gittributary-local\n");
    yaml.push_str("    steps:\n");
    for (index, step) in request.steps.iter().enumerate() {
        let id = step
            .id
            .as_deref()
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| default_step_id(&step.uses, index));
        yaml.push_str(&format!(
            "      - id: {}\n",
            normalize_identifier(&id, "step")
        ));
        if let Some(name) = step.name.as_deref().filter(|item| !item.is_empty()) {
            push_kv(&mut yaml, 8, "name", name);
        }
        push_kv(&mut yaml, 8, "uses", &step.uses);
        if !step.inputs.is_empty() {
            yaml.push_str("        with:\n");
            for (key, value) in &step.inputs {
                push_kv(&mut yaml, 10, key, value);
            }
        }
    }
    yaml
}

fn render_trigger(yaml: &mut String, trigger: &FlowBuildTriggerRequest) {
    yaml.push_str(&format!("  {}:\n", trigger.kind));
    for (filter, values) in &trigger.filters {
        if values.is_empty() {
            continue;
        }
        if values.len() == 1 {
            push_kv(yaml, 4, filter, &values[0]);
        } else {
            yaml.push_str(&format!("    {filter}:\n"));
            for value in values {
                yaml.push_str(&format!("      - {}\n", quote_yaml_scalar(value)));
            }
        }
    }
}

fn push_kv(yaml: &mut String, indent: usize, key: &str, value: &str) {
    yaml.push_str(&format!(
        "{}{}: {}\n",
        " ".repeat(indent),
        key,
        quote_yaml_scalar(value)
    ));
}

fn quote_yaml_scalar(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }
    if value.contains("${{") || value.contains(':') || value.contains('#') || value.contains('"') {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn default_step_id(uses: &str, index: usize) -> String {
    uses.split('@')
        .next()
        .and_then(|left| left.rsplit('/').next())
        .map(|item| normalize_identifier(item, "step"))
        .filter(|item| item != "step")
        .unwrap_or_else(|| format!("step{}", index + 1))
}

fn normalize_identifier(value: &str, fallback: &str) -> String {
    let normalized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn extract_expressions(value: &str) -> Vec<String> {
    let mut expressions = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find("${{") {
        let after_start = &rest[start + 3..];
        let Some(end) = after_start.find("}}") else {
            break;
        };
        expressions.push(after_start[..end].trim().to_string());
        rest = &after_start[end + 2..];
    }
    expressions
}

fn diagnostic(
    severity: FlowDiagnosticSeverity,
    code: impl Into<String>,
    path: impl Into<String>,
    message: impl Into<String>,
) -> FlowDiagnostic {
    FlowDiagnostic {
        severity,
        code: code.into(),
        path: path.into(),
        message: message.into(),
    }
}

fn default_enabled() -> bool {
    false
}

fn default_job_id() -> String {
    "flow".to_string()
}

impl From<FlowBuildDraft> for serde_json::Value {
    fn from(value: FlowBuildDraft) -> Self {
        serde_json::to_value(value).unwrap_or_else(|error| {
            serde_json::json!({
                "error": FlowError::Record(error.to_string()).to_string(),
            })
        })
    }
}
