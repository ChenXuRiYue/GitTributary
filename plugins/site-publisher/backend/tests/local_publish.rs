use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::json;
use site_publisher_plugin::handle_request;

#[test]
fn publishes_to_a_local_git_remote() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let target = temp.path().join("target");
    let remote = temp.path().join("pages.git");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(source.join("README.md"), "# Local publish\n").unwrap();

    run_git(temp.path(), &["init", "--bare", remote.to_str().unwrap()]);
    run_git(&target, &["init", "-b", "main"]);
    fs::write(target.join("README.md"), "# Seed\n").unwrap();
    run_git(&target, &["add", "README.md"]);
    run_git(
        &target,
        &[
            "-c",
            "user.name=GitTributary Test",
            "-c",
            "user.email=gittributary-test@local",
            "commit",
            "-m",
            "test: seed target",
        ],
    );
    run_git(
        &target,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run_git(&target, &["push", "-u", "origin", "main"]);

    let response = handle_request(
        "site.publish",
        json!({
            "request": {
                "buildConfig": {
                    "repoPath": source,
                    "outputDir": source.join(".gittributary/site"),
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
            },
            "gitContext": {
                "targetRoot": target.canonicalize().unwrap(),
                "remoteName": "origin",
                "remoteUrl": remote.to_string_lossy(),
                "auth": { "kind": "none" },
                "mode": "system",
                "credentialRef": null,
                "commitIdentity": {
                    "name": "GitTributary Test",
                    "email": "gittributary-test@local"
                }
            }
        }),
    )
    .unwrap();

    assert_eq!(response["pushed"], true);
    assert!(target.join("docs/index.html").is_file());
    assert!(response["commit"].is_string());
}

fn run_git(directory: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(directory)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}
