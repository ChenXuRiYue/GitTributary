use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::types::{MarkdownFile, Result, SiteError, SiteIgnoredPath};

pub(crate) fn canonical_repo(path: &Path) -> Result<PathBuf> {
    if !path.exists() {
        return Err(SiteError::RepoMissing(path.to_string_lossy().to_string()));
    }
    let path = path.canonicalize()?;
    if !path.is_dir() {
        return Err(SiteError::RepoNotDir(path.to_string_lossy().to_string()));
    }
    Ok(path)
}

pub(crate) fn normalize_output_dir(repo: &Path, output_dir: &str) -> Result<PathBuf> {
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

pub(crate) fn prepare_output_dir(output_dir: &Path) -> Result<()> {
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

pub(crate) fn collect_markdown_files(
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

pub(crate) fn collect_markdown_files_in_dir(
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

pub(crate) fn is_asset(path: &Path) -> bool {
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

pub(crate) fn is_markdown(path: &Path) -> bool {
    is_markdown_path(path)
}

pub(crate) fn is_markdown_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "md" | "markdown")
}

pub(crate) fn file_name_lower(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub(crate) fn relative_path(base: &Path, path: &Path) -> Result<PathBuf> {
    path.strip_prefix(base)
        .map(Path::to_path_buf)
        .map_err(|_| SiteError::PathOutsideRepo(path.to_string_lossy().to_string()))
}

pub(crate) fn ensure_inside_repo(repo: &Path, path: &Path) -> Result<()> {
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

pub(crate) fn normalize_join(base: &Path, value: &str) -> Result<PathBuf> {
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

pub(crate) fn markdown_output_rel(rel: &Path) -> String {
    let mut output = PathBuf::from("pages");
    output.push(rel);
    output.set_extension("html");
    path_to_slash(&output)
}

pub(crate) fn path_to_slash(path: &Path) -> String {
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

pub(crate) fn natural_component_key(value: &str) -> Vec<NaturalPart> {
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
pub(crate) enum NaturalPart {
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
