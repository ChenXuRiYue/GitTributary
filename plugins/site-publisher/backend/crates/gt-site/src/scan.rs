use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use walkdir::{DirEntry, WalkDir};

use crate::types::{Result, SitePathCandidate, SitePathKind, SiteScanReport};
use crate::utils::{
    canonical_repo, file_name_lower, is_asset, is_markdown, natural_component_key, path_to_slash,
    relative_path,
};

const MAX_SCAN_DEPTH: usize = 128;
const MAX_SCAN_ENTRIES: usize = 100_000;

const DEFAULT_EXCLUDES: &[&str] = &[
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
    "src-tauri/target",
];

pub fn scan_repo(repo_path: impl AsRef<Path>) -> Result<SiteScanReport> {
    let repo = canonical_repo(repo_path.as_ref())?;
    let repo_name = repo
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("site")
        .to_string();
    let ignored = DEFAULT_EXCLUDES
        .iter()
        .filter(|path| repo.join(path).exists())
        .map(|path| crate::types::SiteIgnoredPath {
            path: (*path).to_string(),
            reason: "默认忽略规则".to_string(),
        })
        .collect();
    let mut markdown_files = Vec::new();
    let mut asset_count = 0;
    let mut scanned_entries = 0usize;
    let walker = WalkDir::new(&repo)
        .follow_links(false)
        .max_depth(MAX_SCAN_DEPTH)
        .into_iter()
        .filter_entry(|entry| should_visit(&repo, entry));
    for entry in walker {
        let entry = entry?;
        if entry.depth() == 0 || entry.file_type().is_symlink() {
            continue;
        }
        scanned_entries += 1;
        if scanned_entries > MAX_SCAN_ENTRIES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.into_path();
        if is_markdown(&path) {
            markdown_files.push(path);
        } else if is_asset(&path) {
            asset_count += 1;
        }
    }

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

fn should_visit(repo: &Path, entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let Ok(relative) = entry.path().strip_prefix(repo) else {
        return false;
    };
    let relative = path_to_slash(relative);
    !DEFAULT_EXCLUDES
        .iter()
        .any(|excluded| relative == *excluded || relative.starts_with(&format!("{excluded}/")))
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
