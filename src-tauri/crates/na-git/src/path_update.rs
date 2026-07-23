use std::path::{Path, PathBuf};
use std::process::Command;

use git2::{Direction, FetchOptions};
use serde::Serialize;

use crate::commit::CommitIdentity;
use crate::error::{GitError, Result};
use crate::remote::{build_callbacks, AuthMethod};

mod transport;

use transport::{
    push_head, push_head_with_token_askpass, remote_for_direction, remote_url_for_direction,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathUpdateReport {
    pub target_repo_path: String,
    pub branch: String,
    pub remote_name: String,
    pub changed_count: usize,
    pub commit: Option<String>,
    pub pushed: bool,
}

#[derive(Debug, Clone)]
pub struct PreparePathUpdateOptions {
    pub target_local_path: PathBuf,
    pub branch: String,
    pub remote_name: String,
    pub allowed_dirty_pathspec: Option<String>,
    pub auth: AuthMethod,
}

#[derive(Debug, Clone)]
pub struct CommitPathUpdateOptions {
    pub target_local_path: PathBuf,
    pub branch: String,
    pub remote_name: String,
    pub pathspec: String,
    pub commit_message: String,
    pub commit_identity: CommitIdentity,
    pub auth: AuthMethod,
}

pub fn resolve_repo_root(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref();
    if !path.exists() {
        return Err(GitError::Internal(format!(
            "仓库路径不存在: {}",
            path.display()
        )));
    }
    if !path.is_dir() {
        return Err(GitError::Internal(format!(
            "仓库路径不是目录: {}",
            path.display()
        )));
    }
    let output = run_git(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| GitError::NotARepo(path.to_path_buf()))?;
    let root = PathBuf::from(output.trim());
    canonical_existing_dir(&root, "仓库")
}

pub fn normalize_git_name(value: &str, label: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(GitError::Internal(format!("{label}不能为空")));
    }
    if value.starts_with('-')
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(GitError::Internal(format!("{label}不合法: {value}")));
    }
    Ok(value.to_string())
}

pub fn validate_branch_name(repo: impl AsRef<Path>, branch: &str) -> Result<()> {
    run_git(repo.as_ref(), &["check-ref-format", "--branch", branch]).map(|_| ())
}

pub fn ensure_clean_repo(repo: impl AsRef<Path>) -> Result<()> {
    let repo = repo.as_ref();
    let status = run_git(repo, &["status", "--porcelain", "--untracked-files=all"])?;
    if status.trim().is_empty() {
        return Ok(());
    }
    let preview = status
        .lines()
        .take(5)
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    Err(GitError::Internal(format!(
        "仓库工作区有未提交变更,请先处理: {preview}"
    )))
}

pub fn ensure_clean_repo_except(repo: impl AsRef<Path>, allowed_pathspec: &str) -> Result<()> {
    let repo = repo.as_ref();
    let all_status = run_git(repo, &["status", "--porcelain", "--untracked-files=all"])?;
    if all_status.trim().is_empty() {
        return Ok(());
    }

    let allowed_status = run_git(
        repo,
        &[
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            allowed_pathspec,
        ],
    )?;
    let blocked = all_status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
        .saturating_sub(
            allowed_status
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count(),
        );
    if blocked == 0 {
        return Ok(());
    }

    let preview = all_status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(5)
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    Err(GitError::Internal(format!(
        "仓库工作区在允许路径之外有未提交变更,请先处理: {preview}"
    )))
}

pub fn ensure_remote_exists(repo: impl AsRef<Path>, remote_name: &str) -> Result<()> {
    run_git(repo.as_ref(), &["remote", "get-url", remote_name]).map(|_| ())
}

pub fn prepare_path_update(options: PreparePathUpdateOptions) -> Result<PathBuf> {
    let target_root = resolve_repo_root(&options.target_local_path)?;
    let branch = normalize_git_name(&options.branch, "目标分支")?;
    let remote_name = normalize_git_name(&options.remote_name, "远程")?;
    validate_branch_name(&target_root, &branch)?;
    ensure_remote_exists(&target_root, &remote_name)?;
    if let Some(pathspec) = options.allowed_dirty_pathspec.as_deref() {
        validate_pathspec(pathspec)?;
        ensure_clean_repo_except(&target_root, pathspec)?;
        discard_pathspec_changes(&target_root, pathspec)?;
    } else {
        ensure_clean_repo(&target_root)?;
    }
    prepare_target_branch(&target_root, &remote_name, &branch, &options.auth)?;
    Ok(target_root)
}

