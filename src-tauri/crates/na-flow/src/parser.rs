mod syntax;

use std::collections::BTreeMap;

use syntax::{
    child_indent, collect_sequence_values, direct_child_range, direct_child_scalar,
    nested_block_end, next_sibling_index, parse_bool, parse_key_value, parse_lines,
    parse_scalar_or_list, section_range, section_scalar, section_scalar_optional, top_scalar,
    unquote, KeyValue, YamlLine,
};

use crate::{FlowError, FlowJobSummary, FlowStepSummary, FlowSummary, FlowTriggerSummary, Result};

#[derive(Debug, Clone)]
struct StepDraft {
    id: Option<String>,
    name: Option<String>,
    uses: Option<String>,
    inputs: BTreeMap<String, String>,
}

pub fn parse_workflow(workflow: &str) -> Result<FlowSummary> {
    let lines = parse_lines(workflow)?;
    if lines.is_empty() {
        return Err(FlowError::Validation("Flow YAML 不能为空".to_string()));
    }

    let name = top_scalar(&lines, "name")?;
    let na_range = section_range(&lines, "gn")?;
    let id = section_scalar(&lines, na_range.clone(), "id")?;
    let enabled = parse_bool(&section_scalar(&lines, na_range.clone(), "enabled")?)
        .ok_or_else(|| FlowError::Validation("enabled 必须是布尔值".to_string()))?;
    let description = section_scalar_optional(&lines, na_range, "description");

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
