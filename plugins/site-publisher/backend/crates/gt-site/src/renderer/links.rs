use std::collections::HashMap;
use std::path::Path;

use crate::renderer::assets::copy_asset;
use crate::renderer::shared::{is_external_url, relative_url, safe_href, split_anchor};
use crate::types::{AssetContext, BrokenLink, MarkdownFile, Result, SiteBuildWarning};
use crate::utils::{is_markdown_path, normalize_join, path_to_slash};

pub(crate) struct MarkdownLink {
    pub(crate) label: String,
    pub(crate) url: String,
    pub(crate) consumed: usize,
}

pub(crate) fn parse_markdown_link(chars: &[char]) -> Option<MarkdownLink> {
    if chars.first().copied()? != '[' {
        return None;
    }
    let close = chars.iter().position(|ch| *ch == ']')?;
    if chars.get(close + 1).copied()? != '(' {
        return None;
    }
    let url_start = close + 2;
    let url_len = chars[url_start..].iter().position(|ch| *ch == ')')?;
    Some(MarkdownLink {
        label: chars[1..close].iter().collect(),
        url: chars[url_start..url_start + url_len].iter().collect(),
        consumed: url_start + url_len + 1,
    })
}

pub(crate) fn resolve_link_url(
    repo: &Path,
    output_dir: &Path,
    file: &MarkdownFile,
    page_map: &HashMap<String, String>,
    url: &str,
    copy_assets: bool,
    assets: &mut AssetContext,
) -> Result<String> {
    let url = url.trim();
    if url.is_empty() || url.starts_with('#') || is_external_url(url) {
        return Ok(safe_href(url, &file.rel_path, assets));
    }
    if url.to_ascii_lowercase().starts_with("javascript:") {
        assets.warnings.push(SiteBuildWarning {
            path: file.rel_path.clone(),
            message: format!("已移除 javascript 链接: {url}"),
        });
        return Ok("#".to_string());
    }
    let (target, anchor) = split_anchor(url);
    if Path::new(target).is_absolute() {
        assets.broken_links.push(BrokenLink {
            source: file.rel_path.clone(),
            target: url.to_string(),
            kind: "absolute_path".to_string(),
        });
        return Ok("#".to_string());
    }
    let base = Path::new(&file.rel_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let target_rel = normalize_join(base, target)?;
    let target_rel_str = path_to_slash(&target_rel);
    if is_markdown_path(&target_rel) {
        if let Some(output_rel) = page_map.get(&target_rel_str) {
            let mut href = relative_url(&file.output_rel, output_rel);
            if let Some(anchor) = anchor {
                href.push('#');
                href.push_str(anchor.trim_start_matches('#'));
            }
            return Ok(href);
        }
        assets.broken_links.push(BrokenLink {
            source: file.rel_path.clone(),
            target: url.to_string(),
            kind: "markdown".to_string(),
        });
        return Ok("#".to_string());
    }
    let abs = repo.join(&target_rel);
    if abs.exists() && abs.is_file() {
        if copy_assets {
            return copy_asset(repo, output_dir, &file.output_rel, &target_rel, assets);
        }
        return Ok(target_rel_str);
    }
    assets.broken_links.push(BrokenLink {
        source: file.rel_path.clone(),
        target: url.to_string(),
        kind: "asset".to_string(),
    });
    Ok("#".to_string())
}

pub(crate) fn resolve_asset_url(
    repo: &Path,
    output_dir: &Path,
    file: &MarkdownFile,
    url: &str,
    copy_assets: bool,
    assets: &mut AssetContext,
) -> Result<String> {
    let url = url.trim();
    if url.is_empty() || is_external_url(url) {
        return Ok(safe_href(url, &file.rel_path, assets));
    }
    let (target, _) = split_anchor(url);
    if Path::new(target).is_absolute() {
        assets.broken_links.push(BrokenLink {
            source: file.rel_path.clone(),
            target: url.to_string(),
            kind: "absolute_path".to_string(),
        });
        return Ok(String::new());
    }
    let base = Path::new(&file.rel_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let target_rel = normalize_join(base, target)?;
    let abs = repo.join(&target_rel);
    if !abs.exists() || !abs.is_file() {
        assets.broken_links.push(BrokenLink {
            source: file.rel_path.clone(),
            target: url.to_string(),
            kind: "asset".to_string(),
        });
        return Ok(String::new());
    }
    if copy_assets {
        copy_asset(repo, output_dir, &file.output_rel, &target_rel, assets)
    } else {
        Ok(path_to_slash(&target_rel))
    }
}
