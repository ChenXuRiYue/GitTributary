//! `na-data` 的物理存储实现。
//!
//! 业务层不应直接依赖这里的类型；它们只为 Repository、同步端口和迁移代码服务。

pub(crate) mod error;
pub(crate) mod namespace;
pub(crate) mod policy;
pub(crate) mod record;
pub(crate) mod store;
pub(crate) mod sync;

pub(crate) use error::StoreError;
pub(crate) use namespace::Visibility;
pub(crate) use policy::{is_reserved_secret_namespace, DataClass, NamespacePolicy, Sensitivity};
pub(crate) use store::{validate_namespace_name, Store};
pub(crate) use sync::SyncEngine;
