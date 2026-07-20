use std::path::{Path, PathBuf};

use git2::Repository;
use serde::Serialize;

use crate::error::{GitError, Result};
use crate::status::current_branch;

/// 仓库概况快照
#[derive(Debug, Clone, Serialize)]
pub struct RepoOverview {
    /// 仓库根目录路径
    pub path: PathBuf,
    /// 当前分支名(detached 时为 "HEAD")
    pub current_branch: String,
    /// 工作区是否有未提交的变更
    pub is_dirty: bool,
    /// 变更文件数量
    pub changed_count: usize,
    /// 远程 origin 的 URL(如果存在)
    pub remote_url: Option<String>,
}

/// 核心结构体:持有 git2::Repository 句柄。
/// 应用内唯一的 Git 操作入口。
pub struct GitRepo {
    pub(crate) repo: Repository,
}

impl GitRepo {
    /// 打开已有仓库。支持从子目录向上 discover。
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let repo =
            Repository::discover(path).map_err(|_| GitError::NotARepo(path.to_path_buf()))?;
        Ok(Self { repo })
    }

    /// 在指定路径初始化新仓库。
    pub fn init(path: impl AsRef<Path>) -> Result<Self> {
        let repo = Repository::init(path)?;
        Ok(Self { repo })
    }

    /// 静态检测某路径是否为(或位于) Git 仓库中。
    pub fn is_repo(path: impl AsRef<Path>) -> bool {
        Repository::discover(path.as_ref()).is_ok()
    }

    /// 获取仓库根目录路径(.git 所在目录的父目录)。
    pub fn workdir(&self) -> Option<&Path> {
        self.repo.workdir()
    }

    /// 获取包含工作区状态的完整仓库概况快照。
    pub fn overview(&self) -> Result<RepoOverview> {
        let mut overview = self.metadata()?;
        overview.changed_count = self.status()?.len();
        overview.is_dirty = overview.changed_count > 0;
        Ok(overview)
    }

    /// 获取不遍历工作区的轻量仓库元数据。
    ///
    /// 页面 Shell 使用该接口，状态由激活视图显式请求，避免打开仓库时
    /// 隐式扫描后又立即重复扫描。
    pub fn metadata(&self) -> Result<RepoOverview> {
        let path = self
            .repo
            .workdir()
            .unwrap_or_else(|| self.repo.path())
            .to_path_buf();

        let branch = current_branch(&self.repo).unwrap_or_else(|_| "HEAD".to_string());

        let remote_url = self
            .repo
            .find_remote("origin")
            .ok()
            .and_then(|r| r.url().map(|u| u.to_string()));

        Ok(RepoOverview {
            path,
            current_branch: branch,
            is_dirty: false,
            changed_count: 0,
            remote_url,
        })
    }
}