pub fn commit_path_update(options: CommitPathUpdateOptions) -> Result<PathUpdateReport> {
    let target_root = resolve_repo_root(&options.target_local_path)?;
    let branch = normalize_git_name(&options.branch, "目标分支")?;
    let remote_name = normalize_git_name(&options.remote_name, "远程")?;
    validate_branch_name(&target_root, &branch)?;
    ensure_remote_exists(&target_root, &remote_name)?;
    validate_pathspec(&options.pathspec)?;
    ensure_current_branch(&target_root, &branch)?;
    ensure_clean_repo_except(&target_root, &options.pathspec)?;
    run_git(&target_root, &["add", "-A", "--", &options.pathspec])?;
    let changed_count = status_count(&target_root, &options.pathspec)?;
    let commit = if changed_count > 0 {
        run_git_commit(
            &target_root,
            &options.commit_message,
            &options.pathspec,
            &options.commit_identity,
        )?;
        Some(current_commit(&target_root)?)
    } else {
        None
    };

    let pushed = if has_head(&target_root) {
        push_head(&target_root, &remote_name, &branch, &options.auth)?;
        true
    } else {
        false
    };

    Ok(PathUpdateReport {
        target_repo_path: target_root.to_string_lossy().to_string(),
        branch,
        remote_name,
        changed_count,
        commit,
        pushed,
    })
}

fn validate_pathspec(pathspec: &str) -> Result<()> {
    if pathspec == "." {
        return Ok(());
    }
    let path = Path::new(pathspec);
    if pathspec.is_empty()
        || path.is_absolute()
        || pathspec.contains('\\')
        || pathspec.starts_with(':')
        || pathspec
            .chars()
            .any(|character| character.is_control() || matches!(character, '*' | '?' | '[' | ']'))
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(GitError::Internal(format!(
            "Git 路径范围不合法: {pathspec}"
        )));
    }
    Ok(())
}

pub fn verify_push_access(
    target_local_path: impl AsRef<Path>,
    remote_name: &str,
    branch: &str,
    auth: &AuthMethod,
) -> Result<()> {
    let target_root = resolve_repo_root(target_local_path)?;
    let branch = normalize_git_name(branch, "目标分支")?;
    let remote_name = normalize_git_name(remote_name, "远程")?;
    validate_branch_name(&target_root, &branch)?;
    ensure_remote_exists(&target_root, &remote_name)?;
    if !has_head(&target_root) {
        return Ok(());
    }

    let git_repo = git2::Repository::open(&target_root)?;
    let push_url = remote_url_for_direction(&git_repo, &remote_name, Direction::Push)?;
    let refspec = format!("HEAD:refs/heads/{branch}");
    if matches!(auth, AuthMethod::Token(_)) && push_url.to_ascii_lowercase().starts_with("https://")
    {
        return push_head_with_token_askpass(&target_root, &push_url, &refspec, auth, true);
    }
    run_git(&target_root, &["push", "--dry-run", &remote_name, &refspec]).map(|_| ())
}

fn ensure_current_branch(repo: &Path, branch: &str) -> Result<()> {
    let current = run_git(repo, &["branch", "--show-current"])?;
    if current.trim() == branch {
        return Ok(());
    }
    run_git(repo, &["checkout", branch]).map(|_| ())
}

fn discard_pathspec_changes(repo: &Path, pathspec: &str) -> Result<()> {
    run_git(repo, &["reset", "--", pathspec])?;
    run_git(repo, &["clean", "-fdx", "--", pathspec])?;
    Ok(())
}

