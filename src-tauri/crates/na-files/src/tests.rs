use std::fs;

use super::*;

fn workspace() -> (tempfile::TempDir, FileWorkspace) {
    let temp = tempfile::tempdir().unwrap();
    fs::create_dir_all(temp.path().join("docs/nested")).unwrap();
    fs::write(temp.path().join("README.md"), "# Hello\nRust workspace").unwrap();
    fs::write(temp.path().join("docs/guide.md"), "Plugin architecture").unwrap();
    fs::write(temp.path().join("docs/nested/note.txt"), "hello from note").unwrap();
    fs::write(temp.path().join("image.bin"), [0xff, 0xfe]).unwrap();
    let files = FileWorkspace::open(temp.path()).unwrap();
    (temp, files)
}

#[test]
fn list_is_single_level_and_stably_sorted() {
    let (_temp, files) = workspace();
    let report = files.list("", ListOptions::default()).unwrap();
    let paths = report
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>();
    assert_eq!(paths, vec!["README.md", "docs", "image.bin"]);
    assert!(!report
        .entries
        .iter()
        .any(|entry| entry.path == "docs/guide.md"));
}

#[test]
fn scan_is_flat_depth_limited_and_sorted() {
    let (_temp, files) = workspace();
    let shallow = files
        .scan(
            "",
            ScanOptions {
                max_depth: 1,
                max_entries: 100,
                exclude: Vec::new(),
            },
        )
        .unwrap();
    assert!(!shallow
        .entries
        .iter()
        .any(|entry| entry.path == "docs/guide.md"));

    let deep = files.scan("", ScanOptions::default()).unwrap();
    let paths = deep
        .entries
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        paths,
        vec![
            "README.md",
            "docs",
            "docs/guide.md",
            "docs/nested",
            "docs/nested/note.txt",
            "image.bin"
        ]
    );
}

#[test]
fn scan_reports_entry_limit() {
    let (_temp, files) = workspace();
    let report = files
        .scan(
            "",
            ScanOptions {
                max_depth: 32,
                max_entries: 2,
                exclude: Vec::new(),
            },
        )
        .unwrap();
    assert_eq!(report.entries.len(), 2);
    assert!(report.truncated);
}

#[test]
fn search_matches_file_names_and_text_and_skips_binary_files() {
    let (_temp, files) = workspace();
    let by_name = files.search("", "guide", SearchOptions::default()).unwrap();
    assert_eq!(by_name.matches.len(), 1);
    assert!(by_name.matches[0].name_matches);

    let by_text = files.search("", "HELLO", SearchOptions::default()).unwrap();
    let paths = by_text
        .matches
        .iter()
        .map(|item| item.entry.path.as_str())
        .collect::<Vec<_>>();
    assert_eq!(paths, vec!["README.md", "docs/nested/note.txt"]);
    assert!(by_text.matches.iter().all(|item| item.content_matches));
}

#[test]
fn scan_excludes_root_relative_subtrees() {
    let (_temp, files) = workspace();
    let report = files
        .scan(
            "",
            ScanOptions {
                exclude: vec!["docs/nested".to_string()],
                ..ScanOptions::default()
            },
        )
        .unwrap();
    assert!(report
        .entries
        .iter()
        .any(|entry| entry.path == "docs/guide.md"));
    assert!(!report
        .entries
        .iter()
        .any(|entry| entry.path.starts_with("docs/nested")));
}

#[test]
fn read_text_enforces_byte_limit_without_breaking_utf8() {
    let (temp, files) = workspace();
    fs::write(temp.path().join("unicode.txt"), "中英文").unwrap();
    let text = files.read_text("unicode.txt", 4).unwrap();
    assert_eq!(text.content, "中");
    assert!(text.truncated);
}

#[test]
fn rejects_unsafe_relative_paths() {
    let (_temp, files) = workspace();
    for path in [
        "/tmp",
        "../README.md",
        "./README.md",
        "docs/./guide.md",
        "docs/../README.md",
        "docs\\guide.md",
    ] {
        assert!(matches!(
            files.read_text(path, 100),
            Err(FileError::InvalidRelativePath(_))
        ));
    }
}

#[cfg(unix)]
#[test]
fn lists_but_never_follows_symbolic_links() {
    use std::os::unix::fs::symlink;

    let (temp, files) = workspace();
    symlink(temp.path().join("docs"), temp.path().join("linked-docs")).unwrap();
    let scan = files.scan("", ScanOptions::default()).unwrap();
    let link = scan
        .entries
        .iter()
        .find(|entry| entry.path == "linked-docs")
        .unwrap();
    assert_eq!(link.kind, FileKind::SymbolicLink);
    assert!(!scan
        .entries
        .iter()
        .any(|entry| entry.path.starts_with("linked-docs/")));
    assert!(matches!(
        files.list("linked-docs", ListOptions::default()),
        Err(FileError::SymbolicLink(_))
    ));
}

#[test]
fn serializes_public_types_with_camel_case_fields() {
    let options = SearchOptions::default();
    let value = serde_json::to_value(options).unwrap();
    assert!(value.get("maxDepth").is_some());
    assert!(value.get("maxResults").is_some());
    assert!(value.get("maxFileBytes").is_some());
}

#[test]
fn replaces_a_target_subtree_without_touching_siblings() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    fs::create_dir_all(source.path().join("assets")).unwrap();
    fs::write(source.path().join("index.html"), "new").unwrap();
    fs::write(source.path().join("assets/app.css"), "body{}").unwrap();
    fs::create_dir_all(target.path().join("docs")).unwrap();
    fs::write(target.path().join("docs/stale.html"), "old").unwrap();
    fs::write(target.path().join("README.md"), "keep").unwrap();

    let report = replace_tree(source.path(), target.path(), "docs").unwrap();

    assert_eq!(report.copied_file_count, 2);
    assert!(target.path().join("docs/index.html").is_file());
    assert!(!target.path().join("docs/stale.html").exists());
    assert!(target.path().join("README.md").is_file());
}

#[test]
fn replace_tree_rejects_unsafe_targets() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    fs::write(source.path().join("index.html"), "new").unwrap();
    assert!(replace_tree(source.path(), target.path(), "../outside").is_err());
    assert!(replace_tree(source.path(), target.path(), "/tmp/outside").is_err());

    fs::create_dir_all(source.path().join(".git")).unwrap();
    fs::write(source.path().join(".git/config"), "danger").unwrap();
    assert!(replace_tree(source.path(), target.path(), ".").is_err());
    assert!(!target.path().join(".git").exists());
}

#[cfg(unix)]
#[test]
fn replace_tree_rejects_symlinks_in_source_and_target_paths() {
    use std::os::unix::fs::symlink;

    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(source.path().join("index.html"), "new").unwrap();
    symlink(outside.path(), target.path().join("docs")).unwrap();
    assert!(replace_tree(source.path(), target.path(), "docs/site").is_err());

    fs::remove_file(target.path().join("docs")).unwrap();
    symlink(outside.path(), source.path().join("linked")).unwrap();
    assert!(replace_tree(source.path(), target.path(), "docs").is_err());
    assert!(!target.path().join("docs").exists());
}
