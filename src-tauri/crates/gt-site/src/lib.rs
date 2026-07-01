mod builder;
mod publish;
mod renderer;
mod scan;
mod types;
mod utils;

pub use builder::build_site;
pub use publish::{plan_publish_target, prepare_publish_output};
pub use scan::scan_repo;
pub use types::{BrokenLink, SiteBuildConfig, SiteBuildReport, SiteBuildWarning, SiteError, SiteIgnoredPath, SitePathCandidate, SitePathKind, SitePublishOutput, SitePublishTargetPlan, SiteScanReport};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publish::{normalize_publish_dir, publish_dir_display};
    use std::fs;

    #[test]
    fn scan_finds_doc_candidates() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "# Hello").unwrap();
        fs::create_dir_all(tmp.path().join("doc")).unwrap();
        fs::write(tmp.path().join("doc/a.md"), "# A").unwrap();
        fs::write(tmp.path().join("doc/b.md"), "# B").unwrap();
        let report = scan_repo(tmp.path()).unwrap();
        assert_eq!(report.markdown_count, 3);
        assert!(report
            .candidates
            .iter()
            .any(|item| item.path == "README.md"));
        assert!(report.candidates.iter().any(|item| item.path == "doc"));
    }

    #[test]
    fn scan_candidates_follow_filesystem_order() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "# Hello").unwrap();
        fs::create_dir_all(tmp.path().join("doc")).unwrap();
        fs::write(tmp.path().join("doc/a.md"), "# A").unwrap();
        fs::create_dir_all(tmp.path().join("docs")).unwrap();
        fs::write(tmp.path().join("docs/a.md"), "# A").unwrap();
        fs::write(tmp.path().join("docs/b.md"), "# B").unwrap();
        fs::write(tmp.path().join("docs/c.md"), "# C").unwrap();
        fs::create_dir_all(tmp.path().join("notes")).unwrap();
        fs::write(tmp.path().join("notes/1.md"), "# 1").unwrap();
        fs::write(tmp.path().join("notes/2.md"), "# 2").unwrap();
        fs::write(tmp.path().join("notes/10.md"), "# 10").unwrap();

        let report = scan_repo(tmp.path()).unwrap();
        let paths = report
            .candidates
            .iter()
            .map(|item| item.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["doc", "docs", "notes", "README.md"]);
    }

    #[test]
    fn build_generates_index_and_page() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("README.md"),
            "# Hello\n\nSee [Doc](doc/a.md).",
        )
        .unwrap();
        fs::create_dir_all(tmp.path().join("doc")).unwrap();
        fs::write(tmp.path().join("doc/a.md"), "# A\n\nText").unwrap();
        let output = tmp.path().join("site");
        let report = build_site(SiteBuildConfig {
            repo_path: tmp.path().to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
            site_title: "Test".to_string(),
            include: vec!["README.md".to_string(), "doc".to_string()],
            exclude: Vec::new(),
            theme: "typora-light".to_string(),
            with_search: true,
            copy_assets: true,
        })
        .unwrap();
        assert_eq!(report.page_count, 2);
        assert!(output.join("index.html").exists());
        assert!(output.join("pages/README.html").exists());
        assert!(output.join("pages/doc/a.html").exists());
    }

    #[test]
    fn build_renders_folder_tree_nav() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "# Hello").unwrap();
        fs::create_dir_all(tmp.path().join("doc/Git")).unwrap();
        fs::write(tmp.path().join("doc/Git/a.md"), "# A").unwrap();
        let output = tmp.path().join("site");

        build_site(SiteBuildConfig {
            repo_path: tmp.path().to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
            site_title: "Test".to_string(),
            include: vec!["README.md".to_string(), "doc".to_string()],
            exclude: Vec::new(),
            theme: "typora-light".to_string(),
            with_search: true,
            copy_assets: true,
        })
        .unwrap();

        let index = fs::read_to_string(output.join("index.html")).unwrap();
        assert!(index.contains(r#"<details class="nav-dir""#));
        assert!(index.contains(r#"<summary title="doc""#));
        assert!(index.contains(r#"data-icon-set="lucide""#));
        assert!(index.contains(r#"nav-file-icon--markdown"#));
        assert!(index.contains(r#"<span class="nav-label">README.md</span>"#));
    }

    #[test]
    fn build_renders_basic_markdown_formatting() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("README.md"),
            "# Hello\n\n---\n\n**为什么需要：** 让页面像 Typora。\n\n普通 *强调* 和 ~~删除~~。",
        )
        .unwrap();
        let output = tmp.path().join("site");

        build_site(SiteBuildConfig {
            repo_path: tmp.path().to_string_lossy().to_string(),
            output_dir: output.to_string_lossy().to_string(),
            site_title: "Test".to_string(),
            include: vec!["README.md".to_string()],
            exclude: Vec::new(),
            theme: "typora-light".to_string(),
            with_search: true,
            copy_assets: true,
        })
        .unwrap();

        let page = fs::read_to_string(output.join("pages/README.html")).unwrap();
        assert!(page.contains("<hr>"));
        assert!(page.contains("<strong>为什么需要：</strong>"));
        assert!(page.contains("<em>强调</em>"));
        assert!(page.contains("<del>删除</del>"));
    }

    #[test]
    fn publish_dir_normalization_is_repo_relative() {
        assert_eq!(publish_dir_display(&normalize_publish_dir("/").unwrap()), "/");
        assert_eq!(publish_dir_display(&normalize_publish_dir("docs").unwrap()), "docs");
        assert_eq!(publish_dir_display(&normalize_publish_dir("/docs/site").unwrap()), "docs/site");
    }

    #[test]
    fn publish_dir_rejects_unsafe_paths() {
        assert!(normalize_publish_dir("../docs").is_err());
        assert!(normalize_publish_dir("docs/../site").is_err());
        assert!(normalize_publish_dir(".git").is_err());
        assert!(normalize_publish_dir("docs/.git").is_err());
    }
}
