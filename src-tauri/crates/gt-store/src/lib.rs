//! # gt-store
//!
//! GitTributary 数据中心:所有配置项的统一 KV 存储。
//! JSONL 持久化、命名空间隔离、Profile 切换、Git 备份友好。

pub mod credentials;
pub mod error;
pub mod namespace;
pub mod record;
pub mod store;
pub mod sync;
pub mod workspace;

pub use credentials::{DataCenterConfigCredentialStatus, GitCredentials};
pub use error::{Result, StoreError};
pub use namespace::Visibility;
pub use record::Record;
pub use store::Store;
pub use sync::{ConfigRepoAuth, SyncConfig, SyncEngine, SyncState};
