//! # gt-git
//!
//! GitTributary 的 Git 基础能力层。
//! 提供仓库打开/初始化、状态查询、暂存与提交等核心操作。
//! 作为平台级公共能力, 所有插件通过此 crate 获取 Git 服务。

pub mod branch;
pub mod commit;
pub mod diff;
pub mod error;
pub mod log;
pub mod pages;
pub mod remote;
pub mod repo;
pub mod status;

// Re-export 核心类型,方便外部使用
pub use commit::{CommitIdentity, CommitInfo};
pub use diff::FileDiff;
pub use error::{GitError, Result};
pub use log::LogEntry;
pub use pages::{
    commit_pages_git, ensure_clean_repo, ensure_clean_repo_except, ensure_remote_exists,
    normalize_git_name, prepare_pages_git, publish_pages_git, resolve_repo_root,
    validate_branch_name, PagesCommitGitOptions, PagesPrepareGitOptions, PagesPublishGitOptions,
    PagesPublishGitReport, verify_pages_push_access,
};
pub use remote::{
    check_remote_access, clone_remote_repo, clone_remote_repo_into_parent, repo_dir_name_from_url,
    AuthMethod, RemoteAccessReport, RemoteInfo,
};
pub use repo::{GitRepo, RepoOverview};
pub use status::{BranchInfo, ChangeKind, FileStatus};
