use std::path::PathBuf;
use thiserror::Error;

/// gt-git 统一错误类型。
/// 面向用户的 Display 消息应可直接展示在前端,不暴露底层实现细节。
#[derive(Debug, Error)]
pub enum GitError {
    #[error("路径 {0} 不是一个 Git 仓库")]
    NotARepo(PathBuf),

    #[error("仓库处于 detached HEAD 状态,无法确定当前分支")]
    DetachedHead,

    #[error("没有可提交的变更")]
    NothingToCommit,

    #[error("暂存区为空,请先 stage 文件")]
    EmptyIndex,

    #[error("Git 操作失败: {0}")]
    Internal(String),
}

impl From<git2::Error> for GitError {
    fn from(e: git2::Error) -> Self {
        GitError::Internal(e.message().to_string())
    }
}

pub type Result<T> = std::result::Result<T, GitError>;
