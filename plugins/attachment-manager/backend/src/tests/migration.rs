use std::fs;

use crate::github::{
    github_branch_url, migrate_github_images_with, normalize_github_config, raw_github_url,
};
use crate::model::{GitHubMigrationRequest, LocalFilePolicy, MAX_NOTE_BYTES};

use super::github_config;

#[test]
fn migrates_uploaded_images_and_rewrites_supported_links() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("notes")).unwrap();
    fs::create_dir_all(directory.path().join("assets")).unwrap();
    fs::write(directory.path().join("assets/photo.png"), b"png-image").unwrap();
    fs::write(
        directory.path().join("notes/demo.md"),
        concat!(
            "![markdown](../assets/photo.png)\n",
            "[navigation](../assets/photo.png)\n",
            "![[../assets/photo.png|wiki]]\n",
            "<img src='../assets/photo.png'>\n",
            "```md\n",
            "![example](../assets/photo.png)\n",
            "```\n",
        ),
    )
    .unwrap();

    let request = GitHubMigrationRequest {
        repo_path: directory.path().to_string_lossy().to_string(),
        image_paths: vec!["assets/photo.png".to_string()],
        config: github_config(),
        local_file_policy: LocalFilePolicy::Keep,
    };
    let report = migrate_github_images_with(request, |config, image| {
        assert_eq!(config.token, "test-token");
        assert_eq!(image.bytes, b"png-image");
        assert!(image.remote_path.starts_with("notes/images/"));
        Ok(true)
    })
    .unwrap();

    assert_eq!(report.migrated.len(), 1);
    assert!(report.migrated[0].uploaded);
    assert_eq!(report.changed_notes, 1);
    assert_eq!(report.changed_note_paths, vec!["notes/demo.md"]);
    assert_eq!(report.replaced_references, 4);
    assert!(report.failed.is_empty());
    assert!(report.failed_notes.is_empty());
    assert!(report.failed_deletes.is_empty());
    assert!(report.deleted_local_paths.is_empty());
    let rewritten = fs::read_to_string(directory.path().join("notes/demo.md")).unwrap();
    assert_eq!(rewritten.matches(&report.migrated[0].url).count(), 4);
    assert!(rewritten.contains("![example](../assets/photo.png)"));
    assert!(directory.path().join("assets/photo.png").is_file());
}

#[test]
fn deletes_only_referenced_images_after_successful_rewrite() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("photo.png"), b"png-image").unwrap();
    fs::write(directory.path().join("note.md"), "![photo](photo.png)\n").unwrap();
    let request = GitHubMigrationRequest {
        repo_path: directory.path().to_string_lossy().to_string(),
        image_paths: vec!["photo.png".to_string()],
        config: github_config(),
        local_file_policy: LocalFilePolicy::DeleteAfterSuccess,
    };
    let report = migrate_github_images_with(request, |_, _| Ok(true)).unwrap();
    assert_eq!(report.deleted_local_paths, vec!["photo.png"]);
    assert!(report.failed_deletes.is_empty());
    assert!(!directory.path().join("photo.png").exists());
    assert!(fs::read_to_string(directory.path().join("note.md"))
        .unwrap()
        .contains("raw.githubusercontent.com"));
}

#[test]
fn keeps_local_images_when_any_markdown_write_is_not_safe() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("photo.png"), b"png-image").unwrap();
    let mut note = "![photo](photo.png)\n".to_string();
    note.push_str(&"x".repeat(MAX_NOTE_BYTES as usize));
    fs::write(directory.path().join("note.md"), note).unwrap();
    let request = GitHubMigrationRequest {
        repo_path: directory.path().to_string_lossy().to_string(),
        image_paths: vec!["photo.png".to_string()],
        config: github_config(),
        local_file_policy: LocalFilePolicy::DeleteAfterSuccess,
    };
    let report = migrate_github_images_with(request, |_, _| Ok(true)).unwrap();
    assert_eq!(report.failed_notes.len(), 1);
    assert_eq!(report.failed_deletes.len(), 1);
    assert_eq!(
        report.failed_deletes[0].error,
        "migration_delete_skipped_note_failures"
    );
    assert!(report.deleted_local_paths.is_empty());
    assert!(directory.path().join("photo.png").is_file());
}

