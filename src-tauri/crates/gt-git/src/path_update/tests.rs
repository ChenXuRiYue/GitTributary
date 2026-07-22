use super::*;

#[test]
fn normalize_git_name_accepts_plain_names() {
    assert_eq!(normalize_git_name(" feature ", "分支").unwrap(), "feature");
    assert_eq!(normalize_git_name("origin", "远程").unwrap(), "origin");
}

#[test]
fn normalize_git_name_rejects_unsafe_names() {
    assert!(normalize_git_name("", "分支").is_err());
    assert!(normalize_git_name("-bad", "分支").is_err());
    assert!(normalize_git_name("bad branch", "分支").is_err());
    assert!(normalize_git_name("bad\nbranch", "分支").is_err());
}

#[test]
fn pathspec_rejects_absolute_and_parent_paths() {
    assert!(validate_pathspec("docs").is_ok());
    assert!(validate_pathspec(".").is_ok());
    assert!(validate_pathspec("../docs").is_err());
    assert!(validate_pathspec("/tmp/docs").is_err());
    assert!(validate_pathspec("docs\\site").is_err());
    assert!(validate_pathspec(":(top)docs").is_err());
    assert!(validate_pathspec("docs/**").is_err());
}

#[test]
fn clean_except_allows_changes_inside_pathspec() {
    let dir = tempfile::tempdir().unwrap();
    run_git(dir.path(), &["init"]).unwrap();
    std::fs::create_dir_all(dir.path().join("site/assets")).unwrap();
    std::fs::write(dir.path().join("site/index.html"), "hello").unwrap();
    std::fs::write(dir.path().join("site/assets/app.css"), "body{}").unwrap();

    ensure_clean_repo_except(dir.path(), "site").unwrap();
}

#[test]
fn clean_except_rejects_changes_outside_pathspec() {
    let dir = tempfile::tempdir().unwrap();
    run_git(dir.path(), &["init"]).unwrap();
    std::fs::create_dir_all(dir.path().join("site")).unwrap();
    std::fs::write(dir.path().join("site/index.html"), "hello").unwrap();
    std::fs::write(dir.path().join("README.md"), "outside").unwrap();

    let err = ensure_clean_repo_except(dir.path(), "site").unwrap_err();
    assert!(err.to_string().contains("允许路径之外"));
}

#[test]
fn path_commit_uses_explicit_identity() {
    let dir = tempfile::tempdir().unwrap();
    run_git(dir.path(), &["init"]).unwrap();
    run_git(dir.path(), &["config", "user.name", "Repo Config"]).unwrap();
    run_git(dir.path(), &["config", "user.email", "repo@example.com"]).unwrap();
    std::fs::write(dir.path().join("index.html"), "hello").unwrap();
    run_git(dir.path(), &["add", "index.html"]).unwrap();

    run_git_commit(
        dir.path(),
        "test: path update explicit identity",
        ".",
        &CommitIdentity {
            name: "Remote Config".to_string(),
            email: "remote@example.com".to_string(),
        },
    )
    .unwrap();

    let author = run_git(dir.path(), &["log", "-1", "--format=%an <%ae>"]).unwrap();
    assert_eq!(author.trim(), "Remote Config <remote@example.com>");
}
