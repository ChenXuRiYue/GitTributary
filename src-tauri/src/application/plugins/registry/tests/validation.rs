use std::fs;

use serde_json::{json, Value};

use super::super::backend_payload::github_repository_parts;
use super::super::manifest::{
    native_library_name, valid_extension_id, valid_version_segment, validate_lucide_icon,
};
use super::super::ExtensionRegistry;
use super::super::{validate_backend_exists, validate_manifest, ExtensionManifest};

#[test]
fn validates_extension_ids() {
    assert!(valid_extension_id("com.example.insights"));
    assert!(!valid_extension_id("Insights"));
    assert!(!valid_extension_id("insights"));
}

#[test]
fn validates_version_directory_segments() {
    assert!(valid_version_segment("1.2.3-beta_1"));
    assert!(!valid_version_segment(""));
    assert!(!valid_version_segment(".."));
    assert!(!valid_version_segment("1/../../escape"));
}

#[test]
fn validates_network_write_for_backend_methods() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("web")).unwrap();
    fs::write(directory.path().join("web/index.html"), "upload").unwrap();
    let manifest = |permissions: Value| -> ExtensionManifest {
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "apiVersion": "1",
            "id": "com.example.uploader",
            "name": "Uploader",
            "version": "1.0.0",
            "contributes": {
                "views": [{ "id": "main", "title": "Upload", "entry": "web/index.html" }]
            },
            "backend": {
                "runtime": "rust-cdylib",
                "entry": "backend",
                "library": "uploader",
                "methods": { "images.upload": ["network:write"] }
            },
            "permissions": permissions
        }))
        .unwrap()
    };

    assert!(validate_manifest(&manifest(json!(["network:write"])), directory.path()).is_ok());
    assert!(validate_manifest(&manifest(json!([])), directory.path()).is_err());
}

#[test]
fn parses_supported_github_remote_urls() {
    assert_eq!(
        github_repository_parts("https://github.com/octocat/images.git").unwrap(),
        ("octocat".to_string(), "images".to_string())
    );
    assert_eq!(
        github_repository_parts("HTTPS://GITHUB.COM/Team/image-cloud/").unwrap(),
        ("Team".to_string(), "image-cloud".to_string())
    );
    assert!(github_repository_parts("git@github.com:octocat/images.git").is_err());
    assert!(github_repository_parts("https://github.com/octocat/images/tree/main").is_err());
}

#[test]
fn validates_headless_flow_node_plugins() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("backend")).unwrap();
    fs::write(
        directory
            .path()
            .join("backend")
            .join(native_library_name("demo_plugin")),
        b"placeholder",
    )
    .unwrap();
    let manifest: ExtensionManifest = serde_json::from_value(json!({
        "schemaVersion": 1,
        "apiVersion": "1",
        "id": "com.example.demo",
        "name": "Demo",
        "version": "0.1.0",
        "contributes": {
            "flowNodes": [{
                "uses": "com.example.demo/scan@v1",
                "name": "Scan",
                "type": "scan",
                "summary": "Scan files",
                "inputs": { "root": "string" },
                "outputs": { "count": "number" },
                "method": "flow.scan"
            }]
        },
        "backend": {
            "runtime": "rust-cdylib",
            "entry": "backend",
            "library": "demo_plugin",
            "methods": { "flow.scan": ["files:read"] }
        },
        "permissions": ["files:read"]
    }))
    .unwrap();

    validate_manifest(&manifest, directory.path()).unwrap();
    validate_backend_exists(&manifest, directory.path()).unwrap();
    fs::write(
        directory.path().join("manifest.json"),
        serde_json::to_vec(&manifest_json()).unwrap(),
    )
    .unwrap();

    let registry = ExtensionRegistry::default();
    registry.register_path(directory.path()).unwrap();
    let first_binding = registry
        .flow_node_binding_snapshot("com.example.demo", "com.example.demo/scan@v1")
        .unwrap();
    let mut nodes = gt_flow::FlowNodeRegistry::new();
    registry.contribute_active_flow_nodes(&mut nodes).unwrap();
    assert!(nodes.get("com.example.demo/scan@v1").is_some());
    registry.register_path(directory.path()).unwrap();
    let reinstalled_binding = registry
        .flow_node_binding_snapshot("com.example.demo", "com.example.demo/scan@v1")
        .unwrap();
    assert_ne!(first_binding, reinstalled_binding);
}

fn manifest_json() -> Value {
    json!({
        "schemaVersion": 1,
        "apiVersion": "1",
        "id": "com.example.demo",
        "name": "Demo",
        "version": "0.1.0",
        "contributes": {
            "flowNodes": [{
                "uses": "com.example.demo/scan@v1",
                "name": "Scan",
                "type": "scan",
                "summary": "Scan files",
                "method": "flow.scan"
            }]
        },
        "backend": {
            "runtime": "rust-cdylib",
            "entry": "backend",
            "library": "demo_plugin",
            "methods": { "flow.scan": ["files:read"] }
        },
        "permissions": ["files:read"]
    })
}

#[test]
fn rejects_invalid_flow_node_bindings() {
    let directory = tempfile::tempdir().unwrap();
    let manifest = |uses: &str, method: &str| -> ExtensionManifest {
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "apiVersion": "1",
            "id": "com.example.demo",
            "name": "Demo",
            "version": "0.1.0",
            "contributes": { "flowNodes": [{
                "uses": uses,
                "name": "Scan",
                "type": "scan",
                "summary": "Scan files",
                "method": method
            }]},
            "backend": {
                "entry": "backend",
                "library": "demo_plugin",
                "methods": { "flow.scan": [] }
            }
        }))
        .unwrap()
    };
    assert!(validate_manifest(
        &manifest("gittributary/files/override@v1", "flow.scan"),
        directory.path()
    )
    .is_err());
    assert!(validate_manifest(
        &manifest("com.example.demo/scan@v1", "missing.method"),
        directory.path()
    )
    .is_err());
}

#[test]
fn validates_lucide_icon_tokens() {
    assert!(validate_lucide_icon("lucide:paperclip").is_ok());
    assert!(validate_lucide_icon("lucide:chart-no-axes").is_ok());
    assert!(validate_lucide_icon("paperclip").is_err());
    assert!(validate_lucide_icon("lucide:Paperclip").is_err());
    assert!(validate_lucide_icon("lucide:../paperclip").is_err());
}
