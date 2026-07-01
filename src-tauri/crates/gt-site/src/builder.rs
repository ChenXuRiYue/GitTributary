use std::fs;
use std::path::Path;
use std::time::Instant;

use crate::renderer::{build_page_map, render_index_html, render_markdown_page, render_nav, render_page_html, write_assets};
use crate::types::{AssetContext, Result, SiteBuildConfig, SiteBuildReport, SiteBuildWarning, SiteError};
use crate::utils::{canonical_repo, collect_markdown_files, normalize_output_dir, prepare_output_dir};

pub fn build_site(config: SiteBuildConfig) -> Result<SiteBuildReport> {
    let started = Instant::now();
    let repo = canonical_repo(Path::new(&config.repo_path))?;
    let output_dir = normalize_output_dir(&repo, &config.output_dir)?;
    prepare_output_dir(&output_dir)?;

    let mut ignored = Vec::new();
    let files = collect_markdown_files(&repo, &config.include, &config.exclude, &mut ignored)?;
    if files.is_empty() {
        return Err(SiteError::NoMarkdownFiles);
    }

    let page_map = build_page_map(&files);
    let mut asset_context = AssetContext::default();
    let mut rendered_pages = Vec::new();
    for file in &files {
        match fs::read_to_string(&file.abs_path) {
            Ok(markdown) => {
                let page = render_markdown_page(
                    &repo,
                    &output_dir,
                    file,
                    &markdown,
                    &page_map,
                    config.copy_assets,
                    &mut asset_context,
                )?;
                rendered_pages.push(page);
            }
            Err(err) => asset_context.warnings.push(SiteBuildWarning {
                path: file.rel_path.clone(),
                message: format!("读取 Markdown 失败: {err}"),
            }),
        }
    }

    if rendered_pages.is_empty() {
        return Err(SiteError::NoMarkdownFiles);
    }

    write_assets(
        &output_dir,
        &config.theme,
        config.with_search,
        &rendered_pages,
    )?;

    let nav_html = render_nav(&rendered_pages, None);
    let index_html = output_dir.join("index.html");
    fs::write(
        &index_html,
        render_index_html(&config, &rendered_pages, &nav_html, config.with_search),
    )?;

    for page in &rendered_pages {
        let active_nav = render_nav(&rendered_pages, Some(&page.output_rel));
        let page_path = output_dir.join(&page.output_rel);
        if let Some(parent) = page_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&page_path, render_page_html(&config, page, &active_nav))?;
    }

    fs::write(output_dir.join(".gittributary-site"), "version=1\n")?;

    Ok(SiteBuildReport {
        output_dir: output_dir.to_string_lossy().to_string(),
        index_html: index_html.to_string_lossy().to_string(),
        page_count: rendered_pages.len(),
        asset_count: asset_context.copied.len(),
        broken_links: asset_context.broken_links,
        warnings: asset_context.warnings,
        duration_ms: started.elapsed().as_millis(),
    })
}

