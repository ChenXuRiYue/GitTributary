use std::fs;
use std::path::Path;
use std::process::Command;

use git2::{Direction, PushOptions, Remote};

use crate::error::{GitError, Result};
use crate::remote::{build_callbacks, AuthMethod};

pub(super) fn push_head(
    repo: &Path,
    remote_name: &str,
    branch: &str,
    auth: &AuthMethod,
) -> Result<()> {
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

pub(super) fn push_head_with_token_askpass(
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
        "noteaura-askpass-{}-{}.sh",
        std::process::id(),
        stable_hash(push_url)
    ));
    fs::write(
        &askpass_path,
        "#!/bin/sh\ncase \"$1\" in\n*Username*) printf '%s\\n' 'x-access-token' ;;\n*) printf '%s\\n' \"$NOTEAURA_GIT_TOKEN\" ;;\nesac\n",
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
            ("NOTEAURA_GIT_TOKEN", token.as_str()),
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

pub(super) fn remote_url_for_direction(
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
        if line.contains("NOTEAURA_GIT_TOKEN") {
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

pub(super) fn remote_for_direction<'repo>(
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
