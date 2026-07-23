use std::fs;
use std::io::Write;
use std::path::Path;

use super::filesystem::{copy_file_checked, copy_tree_checked, CopyLimits, MAX_PLUGIN_BYTES};
use super::{ensure_install_version_allowed, plugin_catalog_root_for_mode, plugin_source};

#[test]
fn rejects_symlinks_while_copying_plugin_payload() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source");
    let target = directory.path().join("target");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("real.js"), "ok").unwrap();

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source.join("real.js"), source.join("link.js")).unwrap();
        let error = copy_tree_checked(&source, &target, &mut CopyLimits::default()).unwrap_err();
        assert_eq!(error, "plugin_source_contains_symlink");
    }
}

#[test]
fn enforces_total_copy_size() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("large.bin");
    let mut file = fs::File::create(&source).unwrap();
    file.write_all(b"large").unwrap();
    let mut limits = CopyLimits {
        files: 0,
        bytes: MAX_PLUGIN_BYTES,
    };
    assert_eq!(
        copy_file_checked(&source, &directory.path().join("copy.bin"), &mut limits).unwrap_err(),
        "plugin_package_too_large"
    );
}

#[test]
fn resolves_debug_catalog_from_project_root() {
    let catalog = plugin_catalog_root_for_mode(
        true,
        Path::new("/workspace/NoteAura/src-tauri"),
        Some(Path::new("/ignored/resources")),
    )
    .unwrap();
    assert_eq!(catalog, Path::new("/workspace/NoteAura/plugins"));
}

#[test]
fn resolves_release_catalog_from_resource_directory() {
    let catalog = plugin_catalog_root_for_mode(
        false,
        Path::new("/ignored/src-tauri"),
        Some(Path::new("/Applications/NoteAura/Resources")),
    )
    .unwrap();
    assert_eq!(
        catalog,
        Path::new("/Applications/NoteAura/Resources/plugins")
    );
}

#[test]
fn allows_upgrade_and_same_version_reinstall_but_rejects_downgrade() {
    assert!(ensure_install_version_allowed("0.1.3", None).is_ok());
    assert!(ensure_install_version_allowed("0.1.3", Some("0.1.2")).is_ok());
    assert!(ensure_install_version_allowed("0.1.3", Some("0.1.3")).is_ok());
    assert_eq!(
        ensure_install_version_allowed("0.1.2", Some("0.1.3")).unwrap_err(),
        "plugin_downgrade_denied"
    );
    assert_eq!(
        ensure_install_version_allowed("1.0.0-beta.1", Some("1.0.0")).unwrap_err(),
        "plugin_downgrade_denied"
    );
}

#[test]
fn discovers_site_publisher_from_project_plugins() {
    let root =
        plugin_catalog_root_for_mode(true, Path::new(env!("CARGO_MANIFEST_DIR")), None).unwrap();
    let (_, manifest) = plugin_source(&root, "dev.noteaura.site-publisher").unwrap();
    assert!(manifest.store_namespaces.contains(&"sites".to_string()));
    assert!(!manifest.store_namespaces.contains(&"ui-state".to_string()));
}
