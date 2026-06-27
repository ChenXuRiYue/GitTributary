//! 工作区(workspace)命名空间管理:
//! - 当前聚焦的 Git 仓库
//! - 当前聚焦分支
//! - 最近打开的仓库列表
//! - 当前设备信息

use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::error::Result;
use crate::store::Store;

const NS: &str = "workspace";
const KEY_ACTIVE_REPO: &str = "repo.active";
const KEY_ACTIVE_BRANCH: &str = "repo.branch";
const KEY_RECENT_REPOS: &str = "repo.recent";
const KEY_BOUND_REPOS: &str = "repo.bound";
const KEY_DEVICE_ID: &str = "device.id";
const KEY_DEVICE_NAME: &str = "device.name";

const MAX_RECENT: usize = 10;

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

fn device_name() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

impl Store {
    /// 初始化 workspace 命名空间(应用启动时调用)
    pub fn init_workspace(&mut self) -> Result<()> {
        if self.get(NS, KEY_DEVICE_ID).is_none() {
            let id = generate_device_id();
            self.set(NS, KEY_DEVICE_ID, json!(id))?;
        }
        let name = device_name();
        self.set(NS, KEY_DEVICE_NAME, json!(name))?;
        if self.get(NS, KEY_RECENT_REPOS).is_none() {
            self.set(NS, KEY_RECENT_REPOS, json!([]))?;
        }
        if self.get(NS, KEY_BOUND_REPOS).is_none() {
            self.set(NS, KEY_BOUND_REPOS, json!([]))?;
        }
        // 默认分支为 main
        if self.get(NS, KEY_ACTIVE_BRANCH).is_none() {
            self.set(NS, KEY_ACTIVE_BRANCH, json!("main"))?;
        }
        Ok(())
    }

    // ─── 统一状态同步函数(核心:一个函数同步所有 workspace 状态) ───

    /// 同步工作区状态到 store。
    /// 由 Tauri command 层在操作完成后统一调用,不需要每个 command 手写多条 set。
    pub fn sync_workspace(&mut self, repo_path: Option<&str>, branch: Option<&str>) -> Result<()> {
        if let Some(path) = repo_path {
            self.set(NS, KEY_ACTIVE_REPO, json!(path))?;
            self.add_recent_repo(path)?;
        }
        if let Some(b) = branch {
            self.set(NS, KEY_ACTIVE_BRANCH, json!(b))?;
        }
        Ok(())
    }

    // ─── 读取接口 ────────────────────────────────────────────────

    pub fn active_repo(&self) -> Option<String> {
        self.get(NS, KEY_ACTIVE_REPO)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    pub fn active_branch(&self) -> Option<String> {
        self.get(NS, KEY_ACTIVE_BRANCH)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    pub fn recent_repos(&self) -> Vec<String> {
        self.get(NS, KEY_RECENT_REPOS)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }

    pub fn bound_repos(&self) -> Vec<String> {
        self.get(NS, KEY_BOUND_REPOS)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }

    pub fn device_id(&self) -> Option<String> {
        self.get(NS, KEY_DEVICE_ID)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    pub fn device_name(&self) -> Option<String> {
        self.get(NS, KEY_DEVICE_NAME)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    // ─── 内部 ─────────────────────────────────────────────────────

    pub fn set_active_repo(&mut self, path: &str) -> Result<()> {
        self.set(NS, KEY_ACTIVE_REPO, json!(path))?;
        self.add_recent_repo(path)?;
        Ok(())
    }

    pub fn bind_repo(&mut self, path: &str) -> Result<()> {
        self.add_bound_repo(path)
    }

    pub fn unbind_repo(&mut self, path: &str) -> Result<()> {
        let mut bound = self.bound_repos();
        bound.retain(|p| p != path);
        self.set(NS, KEY_BOUND_REPOS, json!(bound))?;
        Ok(())
    }

    fn add_recent_repo(&mut self, path: &str) -> Result<()> {
        let mut recent: Vec<String> = self
            .get(NS, KEY_RECENT_REPOS)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        recent.retain(|p| p != path);
        recent.insert(0, path.to_string());
        recent.truncate(MAX_RECENT);
        self.set(NS, KEY_RECENT_REPOS, json!(recent))?;
        Ok(())
    }

    fn add_bound_repo(&mut self, path: &str) -> Result<()> {
        let mut bound = self.bound_repos();
        if !bound.iter().any(|p| p == path) {
            bound.push(path.to_string());
        }
        self.set(NS, KEY_BOUND_REPOS, json!(bound))?;
        Ok(())
    }
}
