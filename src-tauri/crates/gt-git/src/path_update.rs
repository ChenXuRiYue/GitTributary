use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use git2::{Direction, FetchOptions, PushOptions, Remote};
use serde::Serialize;

use crate::commit::CommitIdentity;
use crate::error::{GitError, Result};
use crate::remote::{build_callbacks, AuthMethod};

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

fn push_head(repo: &Path, remote_name: &str, branch: &str, auth: &AuthMethod) -> Result<()> {
    let git_repo = git2::Repository::open(repo)?;
    let push_url = remote_url_for_direction(&git_repo, remote_name, Direction::Push)?;
    let mut remote = remote_for_direction(&git_repo, remote_name, Direction::Push)?;
    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(build_callbacks(auth));
    let refspec = format!("HEAD:refs/heads/{branch}");
    match remote.push(&[refspec.as_str()], Some(&mut push_opts)) {
        Ok(_) => Ok(()),
        Err(err) if should_retry_with_system_git(err.message(), auth, &push_url) => {
            push_head_with_token_askpass(repo, &push_url, &refspec, auth, false)
        }
        Err(err) => Err(GitError::Internal(format!(
            "推送失败: {}",
            explain_network_error(err.message())
        ))),
    }
}

fn should_retry_with_system_git(message: &str, auth: &AuthMethod, url: &str) -> bool {
    matches!(auth, AuthMethod::Token(_))
        && url.to_ascii_lowercase().starts_with("https://")
        && is_auth_replay_error(message)
}

fn is_auth_replay_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("too many redirects")
        || lower.contains("authentication replays")
        || lower.contains("authentication failed")
}

fn push_head_with_token_askpass(
    repo: &Path,
    push_url: &str,
    refspec: &str,
    auth: &AuthMethod,
    dry_run: bool,
) -> Result<()> {
    let AuthMethod::Token(token) = auth else {
        return Err(GitError::Internal(
            "系统 Git 兜底推送需要 Token 认证".to_string(),
        ));
    };
    let askpass_path = std::env::temp_dir().join(format!(
        "gittributary-askpass-{}-{}.sh",
        std::process::id(),
        stable_hash(push_url)
    ));
    fs::write(
        &askpass_path,
        "#!/bin/sh\ncase \"$1\" in\n*Username*) printf '%s\\n' 'x-access-token' ;;\n*) printf '%s\\n' \"$GITTRIBUTARY_GIT_TOKEN\" ;;\nesac\n",
    )
    .map_err(|err| GitError::Internal(format!("创建临时 git askpass 失败: {err}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&askpass_path)
            .map_err(|err| GitError::Internal(format!("读取临时 git askpass 权限失败: {err}")))?
            .permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&askpass_path, perms)
            .map_err(|err| GitError::Internal(format!("设置临时 git askpass 权限失败: {err}")))?;
    }

    let args = if dry_run {
        vec!["push", "--dry-run", push_url, refspec]
    } else {
        vec!["push", push_url, refspec]
    };
    let result = run_git_with_env(
        repo,
        &args,
        &[
            ("GIT_ASKPASS", askpass_path.to_string_lossy().as_ref()),
            ("GIT_TERMINAL_PROMPT", "0"),
            ("GITTRIBUTARY_GIT_TOKEN", token.as_str()),
        ],
    );
    let _ = fs::remove_file(&askpass_path);
    result.map(|_| ())
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn remote_url_for_direction(
    repo: &git2::Repository,
    remote_name: &str,
    direction: Direction,
) -> Result<String> {
    let remote = repo
        .find_remote(remote_name)
        .map_err(|_| GitError::Internal(format!("远程 '{}' 不存在", remote_name)))?;
    let raw_url = match direction {
        Direction::Push => remote.pushurl().or_else(|| remote.url()),
        Direction::Fetch => remote.url(),
    }
    .ok_or_else(|| GitError::Internal(format!("远程 '{}' 未配置 URL", remote_name)))?;
    Ok(normalize_network_url(raw_url))
}

fn sanitize_error_detail(detail: &str) -> String {
    let mut sanitized = Vec::new();
    for line in detail.lines() {
        if line.contains("GITTRIBUTARY_GIT_TOKEN") {
            sanitized.push("<redacted>");
        } else {
            sanitized.push(line);
        }
    }
    sanitized.join("\n")
}

fn run_git_with_env(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String> {
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

    let stderr = sanitize_error_detail(String::from_utf8_lossy(&output.stderr).trim());
    let stdout = sanitize_error_detail(String::from_utf8_lossy(&output.stdout).trim());
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    Err(GitError::Internal(format!(
        "推送失败: {}",
        if detail.is_empty() {
            "系统 Git 推送失败".to_string()
        } else {
            explain_network_error(&detail)
        }
    )))
}

fn explain_network_error(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("too many redirects") || lower.contains("authentication replays") {
        format!("{message}; Git 服务端拒绝了当前认证,请检查远程 URL 与 Token/SSH 权限")
    } else {
        message.to_string()
    }
}

fn remote_for_direction<'repo>(
    repo: &'repo git2::Repository,
    remote_name: &str,
    direction: Direction,
) -> Result<Remote<'repo>> {
    let remote = repo
        .find_remote(remote_name)
        .map_err(|_| GitError::Internal(format!("远程 '{}' 不存在", remote_name)))?;
    let normalized = remote_url_for_direction(repo, remote_name, direction)?;
    if remote.url() == Some(normalized.as_str()) {
        return Ok(remote);
    }
    repo.remote_anonymous(&normalized).map_err(Into::into)
}

fn normalize_network_url(url: &str) -> String {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("https://github.com/")
        && !trimmed.ends_with(".git")
        && !trimmed.contains('?')
        && !trimmed.contains('#')
    {
        format!("{trimmed}.git")
    } else {
        trimmed.to_string()
    }
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
mod tests {
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
}
