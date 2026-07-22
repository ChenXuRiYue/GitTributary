use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{Instant, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use walkdir::WalkDir;

use crate::model::{
    AttachmentItem, AttachmentKind, AttachmentPreview, AttachmentPreviewChunk, AttachmentReference,
    AttachmentScanReport, MAX_NOTE_BYTES,
};
use crate::paths::{
    attachment_kind, canonical_root, extension, included_entry, mime_type, relative_path,
    resolve_existing_file,
};
use crate::references::{extract_references, remote_link_metadata, resolve_reference};

pub(super) const MAX_INLINE_AUDIO_PREVIEW_BYTES: u64 = 24 * 1024 * 1024;
// Divisible by three so separately encoded chunks form one valid Base64 payload.
pub(super) const PREVIEW_CHUNK_BYTES: usize = 384 * 1024;

pub(super) fn scan_repository(repo_path: &str) -> Result<AttachmentScanReport, String> {
    let started = Instant::now();
    let root = canonical_root(repo_path)?;
    let mut attachments = Vec::new();
    let mut markdown_paths = Vec::new();
    let mut skipped_entries = 0;
    let mut notes_scanned = 0;

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(included_entry)
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let extension = extension(path);
        if matches!(extension.as_str(), "md" | "markdown") {
            markdown_paths.push(path.to_path_buf());
            continue;
        }
        let Some(kind) = attachment_kind(&extension) else {
            continue;
        };
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        attachments.push(AttachmentItem {
            path: relative_path(&root, path)?,
            url: None,
            name: entry.file_name().to_string_lossy().into_owned(),
            extension: extension.clone(),
            kind,
            link_kind: None,
            domain: None,
            mime_type: mime_type(&extension).to_string(),
            size: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs()),
            references: Vec::new(),
        });
    }

    attachments.sort_by(|left, right| left.path.cmp(&right.path));
    markdown_paths.sort();
    let by_path = attachments
        .iter()
        .enumerate()
        .map(|(index, item)| (item.path.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, item) in attachments.iter().enumerate() {
        by_name.entry(item.name.clone()).or_default().push(index);
    }
    let mut by_remote_url = HashMap::<String, usize>::new();

    for note_path in &markdown_paths {
        let metadata = match fs::metadata(note_path) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        if metadata.len() > MAX_NOTE_BYTES {
            skipped_entries += 1;
            continue;
        }
        let Ok(content) = fs::read_to_string(note_path) else {
            skipped_entries += 1;
            continue;
        };
        notes_scanned += 1;
        let note_relative = relative_path(&root, note_path)?;
        for extracted in extract_references(&content)? {
            if let Some(remote) = remote_link_metadata(&extracted.target) {
                let reference = AttachmentReference {
                    note_path: note_relative.clone(),
                    line: extracted.line,
                    role: extracted.role,
                };
                if let Some(index) = by_remote_url.get(&remote.canonical_key).copied() {
                    if !attachments[index].references.contains(&reference) {
                        attachments[index].references.push(reference);
                    }
                } else {
                    let index = attachments.len();
                    attachments.push(AttachmentItem {
                        path: remote.url.clone(),
                        url: Some(remote.url),
                        name: remote.name,
                        extension: remote.extension.clone(),
                        kind: AttachmentKind::Link,
                        link_kind: Some(remote.link_kind),
                        domain: Some(remote.domain),
                        mime_type: mime_type(&remote.extension).to_string(),
                        size: 0,
                        modified_at: None,
                        references: vec![reference],
                    });
                    by_remote_url.insert(remote.canonical_key, index);
                }
                continue;
            }
            let Some(target) = resolve_reference(&note_relative, &extracted.target) else {
                continue;
            };
            let index = by_path.get(&target).copied().or_else(|| {
                Path::new(&target)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .and_then(|name| by_name.get(name))
                    .filter(|matches| matches.len() == 1)
                    .map(|matches| matches[0])
            });
            let Some(index) = index else { continue };
            let reference = AttachmentReference {
                note_path: note_relative.clone(),
                line: extracted.line,
                role: extracted.role,
            };
            if !attachments[index].references.contains(&reference) {
                attachments[index].references.push(reference);
            }
        }
    }

    let total_size = attachments.iter().map(|item| item.size).sum();
    Ok(AttachmentScanReport {
        repo_path: root.to_string_lossy().into_owned(),
        scanned_at: std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        duration_ms: started.elapsed().as_millis(),
        notes_scanned,
        skipped_entries,
        total_size,
        attachments,
    })
}

pub(super) fn read_preview(repo_path: &str, relative: &str) -> Result<AttachmentPreview, String> {
    let root = canonical_root(repo_path)?;
    let path = resolve_existing_file(&root, relative)?;
    let extension = extension(&path);
    let Some(kind) = attachment_kind(&extension) else {
        return Err("preview_type_not_supported".to_string());
    };
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if kind == AttachmentKind::Audio && metadata.len() > MAX_INLINE_AUDIO_PREVIEW_BYTES {
        return Err("preview_file_too_large".to_string());
    }
    Ok(AttachmentPreview {
        path: relative_path(&root, &path)?,
        mime_type: mime_type(&extension).to_string(),
        size: metadata.len(),
        chunk_size: PREVIEW_CHUNK_BYTES,
    })
}

pub(super) fn read_preview_chunk(
    repo_path: &str,
    relative: &str,
    offset: u64,
    expected_size: u64,
) -> Result<AttachmentPreviewChunk, String> {
    let root = canonical_root(repo_path)?;
    let path = resolve_existing_file(&root, relative)?;
    let extension = extension(&path);
    let Some(kind) = attachment_kind(&extension) else {
        return Err("preview_type_not_supported".to_string());
    };
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if kind == AttachmentKind::Audio && metadata.len() > MAX_INLINE_AUDIO_PREVIEW_BYTES {
        return Err("preview_file_too_large".to_string());
    }
    if metadata.len() != expected_size {
        return Err("preview_file_changed".to_string());
    }
    if offset > expected_size {
        return Err("invalid_preview_offset".to_string());
    }

    let mut file = fs::File::open(&path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let remaining = expected_size.saturating_sub(offset);
    let read_size = remaining.min(PREVIEW_CHUNK_BYTES as u64) as usize;
    let mut bytes = vec![0; read_size];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    let next_offset = offset + bytes.len() as u64;
    Ok(AttachmentPreviewChunk {
        path: relative_path(&root, &path)?,
        offset,
        next_offset,
        data: BASE64.encode(bytes),
        done: next_offset == expected_size,
    })
}
