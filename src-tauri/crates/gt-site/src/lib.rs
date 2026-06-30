use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

#[derive(Debug, thiserror::Error)]
pub enum SiteError {
    #[error("仓库路径不存在: {0}")]
    RepoMissing(String),
    #[error("仓库路径不是目录: {0}")]
    RepoNotDir(String),
    #[error("路径越过仓库根目录: {0}")]
    PathOutsideRepo(String),
    #[error("输出目录非空且不是 Git Tributary 站点构建目录: {0}")]
    UnsafeOutputDir(String),
    #[error("没有找到可构建的 Markdown 文件")]
    NoMarkdownFiles,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, SiteError>;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteScanReport {
    pub repo_path: String,
    pub repo_name: String,
    pub candidates: Vec<SitePathCandidate>,
    pub ignored: Vec<SiteIgnoredPath>,
    pub markdown_count: usize,
    pub asset_count: usize,
    pub default_output_dir: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitePathCandidate {
    pub path: String,
    pub kind: SitePathKind,
    pub score: u32,
    pub reason: Vec<String>,
    pub markdown_count: usize,
    pub selected_by_default: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteIgnoredPath {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SitePathKind {
    File,
    Dir,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBuildConfig {
    pub repo_path: String,
    pub output_dir: String,
    pub site_title: String,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub with_search: bool,
    #[serde(default = "default_true")]
    pub copy_assets: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBuildReport {
    pub output_dir: String,
    pub index_html: String,
    pub page_count: usize,
    pub asset_count: usize,
    pub broken_links: Vec<BrokenLink>,
    pub warnings: Vec<SiteBuildWarning>,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenLink {
    pub source: String,
    pub target: String,
    pub kind: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBuildWarning {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone)]
struct MarkdownFile {
    rel_path: String,
    abs_path: PathBuf,
    output_rel: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchRecord {
    title: String,
    path: String,
    headings: Vec<String>,
    text: String,
}

#[derive(Debug, Clone)]
struct RenderedPage {
    rel_path: String,
    output_rel: String,
    title: String,
    html: String,
    headings: Vec<Heading>,
    plain_text: String,
}

#[derive(Debug, Clone)]
struct Heading {
    level: usize,
    title: String,
    slug: String,
}

#[derive(Debug, Default)]
struct NavTreeNode {
    name: String,
    path: String,
    children: BTreeMap<String, NavTreeNode>,
    pages: Vec<usize>,
}

#[derive(Default)]
struct AssetContext {
    copied: HashMap<String, String>,
    broken_links: Vec<BrokenLink>,
    warnings: Vec<SiteBuildWarning>,
}

fn default_theme() -> String {
    "typora-light".to_string()
}

fn default_true() -> bool {
    true
}

pub fn scan_repo(repo_path: impl AsRef<Path>) -> Result<SiteScanReport> {
    let repo = canonical_repo(repo_path.as_ref())?;
    let repo_name = repo
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("site")
        .to_string();
    let mut ignored = Vec::new();
    let mut markdown_files = Vec::new();
    let mut asset_count = 0;
    walk_files(&repo, &repo, &mut ignored, &mut |path| {
        if is_markdown(path) {
            markdown_files.push(path.to_path_buf());
        } else if is_asset(path) {
            asset_count += 1;
        }
    })?;

    let mut dir_counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut special_files: BTreeSet<String> = BTreeSet::new();
    for file in &markdown_files {
        let rel = relative_path(&repo, file)?;
        let rel_str = path_to_slash(&rel);
        let name = file_name_lower(&rel);
        if name == "readme.md" || name.starts_with("readme.") && name.ends_with(".md") {
            special_files.insert(rel_str.clone());
        }
        if name == "index.md" || name == "summary.md" || name == "sidebar.md" {
            if let Some(parent) = rel.parent() {
                special_files.insert(path_to_slash(parent));
            }
        }
        for ancestor in rel.ancestors().skip(1) {
            if ancestor.as_os_str().is_empty() {
                continue;
            }
            *dir_counts.entry(path_to_slash(ancestor)).or_default() += 1;
        }
    }

    let mut candidates: BTreeMap<String, SitePathCandidate> = BTreeMap::new();
    for file in special_files {
        let abs = repo.join(&file);
        if abs.is_file() {
            upsert_candidate(
                &mut candidates,
                file,
                SitePathKind::File,
                100,
                "README 或入口 Markdown".to_string(),
                1,
            );
        } else if abs.is_dir() {
            let count = *dir_counts.get(&file).unwrap_or(&0);
            upsert_candidate(
                &mut candidates,
                file,
                SitePathKind::Dir,
                82,
                "包含 index/SUMMARY/sidebar".to_string(),
                count,
            );
        }
    }

    for (dir, count) in dir_counts {
        let lower = dir.to_ascii_lowercase();
        if is_high_priority_doc_dir(&lower) {
            upsert_candidate(
                &mut candidates,
                dir,
                SitePathKind::Dir,
                95,
                "常见文档目录".to_string(),
                count,
            );
        } else if count >= 3 {
            upsert_candidate(
                &mut candidates,
                dir,
                SitePathKind::Dir,
                70,
                "目录内 Markdown 数量较多".to_string(),
                count,
            );
        } else if contains_doc_keyword(&lower) {
            upsert_candidate(
                &mut candidates,
                dir,
                SitePathKind::Dir,
                62,
                "目录名匹配文档关键词".to_string(),
                count,
            );
        }
    }

    let mut candidates = candidates.into_values().collect::<Vec<_>>();
    candidates.sort_by(compare_site_candidates);
    for candidate in &mut candidates {
        candidate.selected_by_default = candidate.score >= 70;
    }

    Ok(SiteScanReport {
        repo_path: repo.to_string_lossy().to_string(),
        repo_name,
        candidates,
        ignored,
        markdown_count: markdown_files.len(),
        asset_count,
        default_output_dir: repo
            .join(".gittributary")
            .join("site")
            .to_string_lossy()
            .to_string(),
    })
}

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

fn canonical_repo(path: &Path) -> Result<PathBuf> {
    if !path.exists() {
        return Err(SiteError::RepoMissing(path.to_string_lossy().to_string()));
    }
    let path = path.canonicalize()?;
    if !path.is_dir() {
        return Err(SiteError::RepoNotDir(path.to_string_lossy().to_string()));
    }
    Ok(path)
}

fn normalize_output_dir(repo: &Path, output_dir: &str) -> Result<PathBuf> {
    let raw = PathBuf::from(output_dir.trim());
    let output = if raw.is_absolute() {
        raw
    } else {
        repo.join(raw)
    };
    if let Ok(canonical) = output.canonicalize() {
        Ok(canonical)
    } else {
        Ok(output)
    }
}

fn prepare_output_dir(output_dir: &Path) -> Result<()> {
    if output_dir.exists() {
        if !output_dir.is_dir() {
            return Err(SiteError::UnsafeOutputDir(
                output_dir.to_string_lossy().to_string(),
            ));
        }
        let marker = output_dir.join(".gittributary-site");
        let is_empty = fs::read_dir(output_dir)?.next().is_none();
        if !marker.exists() && !is_empty {
            return Err(SiteError::UnsafeOutputDir(
                output_dir.to_string_lossy().to_string(),
            ));
        }
        clear_dir_contents(output_dir)?;
    }
    fs::create_dir_all(output_dir)?;
    Ok(())
}

fn clear_dir_contents(dir: &Path) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn walk_files(
    repo: &Path,
    dir: &Path,
    ignored: &mut Vec<SiteIgnoredPath>,
    on_file: &mut impl FnMut(&Path),
) -> Result<()> {
    let mut entries = fs::read_dir(dir)?.collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let path = entry.path();
        let rel = relative_path(repo, &path)?;
        if should_ignore(&rel, path.is_dir()) {
            ignored.push(SiteIgnoredPath {
                path: path_to_slash(&rel),
                reason: "默认忽略规则".to_string(),
            });
            continue;
        }
        if path.is_dir() {
            walk_files(repo, &path, ignored, on_file)?;
        } else if path.is_file() {
            on_file(&path);
        }
    }
    Ok(())
}

fn collect_markdown_files(
    repo: &Path,
    include: &[String],
    exclude: &[String],
    ignored: &mut Vec<SiteIgnoredPath>,
) -> Result<Vec<MarkdownFile>> {
    let include = if include.is_empty() {
        vec![
            "README.md".to_string(),
            "doc".to_string(),
            "docs".to_string(),
        ]
    } else {
        include.to_vec()
    };
    let exclude = exclude
        .iter()
        .filter_map(|item| normalize_user_rel_path(item).ok())
        .collect::<Vec<_>>();
    let mut seen = BTreeSet::new();
    let mut files = Vec::new();

    for item in include {
        let rel = normalize_user_rel_path(&item)?;
        let abs = repo.join(&rel);
        ensure_inside_repo(repo, &abs)?;
        if !abs.exists() {
            continue;
        }
        if abs.is_file() {
            if is_markdown(&abs) && !is_excluded(&rel, &exclude) {
                push_markdown_file(repo, &abs, &mut seen, &mut files)?;
            }
            continue;
        }
        collect_markdown_files_in_dir(repo, &abs, &exclude, ignored, &mut seen, &mut files)?;
    }

    files.sort_by(|a, b| natural_doc_key(&a.rel_path).cmp(&natural_doc_key(&b.rel_path)));
    Ok(files)
}

fn collect_markdown_files_in_dir(
    repo: &Path,
    dir: &Path,
    exclude: &[PathBuf],
    ignored: &mut Vec<SiteIgnoredPath>,
    seen: &mut BTreeSet<String>,
    files: &mut Vec<MarkdownFile>,
) -> Result<()> {
    let mut entries = fs::read_dir(dir)?.collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| natural_doc_key(&path_to_slash(&entry.path())));
    for entry in entries {
        let path = entry.path();
        let rel = relative_path(repo, &path)?;
        if should_ignore(&rel, path.is_dir()) || is_excluded(&rel, exclude) {
            ignored.push(SiteIgnoredPath {
                path: path_to_slash(&rel),
                reason: "构建排除规则".to_string(),
            });
            continue;
        }
        if path.is_dir() {
            collect_markdown_files_in_dir(repo, &path, exclude, ignored, seen, files)?;
        } else if path.is_file() && is_markdown(&path) {
            push_markdown_file(repo, &path, seen, files)?;
        }
    }
    Ok(())
}

fn push_markdown_file(
    repo: &Path,
    abs: &Path,
    seen: &mut BTreeSet<String>,
    files: &mut Vec<MarkdownFile>,
) -> Result<()> {
    let rel = relative_path(repo, abs)?;
    let rel_path = path_to_slash(&rel);
    if !seen.insert(rel_path.clone()) {
        return Ok(());
    }
    files.push(MarkdownFile {
        output_rel: markdown_output_rel(&rel),
        rel_path,
        abs_path: abs.to_path_buf(),
    });
    Ok(())
}

fn build_page_map(files: &[MarkdownFile]) -> HashMap<String, String> {
    files
        .iter()
        .map(|file| (file.rel_path.clone(), file.output_rel.clone()))
        .collect()
}

fn render_markdown_page(
    repo: &Path,
    output_dir: &Path,
    file: &MarkdownFile,
    markdown: &str,
    page_map: &HashMap<String, String>,
    copy_assets: bool,
    assets: &mut AssetContext,
) -> Result<RenderedPage> {
    let (body, frontmatter_title, hidden) = strip_frontmatter(markdown);
    if hidden {
        return Ok(RenderedPage {
            rel_path: file.rel_path.clone(),
            output_rel: file.output_rel.clone(),
            title: frontmatter_title.unwrap_or_else(|| title_from_path(&file.rel_path)),
            html: "<p>该文档已在 frontmatter 中标记为 hidden。</p>".to_string(),
            headings: Vec::new(),
            plain_text: String::new(),
        });
    }
    let mut headings = Vec::new();
    let mut used_slugs: HashMap<String, usize> = HashMap::new();
    let mut html = String::new();
    let mut plain_text = String::new();
    let lines = body.lines().collect::<Vec<_>>();
    let mut index = 0;
    let mut in_code = false;
    let mut paragraph = Vec::new();
    let mut list_open = false;
    let mut ordered_list_open = false;
    let mut blockquote_open = false;

    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_lists(&mut html, &mut list_open, &mut ordered_list_open);
            close_blockquote(&mut html, &mut blockquote_open);
            if in_code {
                html.push_str("</code></pre>\n");
                in_code = false;
            } else {
                let lang = trimmed.trim_start_matches("```").trim();
                html.push_str(&format!(
                    "<pre><code{}>",
                    if lang.is_empty() {
                        String::new()
                    } else {
                        format!(" class=\"language-{}\"", escape_attr(lang))
                    }
                ));
                in_code = true;
            }
            index += 1;
            continue;
        }
        if in_code {
            html.push_str(&escape_html(line));
            html.push('\n');
            plain_text.push_str(line);
            plain_text.push('\n');
            index += 1;
            continue;
        }
        if trimmed.is_empty() {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_lists(&mut html, &mut list_open, &mut ordered_list_open);
            close_blockquote(&mut html, &mut blockquote_open);
            index += 1;
            continue;
        }
        if is_thematic_break(trimmed) {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_lists(&mut html, &mut list_open, &mut ordered_list_open);
            close_blockquote(&mut html, &mut blockquote_open);
            html.push_str("<hr>\n");
            index += 1;
            continue;
        }
        if is_table_start(&lines, index) {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_lists(&mut html, &mut list_open, &mut ordered_list_open);
            close_blockquote(&mut html, &mut blockquote_open);
            let (table_html, consumed) = render_table(
                &lines[index..],
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            html.push_str(&table_html);
            index += consumed;
            continue;
        }
        if let Some((level, title)) = parse_heading(trimmed) {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_lists(&mut html, &mut list_open, &mut ordered_list_open);
            close_blockquote(&mut html, &mut blockquote_open);
            let slug = unique_slug(&title, &mut used_slugs);
            headings.push(Heading {
                level,
                title: title.clone(),
                slug: slug.clone(),
            });
            plain_text.push_str(&title);
            plain_text.push('\n');
            html.push_str(&format!(
                "<h{level} id=\"{}\">{}</h{level}>\n",
                escape_attr(&slug),
                render_inline(
                    &title,
                    repo,
                    output_dir,
                    file,
                    page_map,
                    copy_assets,
                    assets
                )?
            ));
            index += 1;
            continue;
        }
        if let Some(item) = parse_unordered_list_item(trimmed) {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_blockquote(&mut html, &mut blockquote_open);
            if ordered_list_open {
                html.push_str("</ol>\n");
                ordered_list_open = false;
            }
            if !list_open {
                html.push_str("<ul>\n");
                list_open = true;
            }
            plain_text.push_str(item);
            plain_text.push('\n');
            html.push_str(&format!(
                "<li>{}</li>\n",
                render_inline(item, repo, output_dir, file, page_map, copy_assets, assets)?
            ));
            index += 1;
            continue;
        }
        if let Some(item) = parse_ordered_list_item(trimmed) {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_blockquote(&mut html, &mut blockquote_open);
            if list_open {
                html.push_str("</ul>\n");
                list_open = false;
            }
            if !ordered_list_open {
                html.push_str("<ol>\n");
                ordered_list_open = true;
            }
            plain_text.push_str(item);
            plain_text.push('\n');
            html.push_str(&format!(
                "<li>{}</li>\n",
                render_inline(item, repo, output_dir, file, page_map, copy_assets, assets)?
            ));
            index += 1;
            continue;
        }
        if let Some(quote) = trimmed.strip_prefix('>') {
            flush_paragraph(
                &mut html,
                &mut paragraph,
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets,
            )?;
            close_lists(&mut html, &mut list_open, &mut ordered_list_open);
            if !blockquote_open {
                html.push_str("<blockquote>\n");
                blockquote_open = true;
            }
            let quote = quote.trim();
            plain_text.push_str(quote);
            plain_text.push('\n');
            html.push_str(&format!(
                "<p>{}</p>\n",
                render_inline(quote, repo, output_dir, file, page_map, copy_assets, assets)?
            ));
            index += 1;
            continue;
        }
        close_lists(&mut html, &mut list_open, &mut ordered_list_open);
        close_blockquote(&mut html, &mut blockquote_open);
        plain_text.push_str(trimmed);
        plain_text.push('\n');
        paragraph.push(trimmed.to_string());
        index += 1;
    }
    if in_code {
        html.push_str("</code></pre>\n");
    }
    flush_paragraph(
        &mut html,
        &mut paragraph,
        repo,
        output_dir,
        file,
        page_map,
        copy_assets,
        assets,
    )?;
    close_lists(&mut html, &mut list_open, &mut ordered_list_open);
    close_blockquote(&mut html, &mut blockquote_open);

    let title = frontmatter_title
        .or_else(|| headings.first().map(|heading| heading.title.clone()))
        .unwrap_or_else(|| title_from_path(&file.rel_path));

    Ok(RenderedPage {
        rel_path: file.rel_path.clone(),
        output_rel: file.output_rel.clone(),
        title,
        html,
        headings,
        plain_text: normalize_plain_text(&plain_text),
    })
}

fn flush_paragraph(
    html: &mut String,
    paragraph: &mut Vec<String>,
    repo: &Path,
    output_dir: &Path,
    file: &MarkdownFile,
    page_map: &HashMap<String, String>,
    copy_assets: bool,
    assets: &mut AssetContext,
) -> Result<()> {
    if paragraph.is_empty() {
        return Ok(());
    }
    let text = paragraph.join(" ");
    html.push_str(&format!(
        "<p>{}</p>\n",
        render_inline(&text, repo, output_dir, file, page_map, copy_assets, assets)?
    ));
    paragraph.clear();
    Ok(())
}

fn close_lists(html: &mut String, list_open: &mut bool, ordered_list_open: &mut bool) {
    if *list_open {
        html.push_str("</ul>\n");
        *list_open = false;
    }
    if *ordered_list_open {
        html.push_str("</ol>\n");
        *ordered_list_open = false;
    }
}

fn close_blockquote(html: &mut String, blockquote_open: &mut bool) {
    if *blockquote_open {
        html.push_str("</blockquote>\n");
        *blockquote_open = false;
    }
}

fn render_inline(
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
            if let Some((alt, url, consumed)) = parse_markdown_link(&chars[i + 1..]) {
                let src = resolve_asset_url(repo, output_dir, file, &url, copy_assets, assets)?;
                out.push_str(&format!(
                    "<img src=\"{}\" alt=\"{}\">",
                    escape_attr(&src),
                    escape_attr(&alt)
                ));
                i += consumed + 1;
                continue;
            }
        }
        if chars[i] == '[' {
            if let Some((label, url, consumed)) = parse_markdown_link(&chars[i..]) {
                let href =
                    resolve_link_url(repo, output_dir, file, page_map, &url, copy_assets, assets)?;
                out.push_str(&format!(
                    "<a href=\"{}\">{}</a>",
                    escape_attr(&href),
                    render_inline_text_only(&label)
                ));
                i += consumed;
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
        if starts_with_marker(&chars, i, "**") {
            if let Some(end) = find_inline_marker(&chars, i + 2, "**") {
                if end > i + 2 {
                    let inner = chars[i + 2..end].iter().collect::<String>();
                    out.push_str("<strong>");
                    out.push_str(&render_inline(
                        &inner,
                        repo,
                        output_dir,
                        file,
                        page_map,
                        copy_assets,
                        assets,
                    )?);
                    out.push_str("</strong>");
                    i = end + 2;
                    continue;
                }
            }
        }
        if starts_with_marker(&chars, i, "__") {
            if let Some(end) = find_inline_marker(&chars, i + 2, "__") {
                if end > i + 2 {
                    let inner = chars[i + 2..end].iter().collect::<String>();
                    out.push_str("<strong>");
                    out.push_str(&render_inline(
                        &inner,
                        repo,
                        output_dir,
                        file,
                        page_map,
                        copy_assets,
                        assets,
                    )?);
                    out.push_str("</strong>");
                    i = end + 2;
                    continue;
                }
            }
        }
        if starts_with_marker(&chars, i, "~~") {
            if let Some(end) = find_inline_marker(&chars, i + 2, "~~") {
                if end > i + 2 {
                    let inner = chars[i + 2..end].iter().collect::<String>();
                    out.push_str("<del>");
                    out.push_str(&render_inline(
                        &inner,
                        repo,
                        output_dir,
                        file,
                        page_map,
                        copy_assets,
                        assets,
                    )?);
                    out.push_str("</del>");
                    i = end + 2;
                    continue;
                }
            }
        }
        if chars[i] == '*' {
            if let Some(end) = find_inline_char(&chars, i + 1, '*') {
                if end > i + 1 && !starts_with_marker(&chars, end, "**") {
                    let inner = chars[i + 1..end].iter().collect::<String>();
                    out.push_str("<em>");
                    out.push_str(&render_inline(
                        &inner,
                        repo,
                        output_dir,
                        file,
                        page_map,
                        copy_assets,
                        assets,
                    )?);
                    out.push_str("</em>");
                    i = end + 1;
                    continue;
                }
            }
        }
        if chars[i] == '_' && !is_word_char(chars.get(i.wrapping_sub(1)).copied()) {
            if let Some(end) = find_inline_char(&chars, i + 1, '_') {
                if end > i + 1 && !is_word_char(chars.get(end + 1).copied()) {
                    let inner = chars[i + 1..end].iter().collect::<String>();
                    out.push_str("<em>");
                    out.push_str(&render_inline(
                        &inner,
                        repo,
                        output_dir,
                        file,
                        page_map,
                        copy_assets,
                        assets,
                    )?);
                    out.push_str("</em>");
                    i = end + 1;
                    continue;
                }
            }
        }
        out.push_str(&escape_html(&chars[i].to_string()));
        i += 1;
    }
    Ok(apply_basic_emphasis(&out))
}

fn render_inline_text_only(text: &str) -> String {
    escape_html(text)
}

fn parse_markdown_link(chars: &[char]) -> Option<(String, String, usize)> {
    if chars.first().copied()? != '[' {
        return None;
    }
    let close = chars.iter().position(|ch| *ch == ']')?;
    if chars.get(close + 1).copied()? != '(' {
        return None;
    }
    let url_start = close + 2;
    let url_len = chars[url_start..].iter().position(|ch| *ch == ')')?;
    let label = chars[1..close].iter().collect::<String>();
    let url = chars[url_start..url_start + url_len]
        .iter()
        .collect::<String>();
    Some((label, url, url_start + url_len + 1))
}

fn resolve_link_url(
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

fn resolve_asset_url(
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

fn copy_asset(
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

fn write_assets(
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

fn render_index_html(
    config: &SiteBuildConfig,
    pages: &[RenderedPage],
    nav_html: &str,
    with_search: bool,
) -> String {
    let title = if config.site_title.trim().is_empty() {
        "Git Tributary Site"
    } else {
        config.site_title.trim()
    };
    let first_page = pages
        .first()
        .map(|page| page.output_rel.as_str())
        .unwrap_or("#");
    let search = if with_search {
        r#"<div class="site-search"><input id="siteSearch" placeholder="搜索文档"><div id="searchResults" class="search-results"></div></div>"#
    } else {
        ""
    };
    let asset_version = site_asset_version(&config.theme);
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{}</title>
  {}
  <link rel="stylesheet" href="assets/app.css?v={}">
</head>
<body>
  <div class="site-shell" data-site-root="">
    {}
    <aside class="site-sidebar" id="siteSidebar">
      <div class="site-sidebar-scroll">
        <div class="site-brand">{}</div>
        {}
        {}
      </div>
      <div class="sidebar-resizer" role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical" tabindex="0"></div>
    </aside>
    <main class="site-index">
      <p class="eyebrow">Git Tributary Static Site</p>
      <h1>{}</h1>
      <p class="lead">已构建 {} 篇文档。选择左侧文档开始阅读。</p>
      <p><a class="primary-link" href="{}">打开第一篇文档</a></p>
    </main>
  </div>
  <script src="assets/app.js?v={}"></script>
</body>
</html>"#,
        escape_html(title),
        render_theme_bootstrap(),
        asset_version,
        render_site_controls(),
        escape_html(title),
        search,
        nav_html,
        escape_html(title),
        pages.len(),
        escape_attr(first_page),
        asset_version
    )
}

fn render_page_html(config: &SiteBuildConfig, page: &RenderedPage, nav_html: &str) -> String {
    let title = if config.site_title.trim().is_empty() {
        "Git Tributary Site"
    } else {
        config.site_title.trim()
    };
    let asset_version = site_asset_version(&config.theme);
    let css_href = format!(
        "{}?v={}",
        relative_url(&page.output_rel, "assets/app.css"),
        asset_version
    );
    let js_href = format!(
        "{}?v={}",
        relative_url(&page.output_rel, "assets/app.js"),
        asset_version
    );
    let site_root = relative_url(&page.output_rel, "");
    let index_href = relative_url(&page.output_rel, "index.html");
    let search = if config.with_search {
        r#"<div class="site-search"><input id="siteSearch" placeholder="搜索文档"><div id="searchResults" class="search-results"></div></div>"#
    } else {
        ""
    };
    let toc = render_toc(page);
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{} · {}</title>
  {}
  <link rel="stylesheet" href="{}">
</head>
<body>
  <div class="site-shell" data-site-root="{}">
    {}
    <aside class="site-sidebar" id="siteSidebar">
      <div class="site-sidebar-scroll">
        <a class="site-brand" href="{}">{}</a>
        {}
        {}
      </div>
      <div class="sidebar-resizer" role="separator" aria-label="调整侧边栏宽度" aria-orientation="vertical" tabindex="0"></div>
    </aside>
    <main class="site-content">
      <article class="markdown-body">
        {}
      </article>
    </main>
    <aside class="site-toc">
      {}
    </aside>
  </div>
  <script src="{}"></script>
</body>
</html>"#,
        escape_html(&page.title),
        escape_html(title),
        render_theme_bootstrap(),
        escape_attr(&css_href),
        escape_attr(&site_root),
        render_site_controls(),
        escape_attr(&index_href),
        escape_html(title),
        search,
        nav_html,
        page.html,
        toc,
        escape_attr(&js_href)
    )
}

fn render_nav(pages: &[RenderedPage], active: Option<&str>) -> String {
    let tree = build_nav_tree(pages);
    let from_file = active.unwrap_or("index.html");
    let mut html = String::from("<nav class=\"site-nav\" aria-label=\"文档文件树\">\n");
    render_nav_children(&tree, pages, active, from_file, &mut html);
    html.push_str("</nav>\n");
    html
}

fn build_nav_tree(pages: &[RenderedPage]) -> NavTreeNode {
    let mut root = NavTreeNode::default();
    for (index, page) in pages.iter().enumerate() {
        let parts = page
            .rel_path
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        let mut cursor = &mut root;
        let mut dir_parts = Vec::new();
        for dir in parts.iter().take(parts.len().saturating_sub(1)) {
            dir_parts.push(*dir);
            let dir_path = dir_parts.join("/");
            cursor = cursor
                .children
                .entry((*dir).to_string())
                .or_insert_with(|| NavTreeNode {
                    name: (*dir).to_string(),
                    path: dir_path,
                    children: BTreeMap::new(),
                    pages: Vec::new(),
                });
        }
        cursor.pages.push(index);
    }
    root
}

fn render_nav_children(
    node: &NavTreeNode,
    pages: &[RenderedPage],
    active: Option<&str>,
    from_file: &str,
    html: &mut String,
) {
    let mut dirs = node.children.values().collect::<Vec<_>>();
    dirs.sort_by(|a, b| natural_component_key(&a.name).cmp(&natural_component_key(&b.name)));
    for dir in dirs {
        let contains_active = nav_node_contains_active(dir, pages, active);
        let open_attr = if (active.is_none() && node.path.is_empty()) || contains_active {
            " open"
        } else {
            ""
        };
        let active_class = if contains_active {
            " active-branch"
        } else {
            ""
        };
        html.push_str(&format!(
            "<details class=\"nav-dir{}\"{}><summary title=\"{}\"><span class=\"nav-folder-icon\" aria-hidden=\"true\" data-icon-set=\"lucide\"><span class=\"folder-closed\">{}</span><span class=\"folder-open\">{}</span></span><span class=\"nav-label\">{}</span></summary><div class=\"nav-children\">\n",
            active_class,
            open_attr,
            escape_attr(&dir.path),
            lucide_svg(LucideIcon::Folder),
            lucide_svg(LucideIcon::FolderOpen),
            escape_html(&dir.name),
        ));
        render_nav_children(dir, pages, active, from_file, html);
        html.push_str("</div></details>\n");
    }

    let mut page_indices = node.pages.clone();
    page_indices.sort_by(|a, b| {
        let a_page = &pages[*a];
        let b_page = &pages[*b];
        natural_component_key(&nav_file_name(&a_page.rel_path))
            .cmp(&natural_component_key(&nav_file_name(&b_page.rel_path)))
            .then_with(|| a_page.rel_path.cmp(&b_page.rel_path))
    });
    for index in page_indices {
        let page = &pages[index];
        let icon = nav_file_icon(&page.rel_path);
        let active_class = if Some(page.output_rel.as_str()) == active {
            " active"
        } else {
            ""
        };
        html.push_str(&format!(
            "<a class=\"nav-file{}\" href=\"{}\" title=\"{}\"><span class=\"nav-file-icon nav-file-icon--{}\" title=\"{}\" aria-hidden=\"true\" data-icon-set=\"lucide\">{}</span><span class=\"nav-label\">{}</span></a>\n",
            active_class,
            escape_attr(&relative_url(from_file, &page.output_rel)),
            escape_attr(&page.rel_path),
            icon.class_suffix,
            icon.title,
            lucide_svg(icon.icon),
            escape_html(&nav_file_name(&page.rel_path)),
        ));
    }
}

fn nav_node_contains_active(
    node: &NavTreeNode,
    pages: &[RenderedPage],
    active: Option<&str>,
) -> bool {
    let Some(active) = active else {
        return false;
    };
    node.pages
        .iter()
        .any(|index| pages[*index].output_rel == active)
        || node
            .children
            .values()
            .any(|child| nav_node_contains_active(child, pages, Some(active)))
}

fn nav_file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

#[derive(Debug, Clone, Copy)]
enum LucideIcon {
    Archive,
    ChevronLeft,
    File,
    FileCode,
    FileImage,
    FileJson,
    FileText,
    FileType,
    Folder,
    FolderOpen,
    Moon,
    Music,
    Sheet,
    Sun,
    Video,
}

#[derive(Debug, Clone, Copy)]
struct FileIconMeta {
    class_suffix: &'static str,
    title: &'static str,
    icon: LucideIcon,
}

fn render_site_controls() -> String {
    format!(
        r#"<div class="site-controls">{} {}</div>"#,
        render_sidebar_toggle(),
        render_theme_toggle()
    )
}

fn render_sidebar_toggle() -> String {
    format!(
        r#"<button class="site-control-button sidebar-toggle" type="button" aria-controls="siteSidebar" aria-expanded="true" aria-label="收起侧边栏" title="收起侧边栏"><span aria-hidden="true">{}</span></button>"#,
        lucide_svg(LucideIcon::ChevronLeft)
    )
}

fn render_theme_toggle() -> String {
    format!(
        r#"<button class="site-control-button theme-toggle" type="button" aria-label="切换为暗色" title="切换为暗色"><span class="theme-icon theme-icon-light" aria-hidden="true">{}</span><span class="theme-icon theme-icon-dark" aria-hidden="true">{}</span></button>"#,
        lucide_svg(LucideIcon::Sun),
        lucide_svg(LucideIcon::Moon),
    )
}

fn render_theme_bootstrap() -> &'static str {
    r#"<script>
(function () {
  try {
    var stored = localStorage.getItem("gt-site-theme");
    var preferred = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = stored === "light" || stored === "dark" ? stored : preferred;
  } catch (_) {
    document.documentElement.dataset.theme = "light";
  }
})();
</script>"#
}

fn nav_file_icon(path: &str) -> FileIconMeta {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "md" | "markdown" | "mdx" => FileIconMeta {
            class_suffix: "markdown",
            title: "Markdown 文件",
            icon: LucideIcon::FileText,
        },
        "json" | "jsonc" => FileIconMeta {
            class_suffix: "json",
            title: "JSON 文件",
            icon: LucideIcon::FileJson,
        },
        "js" | "jsx" | "ts" | "tsx" | "rs" | "go" | "py" | "java" | "kt" | "swift" | "c" | "cc"
        | "cpp" | "h" | "hpp" | "sh" | "zsh" | "fish" | "sql" | "xml" | "toml" | "yaml" | "yml"
        | "html" | "css" | "scss" | "vue" | "svelte" => FileIconMeta {
            class_suffix: "code",
            title: "代码文件",
            icon: LucideIcon::FileCode,
        },
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => FileIconMeta {
            class_suffix: "image",
            title: "图片文件",
            icon: LucideIcon::FileImage,
        },
        "pdf" => FileIconMeta {
            class_suffix: "pdf",
            title: "PDF 文件",
            icon: LucideIcon::FileType,
        },
        "csv" | "tsv" | "xls" | "xlsx" => FileIconMeta {
            class_suffix: "sheet",
            title: "表格文件",
            icon: LucideIcon::Sheet,
        },
        "zip" | "gz" | "tgz" | "tar" | "rar" | "7z" => FileIconMeta {
            class_suffix: "archive",
            title: "压缩文件",
            icon: LucideIcon::Archive,
        },
        "mp3" | "wav" | "m4a" | "flac" | "ogg" => FileIconMeta {
            class_suffix: "audio",
            title: "音频文件",
            icon: LucideIcon::Music,
        },
        "mp4" | "mov" | "webm" | "avi" | "mkv" => FileIconMeta {
            class_suffix: "video",
            title: "视频文件",
            icon: LucideIcon::Video,
        },
        "txt" | "log" => FileIconMeta {
            class_suffix: "text",
            title: "文本文件",
            icon: LucideIcon::FileText,
        },
        _ => FileIconMeta {
            class_suffix: "default",
            title: "文件",
            icon: LucideIcon::File,
        },
    }
}

fn lucide_svg(icon: LucideIcon) -> String {
    let paths = match icon {
        LucideIcon::Archive => {
            r#"<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>"#
        }
        LucideIcon::ChevronLeft => r#"<path d="m15 18-6-6 6-6"/>"#,
        LucideIcon::File => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>"#
        }
        LucideIcon::FileCode => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>"#
        }
        LucideIcon::FileImage => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="10" cy="13" r="2"/><path d="m20 17-1.1-1.1a2 2 0 0 0-2.8 0L14 18"/>"#
        }
        LucideIcon::FileJson => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/>"#
        }
        LucideIcon::FileText => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>"#
        }
        LucideIcon::FileType => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 13v-1h6v1"/><path d="M11 18h2"/><path d="M12 12v6"/>"#
        }
        LucideIcon::Folder => {
            r#"<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>"#
        }
        LucideIcon::FolderOpen => {
            r#"<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6A2 2 0 0 1 18.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>"#
        }
        LucideIcon::Moon => r#"<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>"#,
        LucideIcon::Music => {
            r#"<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>"#
        }
        LucideIcon::Sheet => {
            r#"<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M10 9v8"/>"#
        }
        LucideIcon::Sun => {
            r#"<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>"#
        }
        LucideIcon::Video => {
            r#"<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>"#
        }
    };
    format!(
        r#"<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">{paths}</svg>"#
    )
}

