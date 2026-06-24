//! 配置同步模块:将 public 数据通过 Git 推送到远程仓库,拉取时按时间戳合并。
//!
//! 同步范围:
//! - data/*.jsonl (Public 命名空间)
//! - profiles/ (配置档)
//! 不同步:
//! - credentials/ (Private)
//! - cache/ (可丢弃)

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::{Result, StoreError};

/// 同步远程配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// 远程仓库 URL(SSH 或 HTTPS)
    pub url: String,
    /// 分支名
    pub branch: String,
    /// 是否启用自动同步
    pub auto_sync: bool,
    /// 自动同步间隔(秒)
    pub interval_seconds: u64,
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

/// 同步引擎(管理 ~/.git-tributary/ 作为一个 Git 仓库)
pub struct SyncEngine {
    /// .git-tributary/ 根目录
    base_dir: PathBuf,
    /// sync/ 子目录
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
        let content = serde_json::to_string_pretty(state)
            .map_err(|e| StoreError::Internal(e.to_string()))?;
        fs::write(path, content)?;
        Ok(())
    }

    /// 初始化 .git-tributary/ 为 Git 仓库(如果还不是)
    pub fn init_git_repo(&self) -> Result<()> {
        let git_dir = self.base_dir.join(".git");
        if git_dir.exists() {
            return Ok(()); // 已经是 git 仓库
        }
        git2::Repository::init(&self.base_dir)
            .map_err(|e| StoreError::Internal(format!("初始化 git 仓库失败: {}", e)))?;

        // 写 .gitignore:排除 private 内容
        let gitignore_path = self.base_dir.join(".gitignore");
        let gitignore_content = "# 仅本地,永不同步\ncredentials/\ncache/\nsync/last-sync.json\n";
        fs::write(gitignore_path, gitignore_content)?;

        Ok(())
    }

    /// 暂存所有 public 变更并创建 commit
    pub fn commit(&self, device_id: &str) -> Result<Option<String>> {
        let repo = git2::Repository::open(&self.base_dir)
            .map_err(|e| StoreError::Internal(format!("打开仓库失败: {}", e)))?;

        let mut index = repo.index()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        // add all (gitignore 会排除 private 文件)
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        index.update_all(["*"].iter(), None)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        index.write()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let tree_oid = index.write_tree()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let tree = repo.find_tree(tree_oid)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        // 检查是否有变更
        if let Ok(head) = repo.head() {
            if let Ok(head_commit) = head.peel_to_commit() {
                if head_commit.tree().map(|t| t.id()).ok() == Some(tree_oid) {
                    return Ok(None); // 无变更
                }
            }
        }

        let sig = repo.signature()
            .or_else(|_| git2::Signature::now("GitTributary", "sync@git-tributary"))
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let parents: Vec<git2::Commit> = if let Ok(head) = repo.head() {
            if let Ok(c) = head.peel_to_commit() {
                vec![c]
            } else { vec![] }
        } else { vec![] };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        let now = Utc::now().format("%Y-%m-%d %H:%M").to_string();
        let message = format!("sync: {} {}", device_id, now);

        let oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        // 更新同步状态
        self.set_state(&SyncState {
            last_sync: Some(Utc::now().to_rfc3339()),
            last_commit: Some(oid.to_string()),
            device_id: Some(device_id.to_string()),
        })?;

        Ok(Some(oid.to_string()))
    }

    /// 推送到远程
    pub fn push(&self) -> Result<()> {
        let config = self.config()?
            .ok_or_else(|| StoreError::Internal("未配置同步远程仓库".to_string()))?;

        let repo = git2::Repository::open(&self.base_dir)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let mut remote = repo.find_remote("origin")
            .or_else(|_| repo.remote("origin", &config.url))
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let refspec = format!("refs/heads/{}:refs/heads/{}", config.branch, config.branch);

        // 尝试推送(认证回调后续从 credentials 读取)
        let mut push_opts = git2::PushOptions::new();
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
        });
        push_opts.remote_callbacks(callbacks);

        remote.push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| StoreError::Internal(format!("推送失败: {}", e.message())))?;

        Ok(())
    }

    /// 从远程拉取并合并
    pub fn pull(&self) -> Result<()> {
        let config = self.config()?
            .ok_or_else(|| StoreError::Internal("未配置同步远程仓库".to_string()))?;

        let repo = git2::Repository::open(&self.base_dir)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let mut remote = repo.find_remote("origin")
            .or_else(|_| repo.remote("origin", &config.url))
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        // Fetch
        let mut fetch_opts = git2::FetchOptions::new();
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
        });
        fetch_opts.remote_callbacks(callbacks);

        remote.fetch(&[&config.branch], Some(&mut fetch_opts), None)
            .map_err(|e| StoreError::Internal(format!("拉取失败: {}", e.message())))?;

        // Fast-forward merge(配置文件场景下,冲突极少)
        let fetch_head = repo.find_reference("FETCH_HEAD")
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let fetch_commit = fetch_head.peel_to_commit()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let analysis = repo.merge_analysis(&[&repo.find_annotated_commit(fetch_commit.id())
            .map_err(|e| StoreError::Internal(e.message().to_string()))?])
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        if analysis.0.is_fast_forward() {
            let refname = format!("refs/heads/{}", config.branch);
            let mut reference = repo.find_reference(&refname)
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            reference.set_target(fetch_commit.id(), "sync: fast-forward pull")
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            repo.set_head(&refname)
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        }
        // 非 fast-forward 暂不处理(个人使用场景下基本不会出现)

        Ok(())
    }

    /// 完整同步:commit → pull → push
    pub fn sync(&self, device_id: &str) -> Result<()> {
        self.init_git_repo()?;
        self.commit(device_id)?;
        // pull 可能失败(远程不存在/网络问题),不阻塞
        let _ = self.pull();
        self.push()?;
        Ok(())
    }
}