fn prepare_target_branch(
    repo: &Path,
    remote_name: &str,
    branch: &str,
    auth: &AuthMethod,
) -> Result<()> {
    let local_ref = format!("refs/heads/{branch}");
    let remote_ref = format!("refs/remotes/{remote_name}/{branch}");
    let remote_exists = remote_branch_exists(repo, remote_name, branch, auth)?;
    if remote_exists {
        fetch_target_branch(repo, remote_name, branch, auth)?;
    }

    if ref_exists(repo, &local_ref) {
        run_git(repo, &["checkout", branch])?;
        if remote_exists {
            run_git(repo, &["merge", "--ff-only", &remote_ref])?;
        }
        return Ok(());
    }

    if remote_exists && ref_exists(repo, &remote_ref) {
        run_git(repo, &["checkout", "-B", branch, &remote_ref])?;
        return Ok(());
    }

    if has_head(repo) {
        run_git(repo, &["checkout", "-B", branch])?;
    } else {
        let head_ref = format!("refs/heads/{branch}");
        run_git(repo, &["symbolic-ref", "HEAD", &head_ref])?;
    }
    Ok(())
}

fn remote_branch_exists(
    repo: &Path,
    remote_name: &str,
    branch: &str,
    auth: &AuthMethod,
) -> Result<bool> {
    let repo = git2::Repository::open(repo)?;
    let mut remote = remote_for_direction(&repo, remote_name, Direction::Fetch)?;
    remote.connect_auth(Direction::Fetch, Some(build_callbacks(auth)), None)?;
    let head_ref = format!("refs/heads/{branch}");
    let exists = remote
        .list()?
        .iter()
        .any(|head| head.name() == head_ref.as_str());
    remote.disconnect()?;
    Ok(exists)
}

fn fetch_target_branch(
    repo: &Path,
    remote_name: &str,
    branch: &str,
    auth: &AuthMethod,
) -> Result<()> {
    let repo = git2::Repository::open(repo)?;
    let mut remote = remote_for_direction(&repo, remote_name, Direction::Fetch)?;
    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(build_callbacks(auth));
    let fetch_refspec = format!("+refs/heads/{branch}:refs/remotes/{remote_name}/{branch}");
    remote.fetch(&[fetch_refspec.as_str()], Some(&mut fetch_opts), None)?;
    Ok(())
}

fn status_count(repo: &Path, pathspec: &str) -> Result<usize> {
    let status = run_git(
        repo,
        &[
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            pathspec,
        ],
    )?;
    Ok(status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count())
}

fn run_git_commit(
    repo: &Path,
    message: &str,
    pathspec: &str,
    identity: &CommitIdentity,
) -> Result<()> {
    let name_config = format!("user.name={}", identity.name);
    let email_config = format!("user.email={}", identity.email);
    run_git(
        repo,
        &[
            "-c",
            name_config.as_str(),
            "-c",
            email_config.as_str(),
            "commit",
            "-m",
            message,
            "--",
            pathspec,
        ],
    )
    .map(|_| ())
}

fn current_commit(repo: &Path) -> Result<String> {
    Ok(run_git(repo, &["rev-parse", "HEAD"])?.trim().to_string())
}

fn has_head(repo: &Path) -> bool {
    git_command_success(repo, &["rev-parse", "--verify", "HEAD"])
}

fn ref_exists(repo: &Path, refname: &str) -> bool {
    git_command_success(repo, &["rev-parse", "--verify", "--quiet", refname])
}

fn canonical_existing_dir(path: &Path, label: &str) -> Result<PathBuf> {
    if !path.exists() {
        return Err(GitError::Internal(format!(
            "{label}不存在: {}",
            path.display()
        )));
    }
    let path = path
        .canonicalize()
        .map_err(|err| GitError::Internal(format!("读取{label}路径失败: {}", err)))?;
    if !path.is_dir() {
        return Err(GitError::Internal(format!(
            "{label}不是目录: {}",
            path.display()
        )));
    }
    Ok(path)
}

fn git_command_success(repo: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn run_git(repo: &Path, args: &[&str]) -> Result<String> {
    run_git_with_optional_env(repo, args, &[])
}

fn run_git_with_optional_env(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String> {
    let mut command = Command::new("git");
    command.args(args).current_dir(repo);
    for (key, value) in envs {
        command.env(key, value);
    }
    let output = command
        .output()
        .map_err(|err| GitError::Internal(format!("无法执行 git: {err}")))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    Err(GitError::Internal(format!(
        "git {} 失败{}",
        args.join(" "),
        if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        }
    )))
}

#[cfg(test)]
mod tests;
