use std::collections::BTreeMap;
use std::path::Path;

use crate::renderer::chrome::{lucide_svg, nav_file_icon, LucideIcon};
use crate::renderer::shared::{escape_attr, escape_html, relative_url};
use crate::types::{NavTreeNode, RenderedPage};
use crate::utils::natural_component_key;

pub(crate) fn render_nav(pages: &[RenderedPage], active: Option<&str>) -> String {
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

pub(crate) fn render_nav_children(
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

