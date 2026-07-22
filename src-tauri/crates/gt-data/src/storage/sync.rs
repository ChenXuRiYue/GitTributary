//! 配置同步模块:将 public 数据通过 Git 推送到远程配置数据库,拉取时按时间戳合并。
//!
//! 同步范围:
//!
//! - data/*.jsonl (Public 命名空间)
//! - profiles/ (配置档,Phase 1 暂不同步)
//!
//! 不同步:
//!
//! - credentials / private.* (Private 命名空间,永不离开本机)
//!
//! ## Phase 1:传输模型
//!
//! Store 本体仍在 `~/.git-tributary/data/`;远程配置数据库 clone 到
//! `~/.git-tributary/databases/<repo>-<hash>/` 作为 git worktree。sync 时:
//!
//! 1. pull(ff)更新 checkout
//! 2. import:checkout `environments/<env>/data/` → 本地 Store(LWW 按时间戳)
//! 3. export:本地 public 命名空间 → checkout `environments/<env>/data/`
//! 4. commit + push(在 checkout 上执行 git 操作)
//!
//! checkout 不是缓存,是配置数据库的本体工作区;删了等于丢数据。
//! Phase 2 将改为 re-root:Store public data_dir 直接指向 checkout env 目录。

use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::error::{Result, StoreError};
use super::namespace::{Namespace, Visibility};
use super::record::Record;
use super::store::Store;

mod git;

/// 配置数据库在 checkout 内的数据子目录(按环境隔离)。
const ENV_ROOT: &str = "environments";

/// 同步远程配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// 远程仓库 URL(配置数据库仅允许 HTTPS + 显式 Access Token)
    pub url: String,
    /// 分支名
    pub branch: String,
    /// 当前同步的数据空间环境,例如 test/staging/prod
    #[serde(default)]
    pub active_environment_id: Option<String>,
    /// 配置数据库在本机的工作副本路径(后端计算返回,前端只读)。
    #[serde(default, alias = "local_cache_path")]
    pub local_database_path: Option<PathBuf>,
    /// 是否启用自动同步
    pub auto_sync: bool,
    /// 自动同步间隔(秒)
    pub interval_seconds: u64,
}

/// 配置数据库认证。当前只允许显式 Access Token。
pub struct ConfigRepoAuth<'a> {
    pub token: &'a str,
}

/// 上次同步状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    /// 上次同步时间(ISO 8601)
    pub last_sync: Option<String>,
    /// 上次同步的 commit SHA
    pub last_commit: Option<String>,
    /// 设备 ID(标记是哪台机器同步的)
    pub device_id: Option<String>,
}

/// 同步引擎(管理 `~/.git-tributary/` 与 `databases/<id>/` checkout)
pub struct SyncEngine {
    /// .git-tributary/ 根目录
    base_dir: PathBuf,
    /// sync/ 子目录(本地状态,不同步)
    sync_dir: PathBuf,
}

impl SyncEngine {
    pub fn new(base_dir: &Path) -> Self {
        let sync_dir = base_dir.join("sync");
        Self {
            base_dir: base_dir.to_path_buf(),
            sync_dir,
        }
    }

    /// 初始化同步目录
    pub fn init(&self) -> Result<()> {
        fs::create_dir_all(&self.sync_dir)?;
        Ok(())
    }

    /// 读取同步配置
    pub fn config(&self) -> Result<Option<SyncConfig>> {
        let path = self.sync_dir.join("remote.json");
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        let config: SyncConfig = serde_json::from_str(&content)
            .map_err(|e| StoreError::Internal(format!("解析 sync config 失败: {}", e)))?;
        Ok(Some(config))
    }

    /// 保存同步配置
    pub fn set_config(&self, config: &SyncConfig) -> Result<()> {
        fs::create_dir_all(&self.sync_dir)?;
        let path = self.sync_dir.join("remote.json");
        let content = serde_json::to_string_pretty(config)
            .map_err(|e| StoreError::Internal(e.to_string()))?;
        fs::write(path, content)?;
        Ok(())
    }

