//! # gt-flow
//!
//! GitTributary Flow 的轻量领域层。
//! 负责解析、构造、校验和编排 workflow。具体业务动作由宿主应用注入执行器。

mod builder;
mod event;
mod node;
mod runner;

use std::collections::BTreeMap;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use builder::{
    build_flow_draft, build_flow_draft_from_yaml, validate_flow_summary, FlowBuildDraft,
    FlowBuildRequest, FlowBuildStepRequest, FlowBuildTriggerRequest, FlowDiagnostic,
    FlowDiagnosticSeverity,
};
pub use event::{
    CloudEvent, EventDefinition, EventDraft, EventPool, EventReceipt, FlowRunIntent,
    FlowTriggerMatch,
};
pub use node::{
    builtin_node_definitions, compile_flow_nodes, FlowNodeDefinition, FlowNodeRegistry,
    FlowNodeSpec,
};
pub use runner::{
    run_flow_with_executor, DryRunActionExecutor, FlowActionExecutor, FlowActionOutcome,
    FlowExecutionContext, FlowJobRun, FlowNodeRun, FlowRunReport, FlowRunRequest, FlowRunStatus,
};

pub const FLOW_NAMESPACE: &str = "flows";
pub const FLOW_KEY_PREFIX: &str = "workflow.";
pub const FLOW_FOLDERS_KEY: &str = "folders";
pub const DEFAULT_FLOW_FOLDER: &str = "未分类";

#[derive(Debug, Error)]
pub enum FlowError {
    #[error("YAML 解析失败: {0}")]
    Yaml(String),
    #[error("Flow 校验失败: {0}")]
    Validation(String),
    #[error("Flow 记录格式无效: {0}")]
    Record(String),
}

