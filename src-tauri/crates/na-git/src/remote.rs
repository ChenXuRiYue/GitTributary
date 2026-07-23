//! 远程操作:push / pull / fetch / remote 管理

use git2::{self, Direction, FetchOptions, PushOptions, RemoteCallbacks};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{GitError, Result};
use crate::repo::GitRepo;

/// 远程仓库信息
#[derive(Debug, Clone, Serialize)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub push_url: Option<String>,
}

/// 认证配置(由外部传入,na-git 不直接读 store)
#[derive(Debug, Clone)]
pub enum AuthMethod {
    /// Personal Access Token(HTTPS)
    Token(String),
    /// SSH key(路径 + 可选 passphrase)
    SshKey {
        private_key: String,
        passphrase: Option<String>,
    },
    /// SSH agent
    Agent,
    /// 无认证(公开仓库)
    None,
}

/// 远程仓库只读连通性检查结果。
#[derive(Debug, Clone, Serialize)]
pub struct RemoteAccessReport {
    pub default_branch: Option<String>,
    pub refs_count: usize,
}

fn normalize_remote_input(name: &str, url: &str) -> Result<(String, String)> {
    let name = name.trim();
    let url = url.trim();

    if name.is_empty() {
        return Err(GitError::Internal("远程名称不能为空".to_string()));
    }
    if url.is_empty() {
        return Err(GitError::Internal("远程 URL 不能为空".to_string()));
    }

    Ok((name.to_string(), url.to_string()))
}

/// 检查远程仓库是否可访问。只做 connect/list refs,不 clone/fetch/pull/push。
pub fn check_remote_access(url: &str, auth: &AuthMethod) -> Result<RemoteAccessReport> {
    let mut remote = git2::Remote::create_detached(url)?;
    let callbacks = build_callbacks(auth);
    remote.connect_auth(Direction::Fetch, Some(callbacks), None)?;
    let default_branch = remote
        .default_branch()
        .ok()
        .and_then(|buf| {
            std::str::from_utf8(buf.as_ref())
                .ok()
                .map(|s| s.to_string())
        })
        .and_then(|name| {
            name.strip_prefix("refs/heads/")
                .map(str::to_string)
                .or(Some(name))
        });
    let refs_count = remote.list()?.len();
    remote.disconnect()?;

    Ok(RemoteAccessReport {
        default_branch,
        refs_count,
    })
}

/// Clone 远程仓库到指定本地路径。
///
/// 目标路径不存在时由 git 创建;已存在时必须是空目录,避免覆盖用户数据。
pub fn clone_remote_repo(url: &str, path: impl AsRef<Path>, auth: &AuthMethod) -> Result<GitRepo> {
    let url = url.trim();
    if url.is_empty() {
        return Err(GitError::Internal("远程 URL 不能为空".to_string()));
    }

    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return Err(GitError::Internal("本地路径不能为空".to_string()));
    }

    if path.exists() {
        if !path.is_dir() {
            return Err(GitError::Internal(format!(
                "本地路径不是目录: {}",
                path.display()
            )));
        }
        if fs::read_dir(path)
            .map_err(|e| GitError::Internal(e.to_string()))?
            .next()
            .is_some()
        {
            return Err(GitError::Internal(format!(
                "本地目录必须为空: {}",
                path.display()
            )));
        }
    } else if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(GitError::Internal(format!(
                "父目录不存在: {}",
                parent.display()
            )));
        }
    }

    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(build_callbacks(auth));
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch_opts);
    let repo = builder.clone(url, path)?;
    Ok(GitRepo { repo })
}

/// 从远程 URL 推导本地仓库目录名。
pub fn repo_dir_name_from_url(url: &str) -> Result<String> {
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Err(GitError::Internal("远程 URL 不能为空".to_string()));
    }

    let last_segment = url
        .rsplit(['/', ':'])
        .find(|segment| !segment.trim().is_empty())
        .ok_or_else(|| GitError::Internal("无法从远程 URL 推导仓库目录名".to_string()))?;
    let dir_name = last_segment
        .strip_suffix(".git")
        .unwrap_or(last_segment)
        .trim();

    if dir_name.is_empty()
        || dir_name == "."
        || dir_name == ".."
        || dir_name.contains(std::path::MAIN_SEPARATOR)
        || dir_name.contains('/')
        || dir_name.contains('\\')
    {
        return Err(GitError::Internal(
            "无法从远程 URL 推导仓库目录名".to_string(),
        ));
    }

    Ok(dir_name.to_string())
}

/// Clone 远程仓库到父目录下的自动推导子目录。
pub fn clone_remote_repo_into_parent(
    url: &str,
    parent_path: impl AsRef<Path>,
    auth: &AuthMethod,
) -> Result<GitRepo> {
    let parent_path = parent_path.as_ref();
    if parent_path.as_os_str().is_empty() {
        return Err(GitError::Internal("保存位置不能为空".to_string()));
    }
    if !parent_path.exists() {
        return Err(GitError::Internal(format!(
            "保存位置不存在: {}",
            parent_path.display()
        )));
    }
    if !parent_path.is_dir() {
        return Err(GitError::Internal(format!(
            "保存位置不是目录: {}",
            parent_path.display()
        )));
    }

    let target_path: PathBuf = parent_path.join(repo_dir_name_from_url(url)?);
    clone_remote_repo(url, target_path, auth)
}