    /// 清除同步远程配置。
    pub fn clear_config(&self) -> Result<()> {
        let path = self.sync_dir.join("remote.json");
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// 读取上次同步状态
    pub fn state(&self) -> Result<SyncState> {
        let path = self.sync_dir.join("last-sync.json");
        if !path.exists() {
            return Ok(SyncState {
                last_sync: None,
                last_commit: None,
                device_id: None,
            });
        }
        let content = fs::read_to_string(&path)?;
        let state: SyncState = serde_json::from_str(&content)
            .map_err(|e| StoreError::Internal(format!("解析 sync state 失败: {}", e)))?;
        Ok(state)
    }

    /// 保存同步状态
    pub fn set_state(&self, state: &SyncState) -> Result<()> {
        let path = self.sync_dir.join("last-sync.json");
        let content =
            serde_json::to_string_pretty(state).map_err(|e| StoreError::Internal(e.to_string()))?;
        fs::write(path, content)?;
        Ok(())
    }

    /// 配置数据库在本机的工作副本目录。
    ///
    /// 由数据中心分配和管理;Git 模块只在被传入路径时执行仓库原语。
    /// 注意:这是配置数据库本体,不是可丢弃缓存。
    pub fn config_repo_path(&self, config: &SyncConfig) -> PathBuf {
        if let Some(path) = config.local_database_path.as_ref() {
            return path.clone();
        }

        let mut hasher = DefaultHasher::new();
        config.url.hash(&mut hasher);
        let repo_name = config
            .url
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("config-repo");
        let id = format!("{}-{:016x}", repo_name, hasher.finish());
        self.base_dir.join("databases").join(id)
    }

    /// 当前环境 ID(未设置时默认 "default")。
    pub fn active_environment(config: &SyncConfig) -> String {
        config
            .active_environment_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "default".to_string())
    }

    /// checkout 内某环境的子目录。kind: "data" | "profiles" | "sync"
    pub fn environment_dir(&self, config: &SyncConfig, checkout: &Path, kind: &str) -> PathBuf {
        checkout
            .join(ENV_ROOT)
            .join(Self::active_environment(config))
            .join(kind)
    }

    // ─── export / import(Store ↔ checkout 之间搬运 public 数据) ───────

    /// 将本地 public 命名空间快照写入 checkout 的 `environments/<env>/data/`。
    ///
    /// 每个 ns 写一份截断的 JSONL,每行一条 Record,保留原始 t(不用 compact,
    /// 因为 compact 会用 now 覆盖 t,破坏跨端 LWW)。private 命名空间不写。
    pub fn export_public_to_checkout(&self, store: &Store, checkout: &Path) -> Result<()> {
        let config = self
            .config()?
            .ok_or_else(|| StoreError::Internal("未配置同步远程仓库".to_string()))?;
        let env_data = self.environment_dir(&config, checkout, "data");
        fs::create_dir_all(&env_data)?;

        let syncable = store.syncable_namespaces();
        // Remove snapshots that became local/secret so they cannot be committed again.
        if let Ok(entries) = fs::read_dir(&env_data) {
            for entry in entries {
                let path = entry?.path();
                let Some(ns_name) = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .and_then(|name| name.strip_suffix(".jsonl"))
                else {
                    continue;
                };
                if !syncable.iter().any(|name| name == ns_name) {
                    fs::remove_file(path)?;
                }
            }
        }

        for ns_name in syncable {
            let latest = store.latest_with_ts(&ns_name);
            let target = env_data.join(format!("{}.jsonl", ns_name));
            let mut file = File::create(&target)?;
            for (k, (v, t)) in latest {
                let record = Record { k, v, t };
                let mut line = serde_json::to_string(&record)?;
                line.push('\n');
                file.write_all(line.as_bytes())?;
            }
        }
        Ok(())
    }

    /// 从 checkout 的 `environments/<env>/data/` 读取并 LWW 合并进本地 Store。
    ///
    /// 对每条 (k, v, t):若 t >= 本地最新 t 则写入(set_with_ts 保留远端 t);
    /// v=null 视为删除。private 命名空间一律跳过(安全网)。
    pub fn import_public_from_checkout(&self, store: &mut Store, checkout: &Path) -> Result<()> {
        let config = self
            .config()?
            .ok_or_else(|| StoreError::Internal("未配置同步远程仓库".to_string()))?;
        let env_data = self.environment_dir(&config, checkout, "data");
        if !env_data.exists() {
            return Ok(());
        }

        for entry in fs::read_dir(&env_data)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                let ns_name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                // 安全网:checkout 不应含 private,但防御性跳过
                if !store.namespace_policy(&ns_name).sync.is_syncable() {
                    continue;
                }
                let remote_ns = Namespace::open(&env_data, &ns_name, Visibility::Public)?;
                let remote_latest = remote_ns.latest_with_ts();
                let local_latest = store.latest_with_ts(&ns_name);
                for (k, (v, t)) in remote_latest {
                    let local_t = local_latest.get(&k).map(|(_, lt)| *lt).unwrap_or(i64::MIN);
                    if t < local_t {
                        continue;
                    }
                    if v.is_null() {
                        let _ = store.delete(&ns_name, &k);
                    } else {
                        store.set_with_ts(&ns_name, &k, v, t)?;
                    }
                }
            }
        }
        Ok(())
    }
}
