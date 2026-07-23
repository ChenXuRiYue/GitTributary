use crate::{FlowError, Result};

#[derive(Debug, Clone)]
pub(super) struct YamlLine {
    pub(super) indent: usize,
    pub(super) text: String,
    pub(super) line_no: usize,
}

#[derive(Debug, Clone)]
pub(super) struct KeyValue {
    pub(super) key: String,
    pub(super) value: Option<String>,
}

pub(super) fn parse_lines(workflow: &str) -> Result<Vec<YamlLine>> {
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

pub(super) fn parse_key_value(text: &str) -> Option<KeyValue> {
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

pub(super) fn top_scalar(lines: &[YamlLine], key: &str) -> Result<String> {
    let line = lines
        .iter()
        .find(|line| {
            line.indent == 0 && parse_key_value(&line.text).is_some_and(|kv| kv.key == key)
        })
        .ok_or_else(|| FlowError::Validation(format!("缺少必填字段 {key}")))?;
    let kv = parse_key_value(&line.text).expect("checked above");
    scalar_value(&kv, key)
}

pub(super) fn section_range(lines: &[YamlLine], key: &str) -> Result<std::ops::Range<usize>> {
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

pub(super) fn section_scalar(
    lines: &[YamlLine],
    range: std::ops::Range<usize>,
    key: &str,
) -> Result<String> {
    section_scalar_optional(lines, range, key)
        .ok_or_else(|| FlowError::Validation(format!("缺少必填字段 {key}")))
}

pub(super) fn section_scalar_optional(
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

pub(super) fn child_indent(lines: &[YamlLine], range: std::ops::Range<usize>) -> Option<usize> {
    lines[range].iter().map(|line| line.indent).min()
}

pub(super) fn nested_block_end(
    lines: &[YamlLine],
    start: usize,
    end: usize,
    parent_indent: usize,
) -> usize {
    lines
        .iter()
        .enumerate()
        .take(end)
        .skip(start)
        .find_map(|(index, line)| (line.indent <= parent_indent).then_some(index))
        .unwrap_or(end)
}

pub(super) fn direct_child_scalar(
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

pub(super) fn direct_child_range(
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

pub(super) fn next_sibling_index(
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

pub(super) fn collect_sequence_values(
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

pub(super) fn parse_scalar_or_list(value: &str) -> Result<Vec<String>> {
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

pub(super) fn parse_bool(value: &str) -> Option<bool> {
    match unquote(value).to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

pub(super) fn unquote(value: &str) -> String {
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
