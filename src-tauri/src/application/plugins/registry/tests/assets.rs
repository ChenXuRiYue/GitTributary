use std::fs;

use tauri::http::{Request, StatusCode};

use super::super::{asset_response, ExtensionRegistry};

#[test]
fn registers_manifest_and_serves_scoped_assets() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("web")).unwrap();
    fs::write(directory.path().join("web/index.html"), "<h1>demo</h1>").unwrap();
    fs::write(
        directory.path().join("manifest.json"),
        r#"{
          "schemaVersion": 1,
          "apiVersion": "1",
          "id": "com.example.demo",
          "name": "Demo",
          "version": "0.1.0",
          "icon": "lucide:paperclip",
          "contributes": {"views": [{
            "id": "main", "title": "Demo", "entry": "web/index.html"
          }]},
          "permissions": ["repository:read"]
        }"#,
    )
    .unwrap();

    let registry = ExtensionRegistry::default();
    registry.register_path(directory.path()).unwrap();
    let extensions = registry.list();
    let generation = extensions[0].generation;
    assert!(generation > 0);
    assert_eq!(
        registry.validate_generation("com.example.demo", generation),
        Ok(())
    );
    assert_eq!(
        registry.validate_generation("com.example.demo", generation + 1),
        Err("extension_generation_mismatch".to_string())
    );
    registry.register_path(directory.path()).unwrap();
    assert!(registry.list()[0].generation > generation);
    assert_eq!(
        extensions[0].views[0].icon_url.as_deref(),
        Some("lucide:paperclip")
    );

    let request = Request::builder()
        .uri("gt-plugin://localhost/com.example.demo/web/index.html")
        .body(Vec::new())
        .unwrap();
    let response = asset_response(&registry, &request);
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body(), b"<h1>demo</h1>");
    let csp = response
        .headers()
        .get("Content-Security-Policy")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(csp.contains("script-src 'self'"));
    assert!(csp.contains("connect-src 'none'"));
    assert!(!csp.contains("img-src 'self' data: https:"));
    assert!(!csp.contains("unsafe-eval"));
}

#[test]
fn network_permission_allows_remote_media_without_enabling_fetch() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("web")).unwrap();
    fs::write(directory.path().join("web/index.html"), "<h1>network</h1>").unwrap();
    fs::write(
        directory.path().join("manifest.json"),
        r#"{
          "schemaVersion": 1,
          "apiVersion": "1",
          "id": "com.example.network",
          "name": "Network",
          "version": "0.1.0",
          "contributes": {"views": [{
            "id": "main", "title": "Network", "entry": "web/index.html"
          }]},
          "permissions": ["network:read"]
        }"#,
    )
    .unwrap();

    let registry = ExtensionRegistry::default();
    registry.register_path(directory.path()).unwrap();
    let request = Request::builder()
        .uri("gt-plugin://localhost/com.example.network/web/index.html")
        .body(Vec::new())
        .unwrap();
    let response = asset_response(&registry, &request);
    let csp = response
        .headers()
        .get("Content-Security-Policy")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(csp.contains("img-src 'self' data: https: http:"));
    assert!(csp.contains("media-src 'self' data: https: http:"));
    assert!(csp.contains("connect-src 'none'"));
}
