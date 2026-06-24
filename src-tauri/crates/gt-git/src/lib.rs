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
pub mod remote;
pub mod repo;
pub mod status;

// Re-export 核心类型,方便外部使用
pub use commit::CommitInfo;
pub use diff::FileDiff;
pub use error::{GitError, Result};
pub use log::LogEntry;
pub use remote::{AuthMethod, RemoteInfo};
pub use repo::{GitRepo, RepoOverview};
pub use status::{BranchInfo, ChangeKind, FileStatus};
