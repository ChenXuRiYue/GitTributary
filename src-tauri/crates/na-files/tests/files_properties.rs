use std::fs;

use na_files::{FileWorkspace, ListOptions, ScanOptions};
use proptest::prelude::*;

fn safe_segment() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9_-]{1,16}".prop_filter("reserved dot paths are not safe segments", |value| {
        value != "." && value != ".."
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn arbitrary_safe_nested_utf8_files_round_trip(
        segments in prop::collection::vec(safe_segment(), 1..6),
        contents in ".{0,4096}",
    ) {
        let temp = tempfile::tempdir().unwrap();
        let relative = format!("{}.txt", segments.join("/"));
        let absolute = temp.path().join(&relative);
        fs::create_dir_all(absolute.parent().unwrap()).unwrap();
        fs::write(&absolute, contents.as_bytes()).unwrap();
        let workspace = FileWorkspace::open(temp.path()).unwrap();

        let read = workspace.read_text(&relative, contents.len().saturating_add(1)).unwrap();
        prop_assert_eq!(read.content, contents);
        prop_assert!(!read.truncated);
    }

    #[test]
    fn scan_results_are_stably_sorted_and_unique(
        names in prop::collection::btree_set(safe_segment(), 0..64),
    ) {
        let temp = tempfile::tempdir().unwrap();
        for name in &names {
            fs::write(temp.path().join(format!("{name}.txt")), name).unwrap();
        }
        let workspace = FileWorkspace::open(temp.path()).unwrap();
        let report = workspace.scan("", ScanOptions::default()).unwrap();
        let paths = report.entries.into_iter().map(|entry| entry.path).collect::<Vec<_>>();
        let mut expected = paths.clone();
        expected.sort();
        expected.dedup();
        prop_assert_eq!(paths, expected);
    }
}

#[test]
fn every_public_operation_rejects_parent_traversal() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = FileWorkspace::open(temp.path()).unwrap();

    for unsafe_path in [
        "..",
        "../secret",
        "a/../../secret",
        "/absolute",
        "./../secret",
    ] {
        assert!(workspace.list(unsafe_path, ListOptions::default()).is_err());
        assert!(workspace.scan(unsafe_path, ScanOptions::default()).is_err());
        assert!(workspace.read_text(unsafe_path, 1024).is_err());
    }
}
