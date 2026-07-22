use std::fs;
use std::path::Path;

use tauri::http::{header, Request, Response, StatusCode};

use super::state::ExtensionRegistry;

pub fn asset_response(
    registry: &ExtensionRegistry,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let segments = request
        .uri()
        .path()
        .trim_start_matches('/')
        .splitn(2, '/')
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        return text_response(StatusCode::BAD_REQUEST, "invalid extension asset path");
    }
    let content_security_policy = if registry.has_permission(segments[0], "network:read") {
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self' data: https: http:; object-src 'self' data:; connect-src 'none'; frame-ancestors *"
    } else {
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; object-src 'self' data:; connect-src 'none'; frame-ancestors *"
    };
    let path = match registry.resolve_asset(segments[0], segments[1]) {
        Ok(path) => path,
        Err(error) => return text_response(StatusCode::NOT_FOUND, &error),
    };
    match fs::read(&path) {
        Ok(body) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type(&path))
            .header("Content-Security-Policy", content_security_policy)
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap(),
        Err(_) => text_response(StatusCode::NOT_FOUND, "extension asset not found"),
    }
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}
