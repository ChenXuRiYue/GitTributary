//! `~/.git-tributary/` 根目录路径解析。
//!
//! 独立成小模块是因为它被多个命令分组共用(sync 命令、远程配置聚合视图),
//! 放在任何单一 `commands::*` 子模块里都会造成循环引用。

/// 数据中心根目录:`~/.git-tributary/`。
pub(crate) fn store_base_dir() -> std::path::PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".git-tributary")
}
