use serde_json::json;
use site_publisher_plugin::handle_request;
use std::fs;

#[test]
fn prepares_a_publish_artifact_without_git_access() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let target = temp.path().join("target");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(source.join("README.md"), "# Local publish\n").unwrap();

    let payload = json!({
        "request": {
            "buildConfig": {
                "repoPath": source,
                "outputDir": source.join(".noteaura/site"),
                "siteTitle": "Local publish",
                "include": ["README.md"],
                "exclude": [],
                "theme": "typora-light",
                "withSearch": true,
                "copyAssets": true
            },
            "target": {
                "targetLocalPath": target,
                "targetBranch": "main",
                "publishDir": "docs",
                "remoteName": "origin",
                "pagesUrl": "https://example.invalid/docs/",
                "autoCommitMessage": "test: publish local site"
            }
        }
    });
    let plan = handle_request("site.publish.plan", payload.clone()).unwrap();
    let artifact = handle_request("site.publish.materialize", payload).unwrap();

    assert_eq!(plan["publishPathspec"], "docs");
    assert!(artifact["artifactPath"].as_str().is_some());
    assert!(source.join(".noteaura/site/index.html").is_file());
    assert!(!target.join("docs").exists());
}