pub type Result<T> = std::result::Result<T, FlowError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowTriggerSummary {
    pub kind: String,
    pub label: String,
    pub detail: Option<String>,
    #[serde(default)]
    pub filters: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowStepSummary {
    pub id: Option<String>,
    pub name: Option<String>,
    pub uses: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowJobSummary {
    pub id: String,
    pub name: Option<String>,
    pub steps: Vec<FlowStepSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub triggers: Vec<FlowTriggerSummary>,
    pub jobs: Vec<FlowJobSummary>,
    pub step_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowRecord {
    pub raw_yaml: String,
    pub summary: FlowSummary,
    pub enabled: bool,
    #[serde(default)]
    pub folder: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl FlowRecord {
    pub fn new(
        raw_yaml: String,
        summary: FlowSummary,
        folder: Option<String>,
        created_at: String,
        updated_at: String,
    ) -> Self {
        let enabled = summary.enabled;
        let folder = Some(normalize_folder(folder.as_deref(), Some(&summary)));
        Self {
            raw_yaml,
            summary,
            enabled,
            folder,
            created_at,
            updated_at,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool, updated_at: String) {
        self.enabled = enabled;
        self.summary.enabled = enabled;
        self.updated_at = updated_at;
    }
}

pub fn normalize_folder(folder: Option<&str>, summary: Option<&FlowSummary>) -> String {
    let normalized = folder
        .unwrap_or("")
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .collect::<Vec<_>>()
        .join("/");

    if normalized.is_empty() {
        summary
            .map(default_folder_for_summary)
            .unwrap_or_else(|| DEFAULT_FLOW_FOLDER.to_string())
    } else {
        normalized
    }
}

pub fn default_folder_for_summary(summary: &FlowSummary) -> String {
    match summary
        .triggers
        .first()
        .map(|trigger| trigger.kind.as_str())
    {
        Some("schedule") => "定时".to_string(),
        Some("workflow_dispatch") => "手动".to_string(),
        Some("file_watch") => "监听".to_string(),
        Some(kind) if kind.starts_with("git.") => "Git 事件".to_string(),
        Some(_) => "事件".to_string(),
        None => DEFAULT_FLOW_FOLDER.to_string(),
    }
}

#[derive(Debug, Clone)]
struct YamlLine {
    indent: usize,
    text: String,
    line_no: usize,
}

#[derive(Debug, Clone)]
struct KeyValue {
    key: String,
    value: Option<String>,
}

#[derive(Debug, Clone)]
struct StepDraft {
    id: Option<String>,
    name: Option<String>,
    uses: Option<String>,
    inputs: BTreeMap<String, String>,
}

pub fn workflow_key(id: &str) -> String {
    format!("{FLOW_KEY_PREFIX}{id}")
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn parse_workflow(workflow: &str) -> Result<FlowSummary> {
    let lines = parse_lines(workflow)?;
    if lines.is_empty() {
        return Err(FlowError::Validation("Flow YAML 不能为空".to_string()));
    }

    let name = top_scalar(&lines, "name")?;
    let gt_range = section_range(&lines, "gt")?;
    let id = section_scalar(&lines, gt_range.clone(), "id")?;
    let enabled = parse_bool(&section_scalar(&lines, gt_range.clone(), "enabled")?)
        .ok_or_else(|| FlowError::Validation("enabled 必须是布尔值".to_string()))?;
    let description = section_scalar_optional(&lines, gt_range, "description");

    let on_range = section_range(&lines, "on")?;
    let triggers = parse_triggers(&lines, on_range)?;
    if triggers.is_empty() {
        return Err(FlowError::Validation(
            "on 至少需要声明一个触发器".to_string(),
        ));
    }

    let jobs = parse_jobs(&lines, section_range(&lines, "jobs")?)?;
    if jobs.is_empty() {
        return Err(FlowError::Validation(
            "jobs 至少需要声明一个 job".to_string(),
        ));
    }
    let step_count = jobs.iter().map(|job| job.steps.len()).sum();

    Ok(FlowSummary {
        id,
        name,
        description,
        enabled,
        triggers,
        jobs,
        step_count,
    })
}

fn parse_lines(workflow: &str) -> Result<Vec<YamlLine>> {
    let mut lines = Vec::new();
    for (index, raw) in workflow.lines().enumerate() {
        if raw.starts_with('\t') || raw.contains("\n\t") {
            return Err(FlowError::Yaml(format!(
                "第 {} 行不能使用 tab 缩进",
                index + 1
            )));
        }
        let without_comment = strip_comment(raw);
        let trimmed_end = without_comment.trim_end();
        if trimmed_end.trim().is_empty() {
            continue;
        }
        let indent = trimmed_end.chars().take_while(|ch| *ch == ' ').count();
        lines.push(YamlLine {
            indent,
            text: trimmed_end[indent..].trim().to_string(),
            line_no: index + 1,
        });
    }
    Ok(lines)
}

fn strip_comment(input: &str) -> String {
    let mut single = false;
    let mut double = false;
    let mut previous = '\0';
    for (index, ch) in input.char_indices() {
        match ch {
            '\'' if !double => single = !single,
            '"' if !single && previous != '\\' => double = !double,
            '#' if !single && !double && is_comment_start(input, index) => {
                return input[..index].to_string();
            }
            _ => {}
        }
        previous = ch;
    }
    input.to_string()
}

fn is_comment_start(input: &str, index: usize) -> bool {
    if index == 0 {
        return true;
    }
    input[..index]
        .chars()
        .last()
        .map(|ch| ch.is_whitespace())
        .unwrap_or(true)
}

fn parse_key_value(text: &str) -> Option<KeyValue> {
    let (key, value) = text.split_once(':')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    let value = value.trim();
    Some(KeyValue {
        key: key.to_string(),
        value: if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        },
    })
}

fn top_scalar(lines: &[YamlLine], key: &str) -> Result<String> {
    let line = lines
        .iter()
        .find(|line| {
            line.indent == 0 && parse_key_value(&line.text).is_some_and(|kv| kv.key == key)
        })
        .ok_or_else(|| FlowError::Validation(format!("缺少必填字段 {key}")))?;
    let kv = parse_key_value(&line.text).expect("checked above");
    scalar_value(&kv, key)
}

fn section_range(lines: &[YamlLine], key: &str) -> Result<std::ops::Range<usize>> {
    section_range_optional(lines, key)
        .ok_or_else(|| FlowError::Validation(format!("缺少必填字段 {key}")))
}

fn section_range_optional(lines: &[YamlLine], key: &str) -> Option<std::ops::Range<usize>> {
    let start = lines.iter().position(|line| {
        line.indent == 0 && parse_key_value(&line.text).is_some_and(|kv| kv.key == key)
    })?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| (line.indent == 0).then_some(index))
        .unwrap_or(lines.len());
    Some((start + 1)..end)
}

fn section_scalar(lines: &[YamlLine], range: std::ops::Range<usize>, key: &str) -> Result<String> {
    section_scalar_optional(lines, range, key)
        .ok_or_else(|| FlowError::Validation(format!("缺少必填字段 {key}")))
}

fn section_scalar_optional(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
    key: &str,
) -> Option<String> {
    let base_indent = child_indent(lines, range.clone())?;
    lines[range]
        .iter()
        .filter(|line| line.indent == base_indent && !line.text.starts_with('-'))
        .find_map(|line| {
            let kv = parse_key_value(&line.text)?;
            (kv.key == key)
                .then(|| scalar_value(&kv, key).ok())
                .flatten()
        })
}

fn scalar_value(kv: &KeyValue, key: &str) -> Result<String> {
    let value = kv
        .value
        .as_ref()
        .ok_or_else(|| FlowError::Validation(format!("{key} 必须是非空字符串")))?;
    let value = unquote(value);
    if value.trim().is_empty() {
        return Err(FlowError::Validation(format!("{key} 必须是非空字符串")));
    }
    Ok(value)
}

fn child_indent(lines: &[YamlLine], range: std::ops::Range<usize>) -> Option<usize> {
    lines[range].iter().map(|line| line.indent).min()
}

fn parse_triggers(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
) -> Result<Vec<FlowTriggerSummary>> {
    let Some(base_indent) = child_indent(lines, range.clone()) else {
        return Ok(Vec::new());
    };
    let mut triggers = Vec::new();
    let mut index = range.start;
    while index < range.end {
        let line = &lines[index];
        if line.indent != base_indent {
            index += 1;
            continue;
        }
        let kv = parse_key_value(&line.text).ok_or_else(|| {
            FlowError::Yaml(format!(
                "第 {} 行触发器声明必须是 key: value 形式",
                line.line_no
            ))
        })?;
        let trigger_end = next_sibling_index(lines, index + 1, range.end, base_indent);
        let trigger_range = (index + 1)..trigger_end;
        let detail = trigger_detail(&kv.key, lines, trigger_range.clone());
        let filters = trigger_filters(&kv.key, lines, trigger_range);
        triggers.push(FlowTriggerSummary {
            kind: kv.key.clone(),
            label: kv.key,
            detail,
            filters,
        });
        index = trigger_end;
    }
    Ok(triggers)
}

fn trigger_detail(kind: &str, lines: &[YamlLine], range: std::ops::Range<usize>) -> Option<String> {
    match kind {
        "workflow_dispatch" => Some("手动触发".to_string()),
        "schedule" => {
            let crons = collect_nested_scalars(lines, range, "cron");
            if crons.is_empty() {
                None
            } else {
                Some(crons.join(", "))
            }
        }
        "file_watch" => mapping_fields(lines, range, &["glob", "paths", "types", "debounce"]),
        _ => mapping_fields(
            lines,
            range,
            &["branches", "repositories", "paths", "types"],
        ),
    }
}

fn mapping_fields(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
    fields: &[&str],
) -> Option<String> {
    let mut parts = Vec::new();
    for field in fields {
        let values = collect_nested_scalars(lines, range.clone(), field);
        if !values.is_empty() {
            parts.push(format!("{field}: {}", values.join(", ")));
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

fn trigger_filters(
    kind: &str,
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
) -> BTreeMap<String, Vec<String>> {
    let fields: &[&str] = match kind {
        "file_watch" => &["paths", "types", "glob"],
        "store_changed" => &["namespace", "keys"],
        _ => &[
            "branches",
            "repositories",
            "paths",
            "types",
            "namespace",
            "keys",
        ],
    };
    fields
        .iter()
        .filter_map(|field| {
            let values = collect_nested_scalars(lines, range.clone(), field);
            (!values.is_empty()).then(|| ((*field).to_string(), values))
        })
        .collect()
}

fn collect_nested_scalars(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
    key: &str,
) -> Vec<String> {
    let mut values = Vec::new();
    for (offset, line) in lines[range.clone()].iter().enumerate() {
        let text = line.text.strip_prefix("- ").unwrap_or(&line.text);
        let Some(kv) = parse_key_value(text) else {
            continue;
        };
        if kv.key != key {
            continue;
        }
        if let Some(value) = kv.value {
            match parse_scalar_or_list(&value) {
                Ok(parsed) => values.extend(parsed),
                Err(_) => values.push(unquote(&value)),
            }
        } else {
            let line_index = range.start + offset;
            values.extend(collect_sequence_values(
                lines,
                line_index + 1,
                range.end,
                line.indent,
            ));
        }
    }
    values
}

fn parse_jobs(lines: &[YamlLine], range: std::ops::Range<usize>) -> Result<Vec<FlowJobSummary>> {
    let Some(base_indent) = child_indent(lines, range.clone()) else {
        return Ok(Vec::new());
    };
    let mut jobs = Vec::new();
    let mut index = range.start;
    while index < range.end {
        let line = &lines[index];
        if line.indent != base_indent {
            index += 1;
            continue;
        }
        let kv = parse_key_value(&line.text).ok_or_else(|| {
            FlowError::Yaml(format!(
                "第 {} 行 job 声明必须是 key: value 形式",
                line.line_no
            ))
        })?;
        let job_end = next_sibling_index(lines, index + 1, range.end, base_indent);
        let name = direct_child_scalar(lines, (index + 1)..job_end, line.indent, "name");
        let steps_range = direct_child_range(lines, (index + 1)..job_end, line.indent, "steps")
            .ok_or_else(|| FlowError::Validation(format!("jobs.{}.steps 是必填字段", kv.key)))?;
        let steps = parse_steps(lines, steps_range, &kv.key)?;
        jobs.push(FlowJobSummary {
            id: kv.key,
            name,
            steps,
        });
        index = job_end;
    }
    Ok(jobs)
}

fn parse_steps(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
    job_id: &str,
) -> Result<Vec<FlowStepSummary>> {
    let mut drafts = Vec::<StepDraft>::new();
    let mut current: Option<StepDraft> = None;
    let mut index = range.start;
    while index < range.end {
        let line = &lines[index];
        if let Some(rest) = line.text.strip_prefix("- ") {
            if let Some(step) = current.take() {
                drafts.push(step);
            }
            let mut step = StepDraft {
                id: None,
                name: None,
                uses: None,
                inputs: BTreeMap::new(),
            };
            if let Some(kv) = parse_key_value(rest) {
                apply_step_field(&mut step, kv);
            } else if !rest.trim().is_empty() {
                return Err(FlowError::Yaml(format!(
                    "第 {} 行 step 必须是对象",
                    line.line_no
                )));
            }
            current = Some(step);
        } else if let Some(step) = current.as_mut() {
            if let Some(kv) = parse_key_value(&line.text) {
                if kv.key == "with" && kv.value.is_none() {
                    let with_end = nested_block_end(lines, index + 1, range.end, line.indent);
                    step.inputs
                        .extend(parse_step_inputs(lines, (index + 1)..with_end)?);
                    index = with_end;
                    continue;
                }
                apply_step_field(step, kv);
            }
        }
        index += 1;
    }
    if let Some(step) = current.take() {
        drafts.push(step);
    }

    let mut steps = Vec::new();
    for (index, draft) in drafts.into_iter().enumerate() {
        let uses = draft.uses.ok_or_else(|| {
            FlowError::Validation(format!("jobs.{job_id}.steps[{index}].uses 是必填字段"))
        })?;
        steps.push(FlowStepSummary {
            id: draft.id,
            name: draft.name,
            uses,
            inputs: draft.inputs,
        });
    }
    Ok(steps)
}

fn nested_block_end(lines: &[YamlLine], start: usize, end: usize, parent_indent: usize) -> usize {
    lines
        .iter()
        .enumerate()
        .take(end)
        .skip(start)
        .find_map(|(index, line)| (line.indent <= parent_indent).then_some(index))
        .unwrap_or(end)
}

fn parse_step_inputs(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
) -> Result<BTreeMap<String, String>> {
    let Some(base_indent) = child_indent(lines, range.clone()) else {
        return Ok(BTreeMap::new());
    };
    let mut inputs = BTreeMap::new();
    for line in &lines[range] {
        if line.indent != base_indent || line.text.starts_with('-') {
            continue;
        }
        let kv = parse_key_value(&line.text).ok_or_else(|| {
            FlowError::Yaml(format!(
                "第 {} 行 with 输入必须是 key: value 形式",
                line.line_no
            ))
        })?;
        if let Some(value) = kv.value {
            inputs.insert(kv.key, unquote(&value));
        }
    }
    Ok(inputs)
}

fn apply_step_field(step: &mut StepDraft, kv: KeyValue) {
    let Some(value) = kv.value else { return };
    let value = unquote(&value);
    match kv.key.as_str() {
        "id" => step.id = Some(value),
        "name" => step.name = Some(value),
        "uses" => step.uses = Some(value),
        _ => {}
    }
}

fn direct_child_scalar(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
    parent_indent: usize,
    key: &str,
) -> Option<String> {
    let child_indent = lines[range.clone()]
        .iter()
        .filter(|line| line.indent > parent_indent)
        .map(|line| line.indent)
        .min()?;
    lines[range]
        .iter()
        .filter(|line| line.indent == child_indent && !line.text.starts_with('-'))
        .find_map(|line| {
            let kv = parse_key_value(&line.text)?;
            (kv.key == key)
                .then(|| kv.value.map(|value| unquote(&value)))
                .flatten()
        })
}

fn direct_child_range(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
    parent_indent: usize,
    key: &str,
) -> Option<std::ops::Range<usize>> {
    let child_indent = lines[range.clone()]
        .iter()
        .filter(|line| line.indent > parent_indent)
        .map(|line| line.indent)
        .min()?;
    let start = lines[range.clone()]
        .iter()
        .enumerate()
        .find_map(|(offset, line)| {
            if line.indent != child_indent {
                return None;
            }
            let kv = parse_key_value(&line.text)?;
            (kv.key == key).then_some(range.start + offset)
        })?;
    let end = next_sibling_index(lines, start + 1, range.end, child_indent);
    Some((start + 1)..end)
}

fn next_sibling_index(
    lines: &[YamlLine],
    start: usize,
    end: usize,
    sibling_indent: usize,
) -> usize {
    lines
        .iter()
        .enumerate()
        .take(end)
        .skip(start)
        .find_map(|(index, line)| {
            (line.indent == sibling_indent && !line.text.starts_with('-')).then_some(index)
        })
        .unwrap_or(end)
}

fn collect_sequence_values(
    lines: &[YamlLine],
    start: usize,
    end: usize,
    parent_indent: usize,
) -> Vec<String> {
    lines
        .iter()
        .take(end)
        .skip(start)
        .take_while(|line| line.indent > parent_indent)
        .filter_map(|line| line.text.strip_prefix("- "))
        .map(unquote)
        .collect()
}

fn parse_scalar_or_list(value: &str) -> Result<Vec<String>> {
    let value = value.trim();
    if value.starts_with('[') {
        if !value.ends_with(']') {
            return Err(FlowError::Yaml("inline 数组缺少 ]".to_string()));
        }
        let inner = &value[1..value.len() - 1];
        Ok(inner
            .split(',')
            .map(unquote)
            .filter(|item| !item.trim().is_empty())
            .collect())
    } else {
        Ok(vec![unquote(value)])
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match unquote(value).to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

pub fn record_from_value(value: serde_json::Value) -> Result<FlowRecord> {
    serde_json::from_value(value).map_err(|e| FlowError::Record(e.to_string()))
}

pub fn record_to_value(record: &FlowRecord) -> Result<serde_json::Value> {
    serde_json::to_value(record).map_err(|e| FlowError::Record(e.to_string()))
}
