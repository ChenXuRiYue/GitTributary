use std::fs;
use std::path::Path;

use crate::renderer::script::site_js;
use crate::renderer::shared::{relative_url, sanitize_file_name, stable_hash};
use crate::renderer::style::site_css;
use crate::types::{AssetContext, RenderedPage, Result, SearchRecord};
use crate::utils::path_to_slash;

pub(crate) fn copy_asset(
    repo: &Path,
    output_dir: &Path,
    from_output_rel: &str,
    target_rel: &Path,
    assets: &mut AssetContext,
) -> Result<String> {
    let key = path_to_slash(target_rel);
    if let Some(existing) = assets.copied.get(&key) {
        return Ok(relative_url(from_output_rel, existing));
    }
    let filename = target_rel
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("asset");
    let safe_name = sanitize_file_name(filename);
    let output_rel = format!("assets/media/{:x}-{}", stable_hash(&key), safe_name);
    let src = repo.join(target_rel);
    let dst = output_dir.join(&output_rel);
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, &dst)?;
    assets.copied.insert(key, output_rel.clone());
    Ok(relative_url(from_output_rel, &output_rel))
}

pub(crate) fn write_assets(
    output_dir: &Path,
    theme: &str,
    with_search: bool,
    pages: &[RenderedPage],
) -> Result<()> {
    let assets_dir = output_dir.join("assets");
    fs::create_dir_all(&assets_dir)?;
    fs::write(assets_dir.join("app.css"), site_css(theme))?;
    fs::write(assets_dir.join("app.js"), site_js())?;
    if with_search {
        let records = pages
            .iter()
            .map(|page| SearchRecord {
                title: page.title.clone(),
                path: page.output_rel.clone(),
                headings: page
                    .headings
                    .iter()
                    .map(|heading| heading.title.clone())
                    .collect(),
                text: page.plain_text.chars().take(2000).collect(),
            })
            .collect::<Vec<_>>();
        fs::write(
            assets_dir.join("search-index.json"),
            serde_json::to_string_pretty(&records)?,
        )?;
    }
    Ok(())
}

pub(crate) fn site_asset_version(_theme: &str) -> String {
    format!("{:x}", stable_hash(&(site_css("") + site_js())))
}
