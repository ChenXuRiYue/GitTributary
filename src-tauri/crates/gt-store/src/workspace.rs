//! 工作区(workspace)命名空间管理:
//! - 当前聚焦的 Git 仓库
//! - 最近打开的仓库列表
//! - 当前设备信息(设备号)

use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::error::Result;
use crate::store::Store;

const NS: &str = "workspace";
const KEY_ACTIVE_REPO: &str = "repo.active";
const KEY_RECENT_REPOS: &str = "repo.recent";
const KEY_DEVICE_ID: &str = "device.id";
const KEY_DEVICE_NAME: &str = "device.name";

/// 最近仓库列表最大长度
const MAX_RECENT: usize = 10;

/// 生成设备短 ID:基于 hostname + username 的 hash 前 8 位
fn generate_device_id() -> String {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let username = whoami::username();
    let raw = format!("{}@{}", username, hostname);
    let mut hasher = DefaultHasher::new();
    raw.hash(&mut hasher);
    let hash = hasher.finish();
    format!("{:x}", hash)[..8].to_string()
}

/// 获取设备友好名(hostname)
fn device_name() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

impl Store {
    /// 初始化 workspace 命名空间(应用启动时调用一次)
    pub fn init_workspace(&mut self) -> Result<()> {
        // 设备信息(只在首次写入)
        if self.get(NS, KEY_DEVICE_ID).is_none() {
            let id = generate_device_id();
            self.set(NS, KEY_DEVICE_ID, json!(id))?;
        }
        // 设备名每次启动更新(可能 hostname 变了)
        let name = device_name();
        self.set(NS, KEY_DEVICE_NAME, json!(name))?;

        // 确保 recent 列表存在
        if self.get(NS, KEY_RECENT_REPOS).is_none() {
            self.set(NS, KEY_RECENT_REPOS, json!([]))?;
        }

        Ok(())
    }

    /// 设置当前聚焦的仓库路径
    pub fn set_active_repo(&mut self, path: &str) -> Result<()> {
        self.set(NS, KEY_ACTIVE_REPO, json!(path))?;
        self.add_recent_repo(path)?;
        Ok(())
    }

    /// 获取当前聚焦的仓库路径
    pub fn active_repo(&self) -> Option<String> {
        self.get(NS, KEY_ACTIVE_REPO)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    /// 添加到最近仓库列表(去重,最新在前,限制长度)
    fn add_recent_repo(&mut self, path: &str) -> Result<()> {
        let mut recent: Vec<String> = self
            .get(NS, KEY_RECENT_REPOS)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        // 去重:移除已有的相同路径
        recent.retain(|p| p != path);
        // 插入到最前
        recent.insert(0, path.to_string());
        // 限制长度
        recent.truncate(MAX_RECENT);

        self.set(NS, KEY_RECENT_REPOS, json!(recent))?;
        Ok(())
    }

    /// 获取最近仓库列表
    pub fn recent_repos(&self) -> Vec<String> {
        self.get(NS, KEY_RECENT_REPOS)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }

    /// 获取设备 ID
    pub fn device_id(&self) -> Option<String> {
        self.get(NS, KEY_DEVICE_ID)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    /// 获取设备名
    pub fn device_name(&self) -> Option<String> {
        self.get(NS, KEY_DEVICE_NAME)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }
}
