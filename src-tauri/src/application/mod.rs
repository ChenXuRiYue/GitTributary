//! 主应用的用例编排层。
//!
//! 这里按 Git、Flow、数据、文件与插件领域组织 Tauri command 和应用级编排，
//! 底层能力继续由 `na-*` crates 提供。

pub(crate) mod data;
pub(crate) mod files;
pub(crate) mod flow;
pub(crate) mod git;
pub(crate) mod plugins;