impl GitRepo {
    /// 列出所有远程仓库
    pub fn remotes(&self) -> Result<Vec<RemoteInfo>> {
        let names = self.repo.remotes()?;
        let mut result = Vec::new();
        for name in names.iter().flatten() {
            if let Ok(remote) = self.repo.find_remote(name) {
                result.push(RemoteInfo {
                    name: name.to_string(),
                    url: remote.url().unwrap_or("").to_string(),
                    push_url: remote.pushurl().map(|s| s.to_string()),
                });
            }
        }
        Ok(result)
    }

    /// 添加远程
    pub fn add_remote(&self, name: &str, url: &str) -> Result<()> {
        let (name, url) = normalize_remote_input(name, url)?;
        if self.repo.find_remote(&name).is_ok() {
            return Err(GitError::Internal(format!("远程 '{}' 已存在", name)));
        }
        self.repo.remote(&name, &url).map_err(|e| {
            GitError::Internal(format!("添加远程 '{}' 失败: {}", name, e.message()))
        })?;
        Ok(())
    }

    /// 修改远程 URL
    pub fn set_remote_url(&self, name: &str, url: &str) -> Result<()> {
        let (name, url) = normalize_remote_input(name, url)?;
        self.repo
            .find_remote(&name)
            .map_err(|_| GitError::Internal(format!("远程 '{}' 不存在", name)))?;
        self.repo.remote_set_url(&name, &url).map_err(|e| {
            GitError::Internal(format!("修改远程 '{}' 失败: {}", name, e.message()))
        })?;
        Ok(())
    }

    /// 删除远程
    pub fn remove_remote(&self, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(GitError::Internal("远程名称不能为空".to_string()));
        }
        self.repo
            .find_remote(name)
            .map_err(|_| GitError::Internal(format!("远程 '{}' 不存在", name)))?;
        self.repo.remote_delete(name).map_err(|e| {
            GitError::Internal(format!("删除远程 '{}' 失败: {}", name, e.message()))
        })?;
        Ok(())
    }

    /// Fetch(拉取远程引用,不合并)
    pub fn fetch(&self, remote_name: &str, auth: &AuthMethod) -> Result<()> {
        let mut remote = self
            .repo
            .find_remote(remote_name)
            .map_err(|_| GitError::Internal(format!("远程 '{}' 不存在", remote_name)))?;

        let mut fetch_opts = FetchOptions::new();
        let callbacks = build_callbacks(auth);
        fetch_opts.remote_callbacks(callbacks);

        remote.fetch::<&str>(&[], Some(&mut fetch_opts), None)?;
        Ok(())
    }

    /// Push 当前分支到远程
    pub fn push(&self, remote_name: &str, branch: &str, auth: &AuthMethod) -> Result<()> {
        let mut remote = self
            .repo
            .find_remote(remote_name)
            .map_err(|_| GitError::Internal(format!("远程 '{}' 不存在", remote_name)))?;

        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

        let mut push_opts = PushOptions::new();
        let callbacks = build_callbacks(auth);
        push_opts.remote_callbacks(callbacks);

        remote
            .push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| GitError::Internal(format!("推送失败: {}", e.message())))?;
        Ok(())
    }

    /// Pull = fetch + fast-forward merge
    pub fn pull(&self, remote_name: &str, branch: &str, auth: &AuthMethod) -> Result<()> {
        // 1. Fetch
        self.fetch(remote_name, auth)?;

        // 2. Fast-forward
        let fetch_head_ref = format!("refs/remotes/{}/{}", remote_name, branch);
        let fetch_commit = self
            .repo
            .find_reference(&fetch_head_ref)
            .map_err(|_| {
                GitError::Internal(format!("远程分支 '{}/{}' 不存在", remote_name, branch))
            })?
            .peel_to_commit()?;

        let local_ref = format!("refs/heads/{}", branch);
        if let Ok(mut reference) = self.repo.find_reference(&local_ref) {
            let annotated = self.repo.find_annotated_commit(fetch_commit.id())?;
            let (analysis, _) = self.repo.merge_analysis(&[&annotated])?;

            if analysis.is_up_to_date() {
                // 已是最新
                return Ok(());
            }

            if analysis.is_fast_forward() {
                reference.set_target(fetch_commit.id(), "pull: fast-forward")?;
                self.repo.set_head(&local_ref)?;
                self.repo
                    .checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
            } else {
                return Err(GitError::Internal(
                    "无法 fast-forward,存在分叉。请手动合并。".to_string(),
                ));
            }
        }

        Ok(())
    }
}

/// 构建认证回调
pub(crate) fn build_callbacks(auth: &AuthMethod) -> RemoteCallbacks<'_> {
    let mut callbacks = RemoteCallbacks::new();
    let auth = auth.clone();

    callbacks.credentials(move |_url, username_from_url, allowed_types| {
        let username = username_from_url.unwrap_or("git");
        match &auth {
            AuthMethod::Token(token) => {
                // HTTPS: 用 token 作为密码,用户名用实际用户名或 "x-access-token"
                git2::Cred::userpass_plaintext(username_from_url.unwrap_or("x-access-token"), token)
            }
            AuthMethod::SshKey {
                private_key,
                passphrase,
            } => {
                let key_path = Path::new(private_key);
                git2::Cred::ssh_key(username, None, key_path, passphrase.as_deref())
            }
            AuthMethod::Agent => git2::Cred::ssh_key_from_agent(username),
            AuthMethod::None => {
                // 尝试默认方式
                if allowed_types.contains(git2::CredentialType::SSH_KEY) {
                    git2::Cred::ssh_key_from_agent(username)
                } else {
                    Err(git2::Error::from_str("无可用认证方式"))
                }
            }
        }
    });

    callbacks
}
