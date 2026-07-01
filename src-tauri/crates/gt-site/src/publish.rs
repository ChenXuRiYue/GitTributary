use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

use crate::builder::build_site;
use crate::types::{Result, SiteBuildConfig, SiteError, SitePublishOutput, SitePublishTargetPlan};
use crate::utils::{canonical_repo, normalize_output_dir, path_to_slash};

pub fn prepare_publish_output(
    build_config: SiteBuildConfig,
    target_repo: impl AsRef<Path>,
    publish_dir: &str,
    pages_url: &str,
    commit_message: &str,
) -> Result<SitePublishOutput> {
    let started = Instant::now();
    let mut build_config = build_config;
    let target_plan = plan_publish_target(&build_config, target_repo, publish_dir)?;
    build_config.repo_path = target_plan.source_repo_path.clone();

    let build = build_site(build_config)?;
    let build_output = canonical_existing_dir(Path::new(&build.output_dir), "构建产物")?;
    let index_html = Path::new(&build.index_html);
    if !index_html.exists() {
        return Err(SiteError::MissingIndexHtml(build.index_html.clone()));
    }
    let publish_path = PathBuf::from(&target_plan.publish_path);
    ensure_publish_paths_do_not_overlap(&build_output, &publish_path)?;

    let preserve_git = target_plan.publish_pathspec == ".";
    clear_publish_dir(&publish_path, preserve_git)?;
    let copied_file_count = copy_site_output(&build_output, &publish_path)?;
    fs::write(publish_path.join(".nojekyll"), "")?;

    Ok(SitePublishOutput {
        build,
        source_repo_path: target_plan.source_repo_path,
        target_repo_path: target_plan.target_repo_path,
        publish_dir: target_plan.publish_dir,
        publish_path: target_plan.publish_path,
        publish_pathspec: target_plan.publish_pathspec,
        pages_url: pages_url.trim().to_string(),
        commit_message: default_commit_message(commit_message),
        copied_file_count,
        duration_ms: started.elapsed().as_millis(),
    })
}

pub fn plan_publish_target(
    build_config: &SiteBuildConfig,
    target_repo: impl AsRef<Path>,
    publish_dir: &str,
) -> Result<SitePublishTargetPlan> {
    let source_repo = canonical_repo(Path::new(&build_config.repo_path))?;
    let target_root = canonical_existing_dir(target_repo.as_ref(), "发布仓库")?;
    if source_repo == target_root
        || source_repo.starts_with(&target_root)
        || target_root.starts_with(&source_repo)
    {
        return Err(SiteError::PublishRepoSameAsSource(
            target_root.to_string_lossy().to_string(),
        ));
    }

    let publish_rel = normalize_publish_dir(publish_dir)?;
    let publish_path = target_root.join(&publish_rel);
    let planned_build_output = normalize_output_dir(&source_repo, &build_config.output_dir)?;
    ensure_build_output_is_publish_safe(&planned_build_output, &target_root, &publish_path)?;

    Ok(SitePublishTargetPlan {
        source_repo_path: source_repo.to_string_lossy().to_string(),
        target_repo_path: target_root.to_string_lossy().to_string(),
        publish_dir: publish_dir_display(&publish_rel),
        publish_path: publish_path.to_string_lossy().to_string(),
        publish_pathspec: publish_pathspec(&publish_rel),
    })
}

fn canonical_existing_dir(path: &Path, label: &str) -> Result<PathBuf> {
    if !path.exists() {
        return Err(SiteError::UnsafePublishDir(format!(
            "{label}不存在: {}",
            path.display()
        )));
    }
    let path = path.canonicalize()?;
    if !path.is_dir() {
        return Err(SiteError::UnsafePublishDir(format!(
            "{label}不是目录: {}",
            path.display()
        )));
    }
    Ok(path)
}

pub(crate) fn normalize_publish_dir(value: &str) -> Result<PathBuf> {
    let value = value.trim().replace('\\', "/");
    if value.is_empty() || value == "/" || value == "." {
        return Ok(PathBuf::new());
    }

    let mut rel = PathBuf::new();
    for component in Path::new(value.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => {
                if part == ".git" {
                    return Err(SiteError::UnsafePublishDir(value));
                }
                rel.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(SiteError::UnsafePublishDir(value));
            }
        }
    }

    if rel.as_os_str().is_empty() {
        Ok(PathBuf::new())
    } else {
        Ok(rel)
    }
}

pub(crate) fn publish_dir_display(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        "/".to_string()
    } else {
        path_to_slash(path)
    }
}

fn publish_pathspec(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        ".".to_string()
    } else {
        path_to_slash(path)
    }
}

fn ensure_build_output_is_publish_safe(
    build_output: &Path,
    target_root: &Path,
    publish_path: &Path,
) -> Result<()> {
    let build_output = canonical_candidate(build_output)?;
    if build_output == target_root || build_output.starts_with(target_root) {
        return Err(SiteError::UnsafePublishDir(format!(
            "构建产物目录不能位于发布仓库内: {}",
            build_output.display()
        )));
    }
    ensure_publish_paths_do_not_overlap(&build_output, publish_path)
}

fn ensure_publish_paths_do_not_overlap(build_output: &Path, publish_path: &Path) -> Result<()> {
    let build_output = canonical_candidate(build_output)?;
    let publish_path = canonical_candidate(publish_path)?;
    if build_output == publish_path
        || build_output.starts_with(&publish_path)
        || publish_path.starts_with(&build_output)
    {
        return Err(SiteError::UnsafePublishDir(format!(
            "构建产物目录与发布目录重叠: {} <-> {}",
            build_output.display(),
            publish_path.display()
        )));
    }
    Ok(())
}

fn canonical_candidate(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return Ok(path.canonicalize()?);
    }

    let mut missing = Vec::new();
    let mut cursor = path;
    while !cursor.exists() {
        if let Some(name) = cursor.file_name() {
            missing.push(name.to_owned());
        }
        cursor = cursor
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
    }

    let mut candidate = cursor.canonicalize()?;
    for part in missing.iter().rev() {
        candidate.push(part);
    }
    Ok(candidate)
}

fn clear_publish_dir(dir: &Path, preserve_git: bool) -> Result<()> {
    if dir.exists() && !dir.is_dir() {
        return Err(SiteError::UnsafePublishDir(dir.to_string_lossy().to_string()));
    }
    if !dir.exists() {
        fs::create_dir_all(dir)?;
        return Ok(());
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if preserve_git && entry.file_name() == ".git" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn copy_site_output(source: &Path, target: &Path) -> Result<usize> {
    fs::create_dir_all(target)?;
    let mut copied = 0;
    copy_site_output_inner(source, source, target, &mut copied)?;
    Ok(copied)
}

fn copy_site_output_inner(
    root: &Path,
    current: &Path,
    target_root: &Path,
    copied: &mut usize,
) -> Result<()> {
    let mut entries = fs::read_dir(current)?.collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .map_err(|_| SiteError::PathOutsideRepo(path.to_string_lossy().to_string()))?;
        if rel == Path::new(".gittributary-site") {
            continue;
        }
        let target = target_root.join(rel);
        if path.is_dir() {
            fs::create_dir_all(&target)?;
            copy_site_output_inner(root, &path, target_root, copied)?;
        } else if path.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &target)?;
            *copied += 1;
        }
    }
    Ok(())
}

fn default_commit_message(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "deploy: 更新静态站点".to_string()
    } else {
        value.to_string()
    }
}