fn site_asset_version(_theme: &str) -> String {
    format!("{:x}", stable_hash(&(site_css("") + site_js())))
}

fn render_toc(page: &RenderedPage) -> String {
    if page.headings.is_empty() {
        return "<div class=\"toc-empty\">无大纲</div>".to_string();
    }
    let mut html = String::from("<div class=\"toc-title\">大纲</div><nav>\n");
    for heading in &page.headings {
        if heading.level > 3 {
            continue;
        }
        html.push_str(&format!(
            "<a class=\"toc-l{}\" href=\"#{}\">{}</a>\n",
            heading.level,
            escape_attr(&heading.slug),
            escape_html(&heading.title)
        ));
    }
    html.push_str("</nav>");
    html
}

fn site_css(_theme: &str) -> String {
    r#":root,
html[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f6f8;
  --fg: #17202a;
  --body-fg: #303b49;
  --muted: #667386;
  --border: #dfe5ee;
  --card: #fbfcfd;
  --sidebar-bg: #f7f8fa;
  --toc-bg: #fafbfc;
  --article-bg: #ffffff;
  --table-head-bg: #f4f7fb;
  --accent: #3367c6;
  --code-bg: #f3f6fa;
  --shadow-color: rgb(15 23 42 / 0.10);
  --sidebar-width: 244px;
}
html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #111418;
  --fg: #edf1f6;
  --body-fg: #cfd7e1;
  --muted: #929dad;
  --border: #2d3540;
  --card: #1a1f26;
  --sidebar-bg: #171c22;
  --toc-bg: #14191f;
  --article-bg: #12161b;
  --table-head-bg: #181f27;
  --accent: #8bb9ff;
  --code-bg: #151b22;
  --shadow-color: rgb(0 0 0 / 0.34);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--body-fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
  line-height: 1.72;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.site-shell { display: grid; grid-template-columns: var(--sidebar-width) minmax(0, 1fr) 220px; min-height: 100vh; }
.site-sidebar { position: sticky; top: 0; height: 100vh; min-width: 0; border-right: 1px solid var(--border); background: var(--sidebar-bg); overflow: hidden; }
.site-sidebar-scroll { contain: layout paint; height: 100%; width: var(--sidebar-width); max-width: var(--sidebar-width); overflow-x: hidden; overflow-y: auto; padding: 18px 14px; scrollbar-gutter: stable; }
.site-shell.sidebar-collapsed { grid-template-columns: 0 minmax(0, 1fr) 220px; }
.site-shell.sidebar-collapsed .site-sidebar { border-right: 0; pointer-events: none; }
.site-shell.sidebar-collapsed .site-sidebar-scroll,
.site-shell.sidebar-collapsed .sidebar-resizer { opacity: 0; }
.site-controls { position: fixed; z-index: 30; left: 12px; top: 10px; display: flex; gap: 6px; transform: translateX(calc(var(--sidebar-width) - 72px)); }
.site-control-button { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--muted); box-shadow: 0 8px 18px var(--shadow-color); cursor: pointer; padding: 0; }
.site-control-button:hover { color: var(--fg); background: color-mix(in srgb, var(--accent) 8%, var(--card)); }
.site-control-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent); outline-offset: 2px; }
.site-control-button * { pointer-events: none; }
.site-control-button .lucide-icon { width: 16px; height: 16px; }
.sidebar-toggle .lucide-icon { transition: transform .14s ease; }
.site-shell.sidebar-collapsed .site-controls { transform: translateX(0); }
.site-shell.sidebar-collapsed .sidebar-toggle .lucide-icon { transform: rotate(180deg); }
.theme-icon { display: none; align-items: center; justify-content: center; }
html[data-theme="light"] .theme-toggle .theme-icon-dark,
html:not([data-theme]) .theme-toggle .theme-icon-dark { display: inline-flex; }
html[data-theme="dark"] .theme-toggle .theme-icon-light { display: inline-flex; }
.sidebar-resizer { position: absolute; top: 0; right: 0; width: 6px; height: 100%; cursor: col-resize; z-index: 20; }
.sidebar-resizer::after { content: ""; position: absolute; top: 0; bottom: 0; right: 0; width: 1px; background: transparent; transition: background .12s ease; }
.sidebar-resizer:hover::after,
body.sidebar-resizing .sidebar-resizer::after { background: var(--accent); }
body.sidebar-resizing { cursor: col-resize; user-select: none; }
.site-brand { display: block; color: var(--fg); font-weight: 700; font-size: 14px; margin: 0 0 12px; padding: 0 2px; }
.site-nav { display: flex; flex-direction: column; gap: 0; user-select: none; }
.site-nav details { margin: 0; }
.site-nav summary { list-style: none; }
.site-nav summary::-webkit-details-marker { display: none; }
.site-nav summary,
.site-nav a { display: flex; width: 100%; min-width: 0; align-items: center; gap: 5px; height: 24px; border-radius: 5px; color: var(--muted); font-size: 12.5px; line-height: 24px; padding: 0 6px; overflow: hidden; white-space: nowrap; }
.site-nav summary { cursor: default; }
.site-nav a { text-decoration: none; }
.site-nav summary:hover,
.site-nav a:hover,
.site-nav a.active { background: color-mix(in srgb, var(--accent) 9%, transparent); color: var(--fg); text-decoration: none; }
.site-nav .active-branch > summary { color: var(--fg); }
.nav-children { margin-left: 9px; padding-left: 9px; border-left: 1px solid color-mix(in srgb, var(--border) 78%, transparent); }
.nav-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.lucide-icon { display: block; width: 1em; height: 1em; }
.nav-folder-icon,
.nav-file-icon { width: 14px; height: 14px; flex: 0 0 14px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }
.nav-folder-icon .lucide-icon,
.nav-file-icon .lucide-icon { width: 14px; height: 14px; }
.nav-folder-icon { color: #b98a2f; }
.nav-folder-icon .folder-open { display: none; }
.site-nav details[open] > summary .nav-folder-icon .folder-closed { display: none; }
.site-nav details[open] > summary .nav-folder-icon .folder-open { display: inline-flex; }
.site-nav details[open] > summary .nav-folder-icon { color: #c08f32; }
.nav-file-icon--markdown { color: #4774bb; }
.nav-file-icon--code { color: #8f6ac8; }
.nav-file-icon--json { color: #d39b25; }
.nav-file-icon--image { color: #36a66a; }
.nav-file-icon--pdf { color: #d24a43; }
.nav-file-icon--sheet { color: #278b56; }
.nav-file-icon--archive { color: #8b728e; }
.nav-file-icon--audio { color: #b55ba7; }
.nav-file-icon--video { color: #3d8dbf; }
.nav-file-icon--text { color: #60708a; }
.nav-file-icon--default { color: var(--muted); }
.site-content { min-width: 0; padding: 42px 48px 80px; background: var(--article-bg); }
.markdown-body { max-width: 860px; margin: 0 auto; color: var(--body-fg); }
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 { line-height: 1.25; margin: 1.8em 0 .7em; }
.markdown-body h1 { font-size: 32px; margin-top: 0; }
.markdown-body h2 { font-size: 24px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.markdown-body h3 { font-size: 19px; }
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 { color: var(--fg); font-weight: 700; }
.markdown-body p,
.markdown-body ul,
.markdown-body ol,
.markdown-body blockquote,
.markdown-body table,
.markdown-body pre { margin: 0 0 16px; }
.markdown-body hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
.markdown-body strong { font-weight: 700; color: var(--fg); }
.markdown-body blockquote { border-left: 4px solid var(--border); color: var(--muted); padding: 2px 0 2px 16px; }
.markdown-body code { background: var(--code-bg); border: 1px solid var(--border); border-radius: 5px; font-family: "SFMono-Regular", Consolas, monospace; font-size: .92em; padding: 1px 5px; }
.markdown-body pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; overflow: auto; padding: 14px 16px; }
.markdown-body pre code { border: 0; padding: 0; background: transparent; }
.markdown-body img { display: block; max-width: 100%; height: auto; margin: 18px auto; border-radius: 6px; }
.markdown-body table { width: 100%; border-collapse: collapse; display: block; overflow-x: auto; }
.markdown-body th,
.markdown-body td { border: 1px solid var(--border); padding: 8px 10px; }
.markdown-body th { background: var(--table-head-bg); color: var(--fg); text-align: left; }
.site-toc { position: sticky; top: 0; height: 100vh; overflow: auto; border-left: 1px solid var(--border); background: var(--toc-bg); padding: 32px 18px; color: var(--muted); }
.toc-title { color: var(--fg); font-size: 13px; font-weight: 700; margin-bottom: 10px; }
.site-toc a { display: block; color: var(--muted); font-size: 12px; line-height: 1.45; padding: 5px 0; }
.site-toc .toc-l3 { padding-left: 12px; }
.site-index { max-width: 860px; padding: 56px; }
.eyebrow { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.lead { color: var(--muted); max-width: 560px; }
.primary-link { display: inline-flex; align-items: center; border-radius: 6px; background: var(--accent); color: white; padding: 8px 12px; }
.primary-link:hover { text-decoration: none; filter: brightness(.95); }
.site-search { position: relative; margin-bottom: 14px; }
.site-search input { width: 100%; height: 34px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--fg); padding: 0 10px; }
.search-results { display: none; position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; right: 0; max-height: min(360px, calc(100vh - 118px)); border: 1px solid var(--border); border-radius: 8px; background: var(--card); overflow: auto; box-shadow: 0 10px 26px var(--shadow-color); }
.search-results.open { display: block; }
.search-results a,
.search-results .search-empty { display: block; padding: 8px 10px; border-top: 1px solid var(--border); font-size: 13px; }
.search-results a:first-child { border-top: 0; }
.search-hit { color: var(--body-fg); text-decoration: none; }
.search-hit:hover { background: color-mix(in srgb, var(--accent) 7%, transparent); text-decoration: none; }
.search-hit-head { display: flex; min-width: 0; align-items: center; gap: 8px; }
.search-hit-title { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-weight: 650; }
.search-hit-badge { flex: 0 0 auto; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 999px; color: var(--accent); font-size: 11px; line-height: 1; padding: 3px 6px; }
.search-hit-badge--content { border-color: var(--border); color: var(--muted); }
.search-hit-snippet { margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.45; white-space: normal; }
.search-empty { color: var(--muted); }
@media (max-width: 1100px) {
  :root,
  html[data-theme] { --sidebar-width: 232px; }
  .site-shell { grid-template-columns: var(--sidebar-width) minmax(0, 1fr); }
  .site-shell.sidebar-collapsed { grid-template-columns: 0 minmax(0, 1fr); }
  .site-content { padding: 38px 36px 72px; }
  .site-index { padding: 42px 36px; }
  .site-toc { display: none; }
}
@media (max-width: 760px) {
  :root,
  html[data-theme] { --sidebar-width: 210px; }
  .site-sidebar-scroll { padding: 16px 10px; }
  .site-content { padding: 30px 24px 64px; }
}
@media (max-width: 560px) {
  .site-shell { display: block; }
  .site-sidebar { position: relative; width: auto; height: auto; }
  .site-sidebar-scroll { width: auto; max-width: none; }
  .site-shell.sidebar-collapsed .site-sidebar { display: none; }
  .site-controls,
  .site-shell.sidebar-collapsed .site-controls { left: auto; right: 12px; transform: none; }
  .sidebar-resizer { display: none; }
  .site-content { padding: 28px 20px 60px; }
  .site-index { padding: 28px 20px; }
}
"#
    .to_string()
}

fn site_js() -> &'static str {
    r#"(async function () {
  const shell = document.querySelector(".site-shell");
  const root = shell?.dataset.siteRoot || "";
  const sidebar = document.querySelector(".site-sidebar");
  const toggle = document.querySelector(".sidebar-toggle");
  const themeToggle = document.querySelector(".theme-toggle");
  const resizer = document.querySelector(".sidebar-resizer");
  const sidebarWidthKey = "gt-site-sidebar-width-v2";
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const currentTheme = () => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const updateThemeButton = () => {
    if (!themeToggle) return;
    const isDark = currentTheme() === "dark";
    themeToggle.dataset.theme = isDark ? "dark" : "light";
    themeToggle.setAttribute("aria-label", isDark ? "切换为亮色" : "切换为暗色");
    themeToggle.setAttribute("title", isDark ? "切换为亮色" : "切换为暗色");
  };
  const setTheme = (theme) => {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("gt-site-theme", next);
    updateThemeButton();
  };
  const setSidebarWidth = (value) => {
    const width = clamp(Math.round(value), 184, 520);
    document.documentElement.style.setProperty("--sidebar-width", width + "px");
    localStorage.setItem(sidebarWidthKey, String(width));
  };
  const setSidebarCollapsed = (collapsed) => {
    shell?.classList.toggle("sidebar-collapsed", collapsed);
    if (toggle) {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
      toggle.setAttribute("title", collapsed ? "展开侧边栏" : "收起侧边栏");
    }
    localStorage.setItem("gt-site-sidebar-collapsed", collapsed ? "true" : "false");
  };
  updateThemeButton();
  themeToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    setTheme(currentTheme() === "dark" ? "light" : "dark");
  });
  const storedWidth = Number(localStorage.getItem(sidebarWidthKey));
  if (Number.isFinite(storedWidth) && storedWidth > 0) {
    setSidebarWidth(storedWidth);
  }
  setSidebarCollapsed(localStorage.getItem("gt-site-sidebar-collapsed") === "true");
  document.addEventListener("click", (event) => {
    const target = event.target;
    const button = target?.closest ? target.closest(".sidebar-toggle") : null;
    if (!button) return;
    event.preventDefault();
    setSidebarCollapsed(!shell?.classList.contains("sidebar-collapsed"));
  }, true);
  resizer?.addEventListener("pointerdown", (event) => {
    if (shell?.classList.contains("sidebar-collapsed")) return;
    event.preventDefault();
    document.body.classList.add("sidebar-resizing");
    resizer.setPointerCapture(event.pointerId);
    const onMove = (moveEvent) => setSidebarWidth(moveEvent.clientX);
    const onUp = () => {
      document.body.classList.remove("sidebar-resizing");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
  const active = document.querySelector(".site-nav a.active");
  if (active) {
    requestAnimationFrame(() => {
      const sidebarScroll = document.querySelector(".site-sidebar-scroll");
      if (!sidebarScroll || shell?.classList.contains("sidebar-collapsed")) return;
      const itemRect = active.getBoundingClientRect();
      const sidebarRect = sidebarScroll.getBoundingClientRect();
      sidebarScroll.scrollTop += itemRect.top - sidebarRect.top - sidebarRect.height / 2 + itemRect.height / 2;
    });
  }

  document.querySelectorAll(".site-nav details").forEach((details) => {
    const summary = details.querySelector("summary");
    const key = summary?.getAttribute("title");
    if (!key) return;
    const stored = localStorage.getItem("gt-site-nav:" + key);
    if (stored === "open") details.open = true;
    if (stored === "closed" && !details.classList.contains("active-branch")) details.open = false;
    details.addEventListener("toggle", () => {
      localStorage.setItem("gt-site-nav:" + key, details.open ? "open" : "closed");
    });
  });

  const input = document.getElementById("siteSearch");
  const box = document.getElementById("searchResults");
  if (!input || !box) return;
  let records = [];
  try {
    const response = await fetch(root + "assets/search-index.json");
    records = await response.json();
  } catch (_) {
    return;
  }
  const normalize = (value) => String(value || "").toLowerCase();
  const tokenize = (value) => normalize(value)
    .split(/[\s/\\._#\-:;()[\]{}"'`，。！？、；：（）【】《》<>]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const countOccurrences = (haystack, needle) => {
    if (!needle) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }
    return count;
  };
  const escapeText = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const makeSnippet = (text, query, fallback) => {
    const raw = String(text || "");
    if (!raw) return fallback || "";
    const lower = raw.toLowerCase();
    const at = lower.indexOf(query);
    const center = at >= 0 ? at : 0;
    const start = Math.max(0, center - 42);
    const end = Math.min(raw.length, center + query.length + 76);
    return `${start > 0 ? "..." : ""}${raw.slice(start, end).trim()}${end < raw.length ? "..." : ""}`;
  };
  const scoreText = (rawText, query, terms) => {
    const text = normalize(rawText);
    if (!text) return null;
    const phraseAt = text.indexOf(query);
    const matchedTerms = terms.filter((term) => text.includes(term));
    if (phraseAt < 0 && matchedTerms.length === 0) return null;
    const phraseCount = countOccurrences(text, query);
    const termCount = matchedTerms.reduce((sum, term) => sum + countOccurrences(text, term), 0);
    const coverage = terms.length ? matchedTerms.length / terms.length : 0;
    const earliestTermAt = matchedTerms.reduce((best, term) => {
      const index = text.indexOf(term);
      return index >= 0 ? Math.min(best, index) : best;
    }, Number.MAX_SAFE_INTEGER);
    const earliest = phraseAt >= 0 ? phraseAt : earliestTermAt;
    const starts = phraseAt === 0 || matchedTerms.some((term) => text.startsWith(term));
    const exact = text === query;
    const score =
      (exact ? 260 : 0) +
      (phraseAt >= 0 ? 150 : 0) +
      (starts ? 70 : 0) +
      coverage * 80 +
      Math.min(phraseCount, 6) * 18 +
      Math.min(termCount, 12) * 4 +
      Math.max(0, 28 - Math.min(earliest, 28));
    return { score, phraseAt, earliest, matchedTerms, phraseCount, termCount };
  };
  const scoreRecord = (item, query, terms) => {
    const titleText = item.title || "";
    const titleMatch = scoreText(titleText, query, terms);
    if (titleMatch) {
      return {
        ...item,
        matchType: "title",
        matchLabel: "标题命中",
        score: 2000 + titleMatch.score,
        snippet: makeSnippet(titleText, query, item.path),
      };
    }
    const headingText = (item.headings || []).join(" ");
    const headingMatch = scoreText(headingText, query, terms);
    const bodyMatch = scoreText(item.text, query, terms);
    if (!headingMatch && !bodyMatch) return null;
    const contentScore = Math.max(
      bodyMatch ? bodyMatch.score : 0,
      headingMatch ? headingMatch.score * 0.8 + 40 : 0,
    );
    return {
      ...item,
      matchType: "content",
      matchLabel: "内容命中",
      score: 1000 + contentScore,
      snippet: makeSnippet(bodyMatch ? item.text : headingText, query, item.path),
    };
  };
  const renderHit = (item) => {
    const badgeClass = item.matchType === "title" ? "" : " search-hit-badge--content";
    return `<a class="search-hit" href="${root + item.path}">
      <div class="search-hit-head">
        <span class="search-hit-title">${escapeText(item.title)}</span>
        <span class="search-hit-badge${badgeClass}">${item.matchLabel}</span>
      </div>
      <div class="search-hit-snippet">${escapeText(item.snippet || item.path)}</div>
    </a>`;
  };
  input.addEventListener("input", () => {
    const raw = input.value.trim();
    const q = raw.toLowerCase();
    if (!q) {
      box.classList.remove("open");
      box.innerHTML = "";
      return;
    }
    const terms = tokenize(raw);
    const hits = records
      .map((item) => scoreRecord(item, q, terms))
      .filter(Boolean)
      .sort((a, b) =>
        b.score - a.score ||
        a.matchType.localeCompare(b.matchType) ||
        String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"),
      )
      .slice(0, 12);
    box.innerHTML = hits.length
      ? hits.map(renderHit).join("")
      : `<div class="search-empty">没有匹配结果</div>`;
    box.classList.add("open");
  });
})();"#
}

fn strip_frontmatter(markdown: &str) -> (&str, Option<String>, bool) {
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

fn parse_heading(trimmed: &str) -> Option<(usize, String)> {
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

fn parse_unordered_list_item(trimmed: &str) -> Option<&str> {
    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = trimmed.strip_prefix(marker) {
            return Some(rest);
        }
    }
    None
}

fn parse_ordered_list_item(trimmed: &str) -> Option<&str> {
    let dot = trimmed.find(". ")?;
    if dot == 0 || !trimmed[..dot].chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(&trimmed[dot + 2..])
}

fn is_table_start(lines: &[&str], index: usize) -> bool {
    if index + 1 >= lines.len() {
        return false;
    }
    lines[index].contains('|') && is_table_separator(lines[index + 1].trim())
}

fn is_thematic_break(trimmed: &str) -> bool {
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

fn render_table(
    lines: &[&str],
    repo: &Path,
    output_dir: &Path,
    file: &MarkdownFile,
    page_map: &HashMap<String, String>,
    copy_assets: bool,
    assets: &mut AssetContext,
) -> Result<(String, usize)> {
    let headers = split_table_row(lines[0]);
    let mut html = String::from("<table>\n<thead><tr>");
    for header in headers {
        html.push_str(&format!(
            "<th>{}</th>",
            render_inline(
                header.trim(),
                repo,
                output_dir,
                file,
                page_map,
                copy_assets,
                assets
            )?
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
            html.push_str(&format!(
                "<td>{}</td>",
                render_inline(
                    cell.trim(),
                    repo,
                    output_dir,
                    file,
                    page_map,
                    copy_assets,
                    assets
                )?
            ));
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

fn unique_slug(title: &str, used: &mut HashMap<String, usize>) -> String {
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

fn apply_basic_emphasis(input: &str) -> String {
    // Keep emphasis deliberately small; all raw HTML was escaped before this pass.
    input.to_string()
}

fn starts_with_marker(chars: &[char], index: usize, marker: &str) -> bool {
    let marker_chars = marker.chars().collect::<Vec<_>>();
    index + marker_chars.len() <= chars.len()
        && marker_chars
            .iter()
            .enumerate()
            .all(|(offset, ch)| chars[index + offset] == *ch)
}

fn find_inline_marker(chars: &[char], start: usize, marker: &str) -> Option<usize> {
    let marker_len = marker.chars().count();
    if marker_len == 0 || start + marker_len > chars.len() {
        return None;
    }
    (start..=chars.len().saturating_sub(marker_len))
        .find(|index| starts_with_marker(chars, *index, marker))
}

fn find_inline_char(chars: &[char], start: usize, marker: char) -> Option<usize> {
    chars
        .iter()
        .enumerate()
        .skip(start)
        .find_map(|(index, ch)| (*ch == marker).then_some(index))
}

fn is_word_char(ch: Option<char>) -> bool {
    ch.is_some_and(|ch| ch.is_alphanumeric())
}

fn normalize_plain_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(path)
        .replace(['_', '-'], " ")
}

fn upsert_candidate(
    candidates: &mut BTreeMap<String, SitePathCandidate>,
    path: String,
    kind: SitePathKind,
    score: u32,
    reason: String,
    markdown_count: usize,
) {
    candidates
        .entry(path.clone())
        .and_modify(|candidate| {
            candidate.score = candidate.score.max(score);
            candidate.markdown_count = candidate.markdown_count.max(markdown_count);
            if !candidate.reason.contains(&reason) {
                candidate.reason.push(reason.clone());
            }
        })
        .or_insert(SitePathCandidate {
            path,
            kind,
            score,
            reason: vec![reason],
            markdown_count,
            selected_by_default: false,
        });
}

fn should_ignore(rel: &Path, is_dir: bool) -> bool {
    if rel.as_os_str().is_empty() {
        return false;
    }
    let rel_slash = path_to_slash(rel).to_ascii_lowercase();
    let first = rel
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .unwrap_or("")
        .to_ascii_lowercase();
    let ignored_roots = [
        ".git",
        ".gittributary",
        "node_modules",
        "target",
        "dist",
        "build",
        "out",
        ".next",
        ".nuxt",
        "vendor",
        "coverage",
    ];
    ignored_roots.contains(&first.as_str()) || (is_dir && rel_slash == "src-tauri/target")
}

fn is_high_priority_doc_dir(lower: &str) -> bool {
    let leaf = lower.rsplit('/').next().unwrap_or(lower);
    matches!(
        leaf,
        "doc"
            | "docs"
            | "documentation"
            | "wiki"
            | "notes"
            | "handbook"
            | "architecture"
            | "design"
    )
}

fn contains_doc_keyword(lower: &str) -> bool {
    ["guide", "manual", "spec", "runbook", "sop"]
        .iter()
        .any(|keyword| lower.contains(keyword))
}

fn is_asset(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" | "pdf"
    )
}

fn is_markdown(path: &Path) -> bool {
    is_markdown_path(path)
}

fn is_markdown_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "md" | "markdown")
}

fn file_name_lower(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn relative_path(base: &Path, path: &Path) -> Result<PathBuf> {
    path.strip_prefix(base)
        .map(Path::to_path_buf)
        .map_err(|_| SiteError::PathOutsideRepo(path.to_string_lossy().to_string()))
}

fn ensure_inside_repo(repo: &Path, path: &Path) -> Result<()> {
    let candidate = if path.exists() {
        path.canonicalize()?
    } else {
        let parent = path.parent().unwrap_or(repo);
        let canonical_parent = parent.canonicalize().unwrap_or_else(|_| repo.to_path_buf());
        canonical_parent.join(path.file_name().unwrap_or_default())
    };
    if candidate.starts_with(repo) {
        Ok(())
    } else {
        Err(SiteError::PathOutsideRepo(
            path.to_string_lossy().to_string(),
        ))
    }
}

fn normalize_user_rel_path(value: &str) -> Result<PathBuf> {
    let path = Path::new(value.trim());
    if path.is_absolute() {
        return Err(SiteError::PathOutsideRepo(value.to_string()));
    }
    normalize_join(Path::new(""), value)
}

fn normalize_join(base: &Path, value: &str) -> Result<PathBuf> {
    let mut path = PathBuf::from(base);
    for component in Path::new(value).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !path.pop() {
                    return Err(SiteError::PathOutsideRepo(value.to_string()));
                }
            }
            _ => return Err(SiteError::PathOutsideRepo(value.to_string())),
        }
    }
    Ok(path)
}

fn is_excluded(path: &Path, exclude: &[PathBuf]) -> bool {
    exclude
        .iter()
        .any(|prefix| path == prefix || path.starts_with(prefix))
}

fn markdown_output_rel(rel: &Path) -> String {
    let mut output = PathBuf::from("pages");
    output.push(rel);
    output.set_extension("html");
    path_to_slash(&output)
}

fn path_to_slash(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn natural_doc_key(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    lower
        .replace("readme.md", "000-readme.md")
        .replace("index.md", "001-index.md")
}

fn compare_site_candidates(a: &SitePathCandidate, b: &SitePathCandidate) -> std::cmp::Ordering {
    let a_parts = a.path.split('/').collect::<Vec<_>>();
    let b_parts = b.path.split('/').collect::<Vec<_>>();
    let len = a_parts.len().min(b_parts.len());

    for index in 0..len {
        let a_is_dir = index < a_parts.len() - 1 || matches!(a.kind, SitePathKind::Dir);
        let b_is_dir = index < b_parts.len() - 1 || matches!(b.kind, SitePathKind::Dir);
        if a_is_dir != b_is_dir {
            return if a_is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }

        let order =
            natural_component_key(a_parts[index]).cmp(&natural_component_key(b_parts[index]));
        if !order.is_eq() {
            return order;
        }
    }

    a_parts.len().cmp(&b_parts.len())
}

fn natural_component_key(value: &str) -> Vec<NaturalPart> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut current_is_digit = None;

    for ch in value.chars() {
        let is_digit = ch.is_ascii_digit();
        if current_is_digit == Some(is_digit) {
            current.push(ch);
            continue;
        }
        if !current.is_empty() {
            parts.push(NaturalPart::from_segment(
                &current,
                current_is_digit.unwrap_or(false),
            ));
            current.clear();
        }
        current_is_digit = Some(is_digit);
        current.push(ch);
    }

    if !current.is_empty() {
        parts.push(NaturalPart::from_segment(
            &current,
            current_is_digit.unwrap_or(false),
        ));
    }
    parts
}

#[derive(Debug, Eq, PartialEq, Ord, PartialOrd)]
enum NaturalPart {
    Text(String),
    Number(u64, usize),
}

impl NaturalPart {
    fn from_segment(value: &str, is_digit: bool) -> Self {
        if is_digit {
            NaturalPart::Number(value.parse::<u64>().unwrap_or(u64::MAX), value.len())
        } else {
            NaturalPart::Text(value.to_ascii_lowercase())
        }
    }
}

fn relative_url(from_file: &str, target: &str) -> String {
    let from_dir = Path::new(from_file)
        .parent()
        .map(path_to_slash)
        .unwrap_or_default();
    let mut parts = Vec::new();
    if !from_dir.is_empty() {
        parts.extend(from_dir.split('/').map(|_| "..".to_string()));
    }
    parts.extend(target.split('/').map(str::to_string));
    if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    }
}

fn split_anchor(url: &str) -> (&str, Option<&str>) {
    if let Some(index) = url.find('#') {
        (&url[..index], Some(&url[index..]))
    } else {
        (url, None)
    }
}

fn is_external_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
        || lower.starts_with("data:")
}

fn safe_href(url: &str, source: &str, assets: &mut AssetContext) -> String {
    if url.to_ascii_lowercase().starts_with("javascript:") {
        assets.warnings.push(SiteBuildWarning {
            path: source.to_string(),
            message: format!("已移除 javascript 链接: {url}"),
        });
        "#".to_string()
    } else {
        url.to_string()
    }
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(value: &str) -> String {
    escape_html(value).replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_finds_doc_candidates() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "# Hello").unwrap();
        fs::create_dir_all(tmp.path().join("doc")).unwrap();
        fs::write(tmp.path().join("doc/a.md"), "# A").unwrap();
        fs::write(tmp.path().join("doc/b.md"), "# B").unwrap();
        let report = scan_repo(tmp.path()).unwrap();
        assert_eq!(report.markdown_count, 3);
        assert!(report
            .candidates
            .iter()
            .any(|item| item.path == "README.md"));
        assert!(report.candidates.iter().any(|item| item.path == "doc"));
    }

    #[test]
    fn scan_candidates_follow_filesystem_order() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "# Hello").unwrap();
        fs::create_dir_all(tmp.path().join("doc")).unwrap();
        fs::write(tmp.path().join("doc/a.md"), "# A").unwrap();
        fs::create_dir_all(tmp.path().join("docs")).unwrap();
        fs::write(tmp.path().join("docs/a.md"), "# A").unwrap();
        fs::write(tmp.path().join("docs/b.md"), "# B").unwrap();
        fs::write(tmp.path().join("docs/c.md"), "# C").unwrap();
        fs::create_dir_all(tmp.path().join("notes")).unwrap();
        fs::write(tmp.path().join("notes/1.md"), "# 1").unwrap();
        fs::write(tmp.path().join("notes/2.md"), "# 2").unwrap();
        fs::write(tmp.path().join("notes/10.md"), "# 10").unwrap();

        let report = scan_repo(tmp.path()).unwrap();
        let paths = report
            .candidates
            .iter()
            .map(|item| item.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["doc", "docs", "notes", "README.md"]);
    }

    #[test]
    fn build_generates_index_and_page() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("README.md"),
            "# Hello\n\nSee [Doc](doc/a.md).",
        )
        .unwrap();
        fs::create_dir_all(tmp.path().join("doc")).unwrap();
        fs::write(tmp.path().join("doc/a.md"), "# A\n\nText").unwrap();
        let output = tmp.path().join("site");
        let report = build_site(SiteBuildConfig {
            repo_path: tmp.path().to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
            site_title: "Test".to_string(),
            include: vec!["README.md".to_string(), "doc".to_string()],
            exclude: Vec::new(),
            theme: "typora-light".to_string(),
            with_search: true,
            copy_assets: true,
        })
        .unwrap();
        assert_eq!(report.page_count, 2);
        assert!(output.join("index.html").exists());
        assert!(output.join("pages/README.html").exists());
        assert!(output.join("pages/doc/a.html").exists());
    }

    #[test]
    fn build_renders_folder_tree_nav() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "# Hello").unwrap();
        fs::create_dir_all(tmp.path().join("doc/Git")).unwrap();
        fs::write(tmp.path().join("doc/Git/a.md"), "# A").unwrap();
        let output = tmp.path().join("site");

        build_site(SiteBuildConfig {
            repo_path: tmp.path().to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
            site_title: "Test".to_string(),
            include: vec!["README.md".to_string(), "doc".to_string()],
            exclude: Vec::new(),
            theme: "typora-light".to_string(),
            with_search: true,
            copy_assets: true,
        })
        .unwrap();

        let index = fs::read_to_string(output.join("index.html")).unwrap();
        assert!(index.contains(r#"<details class="nav-dir""#));
        assert!(index.contains(r#"<summary title="doc""#));
        assert!(index.contains(r#"data-icon-set="lucide""#));
        assert!(index.contains(r#"nav-file-icon--markdown"#));
        assert!(index.contains(r#"<span class="nav-label">README.md</span>"#));
    }

    #[test]
    fn build_renders_basic_markdown_formatting() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("README.md"),
            "# Hello\n\n---\n\n**为什么需要：** 让页面像 Typora。\n\n普通 *强调* 和 ~~删除~~。",
        )
        .unwrap();
        let output = tmp.path().join("site");

        build_site(SiteBuildConfig {
            repo_path: tmp.path().to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
            site_title: "Test".to_string(),
            include: vec!["README.md".to_string()],
            exclude: Vec::new(),
            theme: "typora-light".to_string(),
            with_search: true,
            copy_assets: true,
        })
        .unwrap();

        let page = fs::read_to_string(output.join("pages/README.html")).unwrap();
        assert!(page.contains("<hr>"));
        assert!(page.contains("<strong>为什么需要：</strong>"));
        assert!(page.contains("<em>强调</em>"));
        assert!(page.contains("<del>删除</del>"));
    }
}
