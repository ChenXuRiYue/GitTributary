use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use percent_encoding::percent_decode_str;
use regex::Regex;
use url::Url;

use crate::model::{LinkKind, ReferenceRole};
use crate::paths::{extension, normalize_components};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ExtractedReference {
    pub(super) target: String,
    pub(super) line: usize,
    pub(super) role: ReferenceRole,
}

pub(super) fn extract_references(content: &str) -> Result<Vec<ExtractedReference>, String> {
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
    let newline_offsets = searchable
        .bytes()
        .enumerate()
        .filter_map(|(offset, byte)| (byte == b'\n').then_some(offset))
        .collect::<Vec<_>>();
    let mut found = BTreeMap::<(usize, String, ReferenceRole), ()>::new();

    for captures in markdown.captures_iter(&searchable) {
        let Some(target) = captures.get(2).or_else(|| captures.get(3)) else {
            continue;
        };
        let role = if captures.get(1).is_some_and(|value| value.as_str() == "!") {
            ReferenceRole::Embed
        } else {
            ReferenceRole::Navigation
        };
        insert_extracted_reference(target, role, &newline_offsets, &mut found);
    }
    for captures in wiki.captures_iter(&searchable) {
        let Some(target) = captures.get(2) else {
            continue;
        };
        let role = if captures.get(1).is_some_and(|value| value.as_str() == "!") {
            ReferenceRole::Embed
        } else {
            ReferenceRole::Navigation
        };
        insert_extracted_reference(target, role, &newline_offsets, &mut found);
    }
    for captures in html.captures_iter(&searchable) {
        let (Some(attribute), Some(target)) = (captures.get(1), captures.get(2)) else {
            continue;
        };
        let role = if attribute.as_str().eq_ignore_ascii_case("src") {
            ReferenceRole::Embed
        } else {
            ReferenceRole::Navigation
        };
        insert_extracted_reference(target, role, &newline_offsets, &mut found);
    }

    Ok(found
        .into_keys()
        .map(|(line, target, role)| ExtractedReference { target, line, role })
        .collect())
}

pub(super) fn mask_fenced_code(content: &str) -> String {
    let mut bytes = content.as_bytes().to_vec();
    let mut fence: Option<(u8, usize)> = None;
    let mut line_start = 0;
    while line_start < bytes.len() {
        let line_end = bytes[line_start..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |offset| line_start + offset + 1);
        let content_end = bytes[line_start..line_end]
            .iter()
            .rposition(|byte| !matches!(*byte, b'\r' | b'\n'))
            .map_or(line_start, |offset| line_start + offset + 1);
        let line = &content.as_bytes()[line_start..content_end];
        let indent = line.iter().take_while(|byte| **byte == b' ').count();
        let candidate = if indent <= 3 { &line[indent..] } else { &[] };
        let marker = candidate
            .first()
            .copied()
            .filter(|byte| matches!(*byte, b'`' | b'~'));
        let run = marker.map_or(0, |marker| {
            candidate.iter().take_while(|byte| **byte == marker).count()
        });
        let is_fence_line = match fence {
            Some((open_marker, open_run)) => {
                marker == Some(open_marker)
                    && run >= open_run
                    && candidate[run..]
                        .iter()
                        .all(|byte| byte.is_ascii_whitespace())
            }
            None => run >= 3,
        };
        if fence.is_some() || is_fence_line {
            for byte in &mut bytes[line_start..content_end] {
                *byte = b' ';
            }
        }
        match (fence, is_fence_line, marker) {
            (None, true, Some(marker)) => fence = Some((marker, run)),
            (Some(_), true, _) => fence = None,
            _ => {}
        }
        line_start = line_end;
    }
    String::from_utf8(bytes).expect("mask preserves valid UTF-8")
}

fn insert_extracted_reference(
    target: regex::Match<'_>,
    role: ReferenceRole,
    newline_offsets: &[usize],
    found: &mut BTreeMap<(usize, String, ReferenceRole), ()>,
) {
    let line = newline_offsets.partition_point(|offset| *offset < target.start()) + 1;
    found.insert((line, target.as_str().trim().to_string(), role), ());
}

