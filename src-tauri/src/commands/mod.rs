//! Tauri command 分组模块。
//!
//! 每个子模块对应前端一个功能面板调用的一组命令,只做:
//!   - `#[tauri::command]` 转发
//!   - 拿 `AppState` 里的锁,调用对应业务 crate
//!   - 把 crate 的 `Result` 转成 `Result<T, String>` 给前端
//!
//! 跨领域编排逻辑(认证优先级解析、错误分类)在拆分到独立子模块前,
//! 仍保留在 `crate::` 根(`auth.rs` / `error.rs`),命令模块通过
//! `use crate::...` 引用。

pub mod credentials;
pub mod files;
pub mod flow;
pub mod git;
pub mod remote;
pub mod store;
pub mod sync;
pub mod workspace;
