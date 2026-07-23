use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use regex::Regex;
use walkdir::WalkDir;

use crate::model::{AttachmentKind, GitHubMigrationFailure, MAX_NOTE_BYTES};
use crate::paths::{attachment_kind, extension, included_entry, relative_path};
use crate::references::{mask_fenced_code, resolve_reference};

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub(super) fn rewrite_repository_notes(
    root: &Path,
    replacements: &HashMap<String, String>,
) -> Result<(Vec<String>, usize, Vec<GitHubMigrationFailure>), String> {
    if replacements.is_empty() {
        return Ok((Vec::new(), 0, Vec::new()));
    }
    let mut by_name = HashMap::<String, Option<String>>::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(included_entry)
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && attachment_kind(&extension(entry.path())) == Some(AttachmentKind::Image)
        })
    {
        let path = relative_path(root, entry.path())?;
        let Some(name) = entry.file_name().to_str() else {
            continue;
        };
        by_name
            .entry(name.to_string())
            .and_modify(|value| *value = None)
            .or_insert(Some(path));
    }

    let mut markdown_paths = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(included_entry)
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && matches!(extension(entry.path()).as_str(), "md" | "markdown")
        })
        .map(|entry| entry.into_path())
        .collect::<Vec<_>>();
    markdown_paths.sort();

    let mut changed_note_paths = Vec::new();
    let mut replaced_references = 0;
    let mut failed_notes = Vec::new();
    for note_path in markdown_paths {
        let note_relative = relative_path(root, &note_path)?;
        let metadata = match fs::metadata(&note_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                failed_notes.push(GitHubMigrationFailure {
                    path: note_relative,
                    error: error.to_string(),
                });
                continue;
            }
        };
        if metadata.len() > MAX_NOTE_BYTES {
            failed_notes.push(GitHubMigrationFailure {
                path: note_relative,
                error: "note_too_large".to_string(),
            });
            continue;
        }
        let content = match fs::read_to_string(&note_path) {
            Ok(content) => content,
            Err(error) => {
                failed_notes.push(GitHubMigrationFailure {
                    path: note_relative,
                    error: error.to_string(),
                });
                continue;
            }
        };
        let (next, count) =
            rewrite_markdown_links(&note_relative, &content, replacements, &by_name)?;
        if count == 0 {
            continue;
        }
        if let Err(error) = atomic_write(&note_path, &next, metadata.permissions()) {
            failed_notes.push(GitHubMigrationFailure {
                path: note_relative,
                error,
            });
            continue;
        }
        changed_note_paths.push(note_relative);
        replaced_references += count;
    }
    Ok((changed_note_paths, replaced_references, failed_notes))
}

pub(super) fn rewrite_markdown_links(
    note_path: &str,
    content: &str,
    replacements: &HashMap<String, String>,
    by_name: &HashMap<String, Option<String>>,
) -> Result<(String, usize), String> {
    static MARKDOWN: OnceLock<Regex> = OnceLock::new();
    static WIKI: OnceLock<Regex> = OnceLock::new();
    static HTML: OnceLock<Regex> = OnceLock::new();
    let markdown = MARKDOWN.get_or_init(|| {
        Regex::new(r#"(!?)\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[\"'][^\"']*[\"'])?\s*\)"#)
            .expect("valid markdown attachment regex")
    });
    let wiki = WIKI.get_or_init(|| {
        Regex::new(r#"(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]"#)
            .expect("valid wiki attachment regex")
    });
    let html = HTML.get_or_init(|| {
        Regex::new(r#"(?i)\b(src|href)\s*=\s*[\"']([^\"']+)[\"']"#)
            .expect("valid HTML attachment regex")
    });
    let searchable = mask_fenced_code(content);
    let mut edits = BTreeMap::<(usize, usize), String>::new();

    for captures in markdown.captures_iter(&searchable) {
        if let Some(target) = captures.get(2).or_else(|| captures.get(3)) {
            collect_link_edit(note_path, target, replacements, by_name, &mut edits);
        }
    }
    for captures in wiki.captures_iter(&searchable) {
        if let Some(target) = captures.get(2) {
            collect_link_edit(note_path, target, replacements, by_name, &mut edits);
        }
    }
    for captures in html.captures_iter(&searchable) {
        if let Some(target) = captures.get(2) {
            collect_link_edit(note_path, target, replacements, by_name, &mut edits);
        }
    }
    let count = edits.len();
    let mut rewritten = content.to_string();
    for ((start, end), value) in edits.into_iter().rev() {
        rewritten.replace_range(start..end, &value);
    }
    Ok((rewritten, count))
}

fn collect_link_edit(
    note_path: &str,
    target: regex::Match<'_>,
    replacements: &HashMap<String, String>,
    by_name: &HashMap<String, Option<String>>,
    edits: &mut BTreeMap<(usize, usize), String>,
) {
    let Some(resolved) = resolve_reference(note_path, target.as_str()) else {
        return;
    };
    let matched_path = if replacements.contains_key(&resolved) {
        Some(resolved)
    } else {
        Path::new(&resolved)
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| by_name.get(name))
            .and_then(Clone::clone)
    };
    let Some(url) = matched_path.and_then(|path| replacements.get(&path)) else {
        return;
    };
    edits.insert((target.start(), target.end()), url.clone());
}

fn atomic_write(path: &Path, content: &str, permissions: fs::Permissions) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "note_parent_missing".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "note_name_invalid".to_string())?;
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{file_name}.noteaura-{}-{sequence}",
        std::process::id()
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    if let Err(error) = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .and_then(|_| fs::set_permissions(&temporary, permissions))
        .and_then(|_| fs::rename(&temporary, path))
    {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
}
