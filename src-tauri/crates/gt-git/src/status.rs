use std::path::PathBuf;

use git2::{Repository, StatusOptions};
use serde::Serialize;

use crate::error::{GitError, Result};
use crate::repo::GitRepo;

/// 文件变更类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    TypeChanged,
    Untracked,
    Conflicted,
}

/// 单个文件的变更状态
#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: PathBuf,
    pub kind: ChangeKind,
    /// 是否已暂存(在 index 中)
    pub staged: bool,
}

/// 分支信息
#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
}

/// 内部辅助:获取当前分支短名
pub(crate) fn current_branch(repo: &Repository) -> Result<String> {
    let head = repo.head().map_err(|_| GitError::DetachedHead)?;
    if head.is_branch() {
        Ok(head
            .shorthand()
            .unwrap_or("HEAD")
            .to_string())
    } else {
        Err(GitError::DetachedHead)
    }
}

impl GitRepo {
    /// 获取当前分支名。detached HEAD 时返回错误。
    pub fn current_branch(&self) -> Result<String> {
        current_branch(&self.repo)
    }

    /// 列出所有本地和远程分支。
    pub fn branches(&self) -> Result<Vec<BranchInfo>> {
        let mut result = Vec::new();
        let branches = self.repo.branches(None)?;

        for item in branches {
            let (branch, branch_type) = item?;
            let name = branch
                .name()?
                .unwrap_or("<invalid utf8>")
                .to_string();
            let is_head = branch.is_head();
            let is_remote = branch_type == git2::BranchType::Remote;
            result.push(BranchInfo {
                name,
                is_head,
                is_remote,
            });
        }

        Ok(result)
    }

    /// 获取工作区变更文件列表(包含工作区未暂存 + 暂存区已暂存)。
    pub fn status(&self) -> Result<Vec<FileStatus>> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_unmodified(false);

        let statuses = self.repo.statuses(Some(&mut opts))?;
        let mut result = Vec::with_capacity(statuses.len());

        for entry in statuses.iter() {
            let path = PathBuf::from(entry.path().unwrap_or(""));
            let s = entry.status();

            // 暂存区(index)变更
            if s.intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED
                    | git2::Status::INDEX_TYPECHANGE,
            ) {
                let kind = if s.contains(git2::Status::INDEX_NEW) {
                    ChangeKind::Added
                } else if s.contains(git2::Status::INDEX_MODIFIED) {
                    ChangeKind::Modified
                } else if s.contains(git2::Status::INDEX_DELETED) {
                    ChangeKind::Deleted
                } else if s.contains(git2::Status::INDEX_TYPECHANGE) {
                    ChangeKind::TypeChanged
                } else {
                    ChangeKind::Renamed
                };
                result.push(FileStatus {
                    path: path.clone(),
                    kind,
                    staged: true,
                });
            }

            // 工作区(worktree)变更
            if s.intersects(
                git2::Status::WT_NEW
                    | git2::Status::WT_MODIFIED
                    | git2::Status::WT_DELETED
                    | git2::Status::WT_RENAMED
                    | git2::Status::WT_TYPECHANGE
                    | git2::Status::CONFLICTED,
            ) {
                let kind = if s.contains(git2::Status::WT_NEW) {
                    ChangeKind::Untracked
                } else if s.contains(git2::Status::WT_MODIFIED) {
                    ChangeKind::Modified
                } else if s.contains(git2::Status::WT_DELETED) {
                    ChangeKind::Deleted
                } else if s.contains(git2::Status::WT_TYPECHANGE) {
                    ChangeKind::TypeChanged
                } else if s.contains(git2::Status::WT_RENAMED) {
                    ChangeKind::Renamed
                } else {
                    ChangeKind::Conflicted
                };
                result.push(FileStatus {
                    path: path.clone(),
                    kind,
                    staged: false,
                });
            }
        }

        Ok(result)
    }
}
