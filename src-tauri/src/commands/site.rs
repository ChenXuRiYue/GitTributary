//! 静态站点构建 + Pages 发布命令。
//!
//! 详见 `doc/站点/静态HTML构建器设计.md` 和 `doc/站点/Pages发布目标设计.md`。

use tauri::State;

use gt_git::{
    commit_pages_git, normalize_git_name, prepare_pages_git, resolve_repo_root, GitRepo,
    PagesCommitGitOptions, PagesPrepareGitOptions,
};
use gt_site::{SiteBuildConfig, SiteBuildReport, SiteScanReport};

use crate::auth::resolve_auth_for_publish_target;
use crate::commands::remote::remote_url_for;
use crate::error::classify_pages_publish_error;
use crate::identity::commit_identity_for_repo_remote;
use crate::{set_active_repo_state, AppState};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SitePublishRequest {
    build_config: SiteBuildConfig,
    target: SitePublishTarget,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SitePublishTarget {
    target_local_path: String,
    target_branch: String,
    publish_dir: String,
    remote_name: String,
    #[serde(default)]
    credential_ref: Option<String>,
    #[serde(default)]
    pages_url: String,
    #[serde(default)]
    auto_commit_message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SitePublishReport {
    build: SiteBuildReport,
    target_repo_path: String,
    publish_dir: String,
    publish_path: String,
    branch: String,
    remote_name: String,
    pages_url: String,
    copied_file_count: usize,
    changed_count: usize,
    commit: Option<String>,
    pushed: bool,
    credential_mode: String,
    credential_ref: Option<String>,
    duration_ms: u128,
}

#[tauri::command]
pub(crate) fn site_scan(
    repo_path: String,
    state: State<'_, AppState>,
) -> Result<SiteScanReport, String> {
    let report = gt_site::scan_repo(repo_path).map_err(|e| e.to_string())?;
    if let Ok(repo) = GitRepo::open(&report.repo_path) {
        let _ = set_active_repo_state(repo, &state);
    }
    Ok(report)
}

#[tauri::command]
pub(crate) async fn site_build(config: SiteBuildConfig) -> Result<SiteBuildReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        gt_site::build_site(config).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn site_publish_pages(
    request: SitePublishRequest,
    state: State<'_, AppState>,
) -> Result<SitePublishReport, String> {
    let started = std::time::Instant::now();
    let branch =
        normalize_git_name(&request.target.target_branch, "目标分支").map_err(|e| e.to_string())?;
    let remote_name =
        normalize_git_name(&request.target.remote_name, "发布远程").map_err(|e| e.to_string())?;
    let target_root =
        resolve_repo_root(&request.target.target_local_path).map_err(|e| e.to_string())?;
    let target_repo = GitRepo::open(&target_root).map_err(|e| e.to_string())?;
    let target_remote_url = remote_url_for(&target_repo, &remote_name)?;
    let auth = resolve_auth_for_publish_target(
        &state,
        &target_root,
        Some(&target_remote_url),
        request.target.credential_ref.as_deref(),
    );

    let commit_identity =
        commit_identity_for_repo_remote(&state, &target_root.to_string_lossy(), Some(&remote_name));
    tauri::async_runtime::spawn_blocking(move || {
        let target_plan = gt_site::plan_publish_target(
            &request.build_config,
            &target_root,
            &request.target.publish_dir,
        )
        .map_err(|e| classify_pages_publish_error(&e.to_string()))?;

        prepare_pages_git(PagesPrepareGitOptions {
            target_local_path: target_root.clone(),
            branch: branch.clone(),
            remote_name: remote_name.clone(),
            allowed_dirty_pathspec: Some(target_plan.publish_pathspec.clone()),
            auth: auth.method.clone(),
        })
        .map_err(|e| classify_pages_publish_error(&e.to_string()))?;

        gt_git::verify_pages_push_access(&target_root, &remote_name, &branch, &auth.method)
            .map_err(|e| classify_pages_publish_error(&e.to_string()))?;

        let prepared = gt_site::prepare_publish_output(
            request.build_config,
            &target_root,
            &request.target.publish_dir,
            &request.target.pages_url,
            &request.target.auto_commit_message,
        )
        .map_err(|e| e.to_string())?;

        let git_report = commit_pages_git(PagesCommitGitOptions {
            target_local_path: target_root,
            branch,
            remote_name,
            publish_pathspec: target_plan.publish_pathspec.clone(),
            commit_message: prepared.commit_message.clone(),
            commit_identity,
            auth: auth.method,
        })
        .map_err(|e| classify_pages_publish_error(&e.to_string()))?;

        Ok(SitePublishReport {
            build: prepared.build,
            target_repo_path: git_report.target_repo_path,
            publish_dir: prepared.publish_dir,
            publish_path: prepared.publish_path,
            branch: git_report.branch,
            remote_name: git_report.remote_name,
            pages_url: prepared.pages_url,
            copied_file_count: prepared.copied_file_count,
            changed_count: git_report.changed_count,
            commit: git_report.commit,
            pushed: git_report.pushed,
            credential_mode: auth.mode,
            credential_ref: auth.credential_ref,
            duration_ms: started.elapsed().as_millis(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn site_open_output(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}
