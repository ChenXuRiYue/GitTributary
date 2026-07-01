use std::collections::HashMap;
use std::path::Path;

use crate::renderer::emphasis::scan_emphasis;
use crate::renderer::links::{parse_markdown_link, resolve_asset_url, resolve_link_url};
use crate::renderer::shared::{escape_attr, escape_html};
use crate::types::{AssetContext, MarkdownFile, Result};

pub(crate) fn render_inline(
    text: &str,
    repo: &Path,
    output_dir: &Path,
    file: &MarkdownFile,
    page_map: &HashMap<String, String>,
    copy_assets: bool,
    assets: &mut AssetContext,
) -> Result<String> {
    let mut out = String::new();
    let chars = text.chars().collect::<Vec<_>>();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            if let Some(link) = parse_markdown_link(&chars[i + 1..]) {
                let src = resolve_asset_url(repo, output_dir, file, &link.url, copy_assets, assets)?;
                out.push_str(&format!(
                    "<img src=\"{}\" alt=\"{}\">",
                    escape_attr(&src),
                    escape_attr(&link.label)
                ));
                i += link.consumed + 1;
                continue;
            }
        }
        if chars[i] == '[' {
            if let Some(link) = parse_markdown_link(&chars[i..]) {
                let href = resolve_link_url(
                    repo,
                    output_dir,
                    file,
                    page_map,
                    &link.url,
                    copy_assets,
                    assets,
                )?;
                out.push_str(&format!(
                    "<a href=\"{}\">{}</a>",
                    escape_attr(&href),
                    render_inline_text_only(&link.label)
                ));
                i += link.consumed;
                continue;
            }
        }
        if chars[i] == '`' {
            if let Some(end) = chars[i + 1..].iter().position(|ch| *ch == '`') {
                let code = chars[i + 1..i + 1 + end].iter().collect::<String>();
                out.push_str(&format!("<code>{}</code>", escape_html(&code)));
                i += end + 2;
                continue;
            }
        }
        if let Some(span) = scan_emphasis(&chars, i) {
            let (open_tag, close_tag) = span.kind.tags();
            out.push_str(open_tag);
            out.push_str(&render_inline(
                &span.inner,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?);
            out.push_str(close_tag);
            i = span.next_index;
            continue;
        }
        out.push_str(&escape_html(&chars[i].to_string()));
        i += 1;
    }
    Ok(out)
}

fn render_inline_text_only(text: &str) -> String {
    escape_html(text)
}
