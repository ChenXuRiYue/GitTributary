use std::path::Path;

use crate::types::{AssetContext, SiteBuildWarning};
use crate::utils::path_to_slash;

pub(crate) fn relative_url(from_file: &str, target: &str) -> String {
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

pub(crate) fn split_anchor(url: &str) -> (&str, Option<&str>) {
    if let Some(index) = url.find('#') {
        (&url[..index], Some(&url[index..]))
    } else {
        (url, None)
    }
}

pub(crate) fn is_external_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
        || lower.starts_with("data:")
}

pub(crate) fn safe_href(url: &str, source: &str, assets: &mut AssetContext) -> String {
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

pub(crate) fn sanitize_file_name(value: &str) -> String {
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

pub(crate) fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub(crate) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(crate) fn escape_attr(value: &str) -> String {
    escape_html(value).replace('"', "&quot;")
}
