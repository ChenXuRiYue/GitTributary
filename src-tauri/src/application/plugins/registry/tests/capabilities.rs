use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use gt_files::replace_tree;
use gt_git::GitRepo;
use serde_json::json;

use super::super::backend_payload::enrich_backend_payload;
use super::super::host_methods::{
    extension_file_root, extension_source_directory, extension_store_namespace,
};
use super::super::path_update;
use super::super::state::InstalledExtension;
use super::super::{ExtensionManifest, ExtensionRegistry};
use super::app_state;

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

#[test]
fn injects_git_remote_token_only_for_the_attachment_backend() {
    let store_directory = tempfile::tempdir().unwrap();
    let repository = tempfile::tempdir().unwrap();
    let repo = GitRepo::init(repository.path()).unwrap();
    repo.add_remote("image-cloud", "https://github.com/octocat/images.git")
        .unwrap();
    let repo_path = repo.workdir().unwrap().to_string_lossy().to_string();
    let mut data = gt_data::DataHub::open(store_directory.path()).unwrap();
    data.credentials_mut()
        .set_project_token(&repo_path, "project-token")
        .unwrap();
    let state = app_state(data);
    let payload = json!({
        "config": {
            "remote": {
                "repoPath": repo_path,
                "name": "image-cloud",
                "url": "https://github.com/octocat/images.git"
            },
            "branch": "main",
            "directory": "images"
        }
    });

    let enriched = enrich_backend_payload(
        "dev.gittributary.attachment-manager",
        "attachments.migrateGithubImages",
        payload,
        &state,
    )
    .unwrap();
    assert_eq!(enriched["config"]["owner"], "octocat");
    assert_eq!(enriched["config"]["repository"], "images");
    assert_eq!(enriched["config"]["token"], "project-token");
}

#[test]
fn scopes_extension_store_namespaces() {
    let registry = ExtensionRegistry::default();
    let manifest: ExtensionManifest = serde_json::from_value(json!({
        "schemaVersion": 1,
        "id": "dev.gittributary.site-publisher",
        "name": "Site",
        "version": "1.0.0",
        "storeNamespaces": ["sites"]
    }))
    .unwrap();
    registry.installed.write().unwrap().insert(
        manifest.id.clone(),
        InstalledExtension {
            manifest,
            root: PathBuf::new(),
            generation: 1,
        },
    );
    assert_eq!(
        extension_store_namespace(
            &registry,
            "dev.gittributary.site-publisher",
            &json!({ "namespace": "sites" })
        )
        .unwrap(),
        "sites"
    );
    assert_eq!(
        extension_store_namespace(
            &registry,
            "com.example.demo",
            &json!({ "namespace": "plugin.com.example.demo.settings" })
        )
        .unwrap(),
        "plugin.com.example.demo.settings"
    );
    assert!(extension_store_namespace(
        &registry,
        "com.example.demo",
        &json!({ "namespace": "sites" })
    )
    .is_err());
}

#[test]
fn authorizes_only_known_file_roots() {
    let store_directory = tempfile::tempdir().unwrap();
    let repository = tempfile::tempdir().unwrap();
    let unknown = tempfile::tempdir().unwrap();
    let mut data = gt_data::DataHub::open(store_directory.path()).unwrap();
    data.workspace_mut().initialize().unwrap();
    let repository_path = repository.path().to_string_lossy().to_string();
    data.workspace_mut()
        .sync(Some(&repository_path), Some("main"))
        .unwrap();
    let state = app_state(data);

    let authorized = extension_file_root(&state, &json!({ "root": repository_path })).unwrap();
    assert_eq!(
        PathBuf::from(authorized),
        repository.path().canonicalize().unwrap()
    );
    assert!(
        extension_file_root(&state, &json!({ "root": unknown.path().to_string_lossy() })).is_err()
    );
}

#[test]
fn host_capabilities_replace_commit_and_push_a_path() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let target = temp.path().join("target");
    let remote = temp.path().join("remote.git");
    fs::create_dir_all(source.join("artifact")).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(source.join("artifact/index.html"), "<h1>Hello</h1>").unwrap();
    run_git(temp.path(), &["init", "--bare", remote.to_str().unwrap()]);
    run_git(&target, &["init", "-b", "main"]);
    fs::write(target.join("README.md"), "seed").unwrap();
    run_git(&target, &["add", "README.md"]);
    run_git(
        &target,
        &[
            "-c",
            "user.name=GitTributary Test",
            "-c",
            "user.email=test@local",
            "commit",
            "-m",
            "seed",
        ],
    );
    run_git(
        &target,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run_git(&target, &["push", "-u", "origin", "main"]);

    let mut data = gt_data::DataHub::open(&temp.path().join("store")).unwrap();
    data.workspace_mut().initialize().unwrap();
    data.workspace_mut()
        .sync(Some(&source.to_string_lossy()), Some("main"))
        .unwrap();
    data.workspace_mut()
        .bind_repo(&target.to_string_lossy())
        .unwrap();
    let state = app_state(data);
    let operation = json!({
        "repositoryPath": target,
        "branch": "main",
        "remoteName": "origin",
        "pathspec": "docs"
    });
    let prepared = path_update::prepare(&state, "test.plugin", &operation).unwrap();
    let operation_id = prepared["operationId"].as_str().unwrap();
    assert!(path_update::commit(
        &state,
        "test.plugin",
        &json!({
            "operationId": operation_id,
            "commitMessage": "must materialize first"
        })
    )
    .is_err());
    let bound = state
        .extensions
        .path_update("test.plugin", operation_id, false)
        .unwrap();
    let source_root =
        extension_source_directory(&state, &json!({ "sourceRoot": source.join("artifact") }))
            .unwrap();
    replace_tree(source_root, &bound.repository_path, &bound.pathspec).unwrap();
    state.extensions.mark_path_update_materialized(operation_id);
    let report = path_update::commit(
        &state,
        "test.plugin",
        &json!({
            "operationId": operation_id,
            "commitMessage": "publish artifact"
        }),
    )
    .unwrap();

    assert_eq!(report["pushed"], true);
    assert!(target.join("docs/index.html").is_file());
    run_git(&target, &["fetch", "origin", "main"]);
    let remote_head = Command::new("git")
        .args(["rev-parse", "origin/main"])
        .current_dir(&target)
        .output()
        .unwrap();
    let local_head = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&target)
        .output()
        .unwrap();
    assert_eq!(remote_head.stdout, local_head.stdout);
}
