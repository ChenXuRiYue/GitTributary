//! NoteAura 统一数据层。
//!
//! `DataHub` 是应用级门面；领域代码通过 Repository 访问数据，物理实现集中在
//! `storage` 子模块，可逐类替换为文档、KV、事件日志和查询投影。

pub mod domain;
mod error;
#[doc(hidden)]
pub(crate) mod storage;

#[cfg(test)]
mod tests;

pub use domain::*;
pub use error::{DataError, Result};
pub use storage::namespace::Visibility;
pub use storage::store::validate_namespace_name;
pub use storage::sync::{ConfigRepoAuth, SyncConfig, SyncEngine, SyncState};
