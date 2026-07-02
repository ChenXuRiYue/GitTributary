use std::collections::HashMap;
use std::path::Path;

use crate::renderer::blocks::{
    is_table_start, is_thematic_break, parse_heading, parse_ordered_list_item,
    parse_unordered_list_item, strip_frontmatter, title_from_path,
};
use crate::renderer::context::MarkdownRenderContext;
use crate::renderer::flow::MarkdownRenderState;
use crate::types::{AssetContext, MarkdownFile, RenderedPage, Result};

pub(crate) fn build_page_map(files: &[MarkdownFile]) -> HashMap<String, String> {
    files
        .iter()
        .map(|file| (file.rel_path.clone(), file.output_rel.clone()))
        .collect()
}

pub(crate) fn markdown_frontmatter(markdown: &str) -> (Option<String>, bool) {
    let (_, title, hidden) = strip_frontmatter(markdown);
    (title, hidden)
}

pub(crate) fn render_markdown_page(
    repo: &Path,
    output_dir: &Path,
    file: &MarkdownFile,
    markdown: &str,
    page_map: &HashMap<String, String>,
    copy_assets: bool,
    assets: &mut AssetContext,
) -> Result<RenderedPage> {
    let (body, frontmatter_title, hidden) = strip_frontmatter(markdown);
    debug_assert!(!hidden, "hidden pages should be skipped before rendering");

    let lines = body.lines().collect::<Vec<_>>();
    let mut index = 0;
    let mut context = MarkdownRenderContext {
        repo,
        output_dir,
        file,
        page_map,
        copy_assets,
        assets,
    };
    let mut state = MarkdownRenderState::new();

    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            state.toggle_code_fence(trimmed, &mut context)?;
            index += 1;
            continue;
        }
        if state.is_in_code() {
            state.push_code_line(line);
            index += 1;
            continue;
        }
        if trimmed.is_empty() {
            state.push_break(&mut context)?;
            index += 1;
            continue;
        }
        if is_thematic_break(trimmed) {
            state.push_thematic_break(&mut context)?;
            index += 1;
            continue;
        }
        if is_table_start(&lines, index) {
            let consumed = state.push_table(&lines[index..], &mut context)?;
            index += consumed;
            continue;
        }
        if let Some((level, title)) = parse_heading(trimmed) {
            state.push_heading(level, title, &mut context)?;
            index += 1;
            continue;
        }
        if let Some(item) = parse_unordered_list_item(trimmed) {
            state.push_unordered_item(item, &mut context)?;
            index += 1;
            continue;
        }
        if let Some(item) = parse_ordered_list_item(trimmed) {
            state.push_ordered_item(item, &mut context)?;
            index += 1;
            continue;
        }
        if let Some(quote) = trimmed.strip_prefix('>') {
            state.push_blockquote(quote, &mut context)?;
            index += 1;
            continue;
        }

        state.push_paragraph_line(trimmed);
        index += 1;
    }

    let (html, headings, plain_text) = state.finish(&mut context)?;
    let title = frontmatter_title
        .or_else(|| headings.first().map(|heading| heading.title.clone()))
        .unwrap_or_else(|| title_from_path(&file.rel_path));

    Ok(RenderedPage {
        rel_path: file.rel_path.clone(),
        output_rel: file.output_rel.clone(),
        title,
        html,
        headings,
        plain_text,
    })
}
