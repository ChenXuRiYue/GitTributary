use crate::renderer::assets::site_asset_version;
use crate::renderer::chrome::{render_site_controls, render_theme_bootstrap};
use crate::renderer::shared::{escape_attr, escape_html, relative_url};
use crate::types::{RenderedPage, SiteBuildConfig};

pub(crate) fn render_index_html(
    config: &SiteBuildConfig,
    pages: &[RenderedPage],
    nav_html: &str,
    with_search: bool,
) -> String {
    let title = if config.site_title.trim().is_empty() {
        "Note Aura Site"
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
      <p class="eyebrow">Note Aura Static Site</p>
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

pub(crate) fn render_page_html(
    config: &SiteBuildConfig,
    page: &RenderedPage,
    nav_html: &str,
) -> String {
    let title = if config.site_title.trim().is_empty() {
        "Note Aura Site"
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