pub(super) fn resolve_reference(note_path: &str, target: &str) -> Option<String> {
    let target = target.trim().trim_matches('<').trim_matches('>');
    if target.is_empty()
        || target.starts_with('#')
        || target.starts_with("data:")
        || target.contains("://")
    {
        return None;
    }
    let target = target.split(['?', '#']).next()?;
    let decoded = percent_decode_str(target).decode_utf8().ok()?;
    let mut components = Vec::new();
    if !decoded.starts_with('/') {
        if let Some(parent) = Path::new(note_path).parent() {
            components.extend(parent.components());
        }
    }
    components.extend(Path::new(decoded.trim_start_matches('/')).components());
    normalize_components(components)
}

pub(super) struct RemoteLinkMetadata {
    pub(super) url: String,
    pub(super) canonical_key: String,
    pub(super) name: String,
    pub(super) extension: String,
    pub(super) domain: String,
    pub(super) link_kind: LinkKind,
}

fn parse_remote_url(target: &str) -> Option<Url> {
    let target = target.trim().trim_matches('<').trim_matches('>');
    let (_, authority_and_path) = target.split_once("://")?;
    if authority_and_path.starts_with('/') || authority_and_path.starts_with('\\') {
        return None;
    }
    let url = Url::parse(target).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url)
}

pub(super) fn remote_link_metadata(target: &str) -> Option<RemoteLinkMetadata> {
    let url = parse_remote_url(target)?;
    let domain = url.host_str()?.to_string();
    let name = remote_name_from_url(&url);
    let extension = extension(Path::new(&name));
    let link_kind = classify_remote_link_parts(&url, &extension);
    let mut canonical_url = url.clone();
    canonical_url.set_fragment(None);
    Some(RemoteLinkMetadata {
        url: url.into(),
        canonical_key: canonical_url.into(),
        name,
        extension,
        domain,
        link_kind,
    })
}

#[cfg(test)]
pub(super) fn remote_url(target: &str) -> Option<String> {
    parse_remote_url(target).map(Into::into)
}

#[cfg(test)]
pub(super) fn canonical_remote_key(url: &str) -> String {
    let Ok(mut parsed) = Url::parse(url) else {
        return url.to_string();
    };
    parsed.set_fragment(None);
    parsed.into()
}

fn remote_name_from_url(url: &Url) -> String {
    let encoded_name = url
        .path_segments()
        .and_then(|segments| segments.rev().find(|part| !part.is_empty()));
    encoded_name
        .and_then(|name| percent_decode_str(name).decode_utf8().ok())
        .map(|name| name.into_owned())
        .filter(|name| !name.is_empty())
        .or_else(|| url.host_str().map(str::to_string))
        .unwrap_or_default()
}

#[cfg(test)]
pub(super) fn remote_domain(url: &str) -> Option<String> {
    Url::parse(url).ok()?.host_str().map(str::to_string)
}

#[cfg(test)]
pub(super) fn classify_remote_link(url: &str) -> LinkKind {
    let Ok(parsed) = Url::parse(url) else {
        return LinkKind::Unknown;
    };
    let name = remote_name_from_url(&parsed);
    let extension = extension(Path::new(&name));
    classify_remote_link_parts(&parsed, &extension)
}

fn classify_remote_link_parts(url: &Url, extension: &str) -> LinkKind {
    if url.path().trim_matches('/').is_empty() {
        return LinkKind::Website;
    }
    match extension {
        "png" | "apng" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "svg" | "ico"
        | "tif" | "tiff" | "heic" | "heif" | "jxl" => LinkKind::Image,
        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" | "opus" => LinkKind::Audio,
        "mp4" | "webm" | "mov" | "m4v" | "avi" | "mkv" | "ogv" => LinkKind::Video,
        "html" | "htm" | "php" | "asp" | "aspx" | "jsp" => LinkKind::Website,
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" | "zst" | "pdf" | "doc" | "docx"
        | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp" | "epub" | "dmg" | "pkg"
        | "exe" | "msi" | "deb" | "rpm" | "apk" | "ipa" | "bin" | "iso" => LinkKind::Download,
        "" => LinkKind::Website,
        _ => LinkKind::Unknown,
    }
}