#[test]
fn leaves_failed_image_references_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("photo.png"), b"png-image").unwrap();
    fs::write(directory.path().join("note.md"), "![photo](photo.png)\n").unwrap();
    let request = GitHubMigrationRequest {
        repo_path: directory.path().to_string_lossy().to_string(),
        image_paths: vec!["photo.png".to_string()],
        config: github_config(),
        local_file_policy: LocalFilePolicy::Keep,
    };
    let report =
        migrate_github_images_with(request, |_, _| Err("github_auth_failed".to_string())).unwrap();
    assert!(report.migrated.is_empty());
    assert_eq!(report.failed.len(), 1);
    assert_eq!(report.changed_notes, 0);
    assert_eq!(report.replaced_references, 0);
    assert_eq!(
        fs::read_to_string(directory.path().join("note.md")).unwrap(),
        "![photo](photo.png)\n"
    );
}

#[test]
fn reuses_one_remote_object_for_identical_images() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("first.png"), b"same-image").unwrap();
    fs::write(directory.path().join("second.png"), b"same-image").unwrap();
    fs::write(
        directory.path().join("note.md"),
        "![first](first.png)\n![second](second.png)\n",
    )
    .unwrap();
    let request = GitHubMigrationRequest {
        repo_path: directory.path().to_string_lossy().to_string(),
        image_paths: vec!["first.png".to_string(), "second.png".to_string()],
        config: github_config(),
        local_file_policy: LocalFilePolicy::Keep,
    };
    let mut upload_count = 0;
    let report = migrate_github_images_with(request, |_, _| {
        upload_count += 1;
        Ok(true)
    })
    .unwrap();
    assert_eq!(upload_count, 1);
    assert_eq!(report.migrated.len(), 2);
    assert_eq!(report.migrated[0].url, report.migrated[1].url);
    assert_eq!(report.replaced_references, 2);
}

#[test]
fn does_not_guess_ambiguous_image_names_during_rewrite() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir_all(directory.path().join("a")).unwrap();
    fs::create_dir_all(directory.path().join("b")).unwrap();
    fs::write(directory.path().join("a/photo.png"), b"first").unwrap();
    fs::write(directory.path().join("b/photo.png"), b"second").unwrap();
    fs::write(directory.path().join("note.md"), "![photo](photo.png)\n").unwrap();
    let request = GitHubMigrationRequest {
        repo_path: directory.path().to_string_lossy().to_string(),
        image_paths: vec!["a/photo.png".to_string()],
        config: github_config(),
        local_file_policy: LocalFilePolicy::Keep,
    };
    let report = migrate_github_images_with(request, |_, _| Ok(true)).unwrap();
    assert_eq!(report.migrated.len(), 1);
    assert_eq!(report.replaced_references, 0);
    assert_eq!(
        fs::read_to_string(directory.path().join("note.md")).unwrap(),
        "![photo](photo.png)\n"
    );
}

#[test]
fn validates_github_configuration_and_encodes_remote_paths() {
    let mut config = github_config();
    config.directory = " /image cloud/notes/ ".to_string();
    normalize_github_config(&mut config).unwrap();
    assert_eq!(config.directory, "image cloud/notes");
    assert_eq!(
        raw_github_url(&config, "image cloud/notes/photo.png").unwrap(),
        "https://raw.githubusercontent.com/example/images/main/image%20cloud/notes/photo.png"
    );

    config.branch = "feature/images".to_string();
    normalize_github_config(&mut config).unwrap();
    assert_eq!(
        github_branch_url(&config).unwrap().as_str(),
        "https://api.github.com/repos/example/images/branches/feature%2Fimages"
    );
    assert_eq!(
        raw_github_url(&config, "notes/photo.png").unwrap(),
        "https://raw.githubusercontent.com/example/images/feature/images/notes/photo.png"
    );
    for invalid in [
        "HEAD",
        "-draft",
        "/main",
        "main/",
        ".hidden",
        "release..next",
        "topic.lock",
        "bad branch",
    ] {
        config.branch = invalid.to_string();
        assert_eq!(
            normalize_github_config(&mut config).unwrap_err(),
            "github_branch_invalid",
            "{invalid}"
        );
    }
}
