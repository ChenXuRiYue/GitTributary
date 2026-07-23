use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::FlowExecutionContext;
use crate::{FlowError, Result};

pub(super) fn render_inputs(
    inputs: &BTreeMap<String, String>,
    context: &FlowExecutionContext,
) -> Result<BTreeMap<String, String>> {
    inputs
        .iter()
        .map(|(key, value)| render_value(value, context).map(|rendered| (key.clone(), rendered)))
        .collect()
}

fn render_value(value: &str, context: &FlowExecutionContext) -> Result<String> {
    let mut rendered = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("${{") {
        rendered.push_str(&rest[..start]);
        let after_start = &rest[start + 3..];
        let Some(end) = after_start.find("}}") else {
            return Err(FlowError::Validation(format!(
                "表达式缺少闭合 }}}}: {value}"
            )));
        };
        let expression = after_start[..end].trim();
        rendered.push_str(&resolve_expression(expression, context)?);
        rest = &after_start[end + 2..];
    }
    rendered.push_str(rest);
    Ok(rendered)
}

fn resolve_expression(expression: &str, context: &FlowExecutionContext) -> Result<String> {
    let value = match expression {
        "gn.now" => Value::String(context.now.clone()),
        "gn.workspace.active_repo" => get_path(&context.workspace, &["active_repo"])
            .cloned()
            .unwrap_or(Value::Null),
        "gn.workspace.active_branch" => get_path(&context.workspace, &["active_branch"])
            .cloned()
            .unwrap_or(Value::Null),
        _ if expression.starts_with("event.") => {
            resolve_path_expression(expression, "event", &context.event)?
        }
        _ if expression.starts_with("inputs.") => {
            resolve_path_expression(expression, "inputs", &context.inputs)?
        }
        _ if expression.starts_with("steps.") => {
            resolve_path_expression(expression, "steps", &context_steps(context))?
        }
        _ => {
            return Err(FlowError::Validation(format!(
                "不支持的表达式: ${{{{ {expression} }}}}"
            )))
        }
    };
    value_to_string(&value).ok_or_else(|| {
        FlowError::Validation(format!("表达式没有可渲染值: ${{{{ {expression} }}}}"))
    })
}

fn resolve_path_expression(expression: &str, root: &str, value: &Value) -> Result<Value> {
    let path = expression
        .strip_prefix(root)
        .and_then(|rest| rest.strip_prefix('.'))
        .ok_or_else(|| FlowError::Validation(format!("表达式路径无效: {expression}")))?;
    let parts = path.split('.').collect::<Vec<_>>();
    get_path(value, &parts)
        .cloned()
        .ok_or_else(|| FlowError::Validation(format!("表达式引用不存在: ${{{{ {expression} }}}}")))
}

fn get_path<'a>(value: &'a Value, parts: &[&str]) -> Option<&'a Value> {
    parts.iter().try_fold(value, |current, part| {
        if part.is_empty() {
            return None;
        }
        match current {
            Value::Object(map) => map.get(*part),
            _ => None,
        }
    })
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(value) => Some(value.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::Array(_) | Value::Object(_) => Some(value.to_string()),
    }
}

fn context_steps(context: &FlowExecutionContext) -> Value {
    context
        .workspace
        .get("__flow")
        .and_then(|value| value.get("steps"))
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()))
}

pub(super) fn insert_step_outputs(
    context: &mut FlowExecutionContext,
    step_id: &str,
    outputs: &Value,
) {
    let workspace = context
        .workspace
        .as_object_mut()
        .expect("workspace is normalized object");
    let flow = workspace
        .entry("__flow")
        .or_insert_with(|| json!({ "steps": {} }));
    if !flow.is_object() {
        *flow = json!({ "steps": {} });
    }
    let flow_object = flow.as_object_mut().expect("flow is object");
    let steps = flow_object
        .entry("steps")
        .or_insert_with(|| Value::Object(Map::new()));
    if !steps.is_object() {
        *steps = Value::Object(Map::new());
    }
    let steps_object = steps.as_object_mut().expect("steps is object");
    steps_object.insert(
        step_id.to_string(),
        json!({
            "outputs": outputs,
        }),
    );
}

pub(super) fn manual_event(flow_id: &str) -> Value {
    json!({
        "id": "evt_manual",
        "type": "workflow_dispatch",
        "source": "noteaura://ui",
        "subject": format!("flow:{flow_id}"),
        "data": {},
    })
}

pub(super) fn normalize_object(value: Value) -> Value {
    if value.is_null() {
        Value::Object(Map::new())
    } else {
        value
    }
}
