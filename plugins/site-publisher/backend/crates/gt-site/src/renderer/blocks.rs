use std::collections::HashMap;
use std::path::Path;

use crate::renderer::context::MarkdownRenderContext;
use crate::types::Result;

pub(crate) fn strip_frontmatter(markdown: &str) -> (&str, Option<String>, bool) {
    let mut title = None;
    let mut hidden = false;
    let Some(rest) = markdown.strip_prefix("---\n") else {
        return (markdown, title, hidden);
    };
    let Some(end) = rest.find("\n---") else {
        return (markdown, title, hidden);
    };
    let frontmatter = &rest[..end];
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("title:") {
            title = Some(
                value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            );
        }
        if let Some(value) = trimmed.strip_prefix("hidden:") {
            hidden = matches!(value.trim(), "true" | "yes" | "1");
        }
    }
    let mut body_start = end + "\n---".len();
    if rest[body_start..].starts_with('\n') {
        body_start += 1;
    }
    (
        &rest[body_start..],
        title.filter(|item| !item.is_empty()),
        hidden,
    )
}

pub(crate) fn parse_heading(trimmed: &str) -> Option<(usize, String)> {
    let level = trimmed.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    if !trimmed
        .chars()
        .nth(level)
        .is_some_and(|ch| ch.is_whitespace())
    {
        return None;
    }
    let title = trimmed[level..].trim().trim_matches('#').trim().to_string();
    (!title.is_empty()).then_some((level, title))
}

pub(crate) fn parse_unordered_list_item(trimmed: &str) -> Option<&str> {
    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = trimmed.strip_prefix(marker) {
            return Some(rest);
        }
    }
    None
}

pub(crate) fn parse_ordered_list_item(trimmed: &str) -> Option<&str> {
    let dot = trimmed.find(". ")?;
    if dot == 0 || !trimmed[..dot].chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(&trimmed[dot + 2..])
}

pub(crate) fn is_table_start(lines: &[&str], index: usize) -> bool {
    if index + 1 >= lines.len() {
        return false;
    }
    lines[index].contains('|') && is_table_separator(lines[index + 1].trim())
}

pub(crate) fn is_thematic_break(trimmed: &str) -> bool {
    let markers = trimmed
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<Vec<_>>();
    if markers.len() < 3 {
        return false;
    }
    let marker = markers[0];
    matches!(marker, '-' | '*' | '_') && markers.iter().all(|ch| *ch == marker)
}

fn is_table_separator(line: &str) -> bool {
    let cells = split_table_row(line);
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let stripped = cell.trim().trim_matches(':');
            !stripped.is_empty() && stripped.chars().all(|ch| ch == '-')
        })
}

pub(crate) fn render_table(
    lines: &[&str],
    context: &mut MarkdownRenderContext<'_>,
) -> Result<(String, usize)> {
    let headers = split_table_row(lines[0]);
    let mut html = String::from("<table>\n<thead><tr>");
    for header in headers {
        html.push_str(&format!(
            "<th>{}</th>",
            context.render_inline(header.trim())?
        ));
    }
    html.push_str("</tr></thead>\n<tbody>\n");
    let mut consumed = 2;
    while consumed < lines.len()
        && lines[consumed].contains('|')
        && !lines[consumed].trim().is_empty()
    {
        html.push_str("<tr>");
        for cell in split_table_row(lines[consumed]) {
            html.push_str(&format!("<td>{}</td>", context.render_inline(cell.trim())?));
        }
        html.push_str("</tr>\n");
        consumed += 1;
    }
    html.push_str("</tbody></table>\n");
    Ok((html, consumed))
}

fn split_table_row(line: &str) -> Vec<&str> {
    line.trim().trim_matches('|').split('|').collect()
}

pub(crate) fn unique_slug(title: &str, used: &mut HashMap<String, usize>) -> String {
    let base = slugify(title);
    let count = used.entry(base.clone()).or_default();
    let slug = if *count == 0 {
        base
    } else {
        format!("{base}-{}", *count + 1)
    };
    *count += 1;
    slug
}

fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in title.chars() {
        if ch.is_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "section".to_string()
    } else {
        slug
    }
}

pub(crate) fn normalize_plain_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(path)
        .replace(['_', '-'], " ")
}
