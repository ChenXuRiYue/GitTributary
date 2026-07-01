use std::env;
use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use gt_git::{
    clone_remote_repo, commit_pages_git, prepare_pages_git, AuthMethod, CommitIdentity,
    PagesCommitGitOptions, PagesPrepareGitOptions,
};
use gt_site::{prepare_publish_output, SiteBuildConfig};

const TARGET_REPO_URL: &str = "https://github.com/ChenXuRiYue/ChenXuRiYue.github.io.git";
const TARGET_BRANCH: &str = "main";
const TARGET_REMOTE: &str = "origin";
const DEFAULT_PUBLISH_DIR: &str = "gittributary-e2e";

#[test]
#[ignore = "requires GitHub write token and pushes to ChenXuRiYue.github.io"]
fn publishes_static_site_to_chenxuriyue_github_io() {
    let token = env::var("GT_PAGES_E2E_TOKEN")
        .or_else(|_| env::var("GITHUB_TOKEN"))
        .expect("set GT_PAGES_E2E_TOKEN or GITHUB_TOKEN with write access to ChenXuRiYue.github.io");
    let publish_dir =
        env::var("GT_PAGES_E2E_PUBLISH_DIR").unwrap_or_else(|_| DEFAULT_PUBLISH_DIR.to_string());
    let auth = AuthMethod::Token(token);
    let tmp = tempfile::tempdir().unwrap();

    let source_repo = tmp.path().join("source");
    fs::create_dir_all(&source_repo).unwrap();
    run_git(&source_repo, &["init"]);
    fs::write(
        source_repo.join("README.md"),
        format!(
            "# GitTributary Pages E2E\n\nPublished by integration test.\n\nMarker: {}\n",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_secs()
        ),
    )
    .unwrap();
    run_git(&source_repo, &["add", "README.md"]);
    run_git(
        &source_repo,
        &[
            "-c",
            "user.name=GitTributary",
            "-c",
            "user.email=gittributary@local",
            "commit",
            "-m",
            "test: seed site source",
        ],
    );

    let target_parent = tmp.path().join("target");
    fs::create_dir_all(&target_parent).unwrap();
    let target_repo = clone_remote_repo(TARGET_REPO_URL, target_parent.join("pages"), &auth)
        .expect("clone target Pages repo");

    let target_root = target_repo.workdir().expect("target repo workdir").to_path_buf();
    let build_config = SiteBuildConfig {
        repo_path: source_repo.to_string_lossy().to_string(),
        output_dir: source_repo
            .join(".gittributary")
            .join("site")
            .to_string_lossy()
            .to_string(),
        site_title: "GitTributary Pages E2E".to_string(),
        include: vec!["README.md".to_string()],
        exclude: Vec::new(),
        theme: "typora-light".to_string(),
        with_search: true,
        copy_assets: true,
    };

    prepare_pages_git(PagesPrepareGitOptions {
        target_local_path: target_root.clone(),
        branch: TARGET_BRANCH.to_string(),
        remote_name: TARGET_REMOTE.to_string(),
        allowed_dirty_pathspec: Some(publish_dir.clone()),
        auth: auth.clone(),
    })
    .expect("prepare target Pages branch");

    let prepared = prepare_publish_output(
        build_config,
        &target_root,
        &publish_dir,
        "https://chenxuriyue.github.io/gittributary-e2e/",
        "test: publish GitTributary Pages e2e",
    )
    .expect("build and copy static site");

    let report = commit_pages_git(PagesCommitGitOptions {
        target_local_path: target_root,
        branch: TARGET_BRANCH.to_string(),
        remote_name: TARGET_REMOTE.to_string(),
        publish_pathspec: prepared.publish_pathspec,
        commit_message: prepared.commit_message,
        commit_identity: CommitIdentity {
            name: "GitTributary".to_string(),
            email: "gittributary@local".to_string(),
        },
        auth,
    })
    .expect("commit and push Pages site");

    assert!(report.pushed);
}

fn run_git(dir: &std::path::Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap_or_else(|err| panic!("failed to run git {}: {err}", args.join(" ")));
    if !output.status.success() {
        panic!(
            "git {} failed\nstdout:\n{}\nstderr:\n{}",
            args.join(" "),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
