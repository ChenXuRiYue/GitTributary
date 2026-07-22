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

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::error::{Result, StoreError};
use super::namespace::{Namespace, Visibility};
use super::record::Record;
use super::store::Store;

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

    fn ensure_token_auth_url(url: &str) -> Result<()> {
        if url.starts_with("https://") {
            return Ok(());
        }

        Err(StoreError::Internal(
            "数据中心配置仓库只支持 HTTPS URL + 明确 Access Token,不能使用 SSH 或系统凭据"
                .to_string(),
        ))
    }

    fn token_callbacks(auth: &ConfigRepoAuth<'_>) -> git2::RemoteCallbacks<'static> {
        let token = auth.token.to_string();
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(move |_url, _username_from_url, _allowed_types| {
            git2::Cred::userpass_plaintext("x-access-token", &token)
        });
        callbacks
    }

    fn origin_remote<'repo>(
        repo: &'repo git2::Repository,
        url: &str,
    ) -> Result<git2::Remote<'repo>> {
        if let Ok(remote) = repo.find_remote("origin") {
            if remote.url() == Some(url) {
                return Ok(remote);
            }
            drop(remote);
            repo.remote_set_url("origin", url)
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            return repo
                .find_remote("origin")
                .map_err(|e| StoreError::Internal(e.message().to_string()));
        }

        repo.remote("origin", url)
            .map_err(|e| StoreError::Internal(e.message().to_string()))
    }

    /// 幂等写入 checkout 的 `.gitignore`(安全网:private 永不进入配置数据库)。
    fn write_checkout_gitignore(checkout: &Path) -> Result<()> {
        let path = checkout.join(".gitignore");
        let content = "# 配置数据库只承载 public 同步数据,private 永不进入(安全网)\n\
private.*.jsonl\n\
secrets.jsonl\n";
        fs::write(path, content)?;
        Ok(())
    }

    /// 确保配置数据库已经 clone 到本地工作副本。
    ///
    /// 配置绑定后就应该落地这个 checkout;后续 pull/import/export/commit/push 都围绕它进行。
    /// 注意:只负责"确保存在并 origin 正确";fetch/ff 归 `pull`。
    pub fn ensure_config_repo(&self, auth: &ConfigRepoAuth<'_>) -> Result<PathBuf> {
        let config = self
            .config()?
            .ok_or_else(|| StoreError::Internal("未配置同步远程仓库".to_string()))?;
        Self::ensure_token_auth_url(&config.url)?;
        let checkout = self.config_repo_path(&config);
        let git_dir = checkout.join(".git");

        if !git_dir.exists() {
            // 目录已存在但非 git 仓库 → 报错,避免覆盖用户数据
            if checkout.exists() {
                let mut entries = fs::read_dir(&checkout)?;
                if entries.next().transpose()?.is_some() {
                    return Err(StoreError::Internal(format!(
                        "配置数据库工作副本目录已存在但不是 Git 仓库: {}",
                        checkout.display()
                    )));
                }
            }

            fs::create_dir_all(checkout.parent().unwrap_or(&self.base_dir))?;
            let mut fetch_opts = git2::FetchOptions::new();
            fetch_opts.remote_callbacks(Self::token_callbacks(auth));
            let mut builder = git2::build::RepoBuilder::new();
            builder.fetch_options(fetch_opts);
            builder.branch(&config.branch);
            match builder.clone(&config.url, &checkout) {
                Ok(_) => {}
                Err(e) => {
                    // 空远程(无提交)无法 clone;回退为本地 init + 登记 origin,
                    // 首次 commit/push 时建立初始提交。
                    if checkout.join(".git").exists() {
                        return Err(StoreError::Internal(format!(
                            "拉取配置数据库失败: {}",
                            e.message()
                        )));
                    }
                    if checkout.exists() {
                        let _ = fs::remove_dir_all(&checkout);
                    }
                    fs::create_dir_all(&checkout)?;
                    let repo = git2::Repository::init(&checkout).map_err(|e| {
                        StoreError::Internal(format!("初始化配置数据库失败: {}", e.message()))
                    })?;
                    // 对齐到配置分支:git 默认 HEAD 可能是 master,而配置要求(例如)main。
                    // 不对齐会导致 commit 落在 master、push 推 refs/heads/main 失败。
                    let refname = format!("refs/heads/{}", config.branch);
                    repo.set_head(&refname).map_err(|e| {
                        StoreError::Internal(format!("设置初始分支失败: {}", e.message()))
                    })?;
                    let _ = Self::origin_remote(&repo, &config.url)?;
                }
            }
        } else {
            // 已存在:校正 origin URL。若仍处于首次未提交状态(unborn HEAD),
            // 顺带把 HEAD 对齐到配置分支——历史上 init 回退可能用了 git 默认分支
            // (如 master)与配置(如 main)不一致,有提交后再改就危险,故只在
            // unborn 时修正。
            let repo = git2::Repository::open(&checkout).map_err(|e| {
                StoreError::Internal(format!("打开配置数据库失败: {}", e.message()))
            })?;
            let _ = Self::origin_remote(&repo, &config.url)?;
            if repo.head().is_err() {
                let refname = format!("refs/heads/{}", config.branch);
                repo.set_head(&refname).map_err(|e| {
                    StoreError::Internal(format!("对齐初始分支失败: {}", e.message()))
                })?;
            }
        }

        Self::write_checkout_gitignore(&checkout)?;
        // 确保环境目录存在
        let env_data = self.environment_dir(&config, &checkout, "data");
        let env_profiles = self.environment_dir(&config, &checkout, "profiles");
        fs::create_dir_all(&env_data)?;
        fs::create_dir_all(&env_profiles)?;

        Ok(checkout)
    }

    /// 暂存 environments/ + .gitignore 并创建 commit。无变更返回 None。
    pub fn commit(&self, device_id: &str, checkout: &Path) -> Result<Option<String>> {
        let repo = git2::Repository::open(checkout)
            .map_err(|e| StoreError::Internal(format!("打开配置数据库失败: {}", e.message())))?;

        let mut index = repo
            .index()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let paths = ["environments", ".gitignore"];
        index
            .add_all(paths.iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        index
            .update_all(paths.iter(), None)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        index
            .write()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let tree_oid = index
            .write_tree()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let tree = repo
            .find_tree(tree_oid)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        // 无变更判断
        if let Ok(head) = repo.head() {
            if let Ok(head_commit) = head.peel_to_commit() {
                if head_commit.tree().map(|t| t.id()).ok() == Some(tree_oid) {
                    return Ok(None);
                }
            }
        }

        let sig = repo
            .signature()
            .or_else(|_| git2::Signature::now("GitTributary", "sync@git-tributary"))
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        let parents: Vec<git2::Commit> = if let Ok(head) = repo.head() {
            head.peel_to_commit().map(|c| vec![c]).unwrap_or_default()
        } else {
            vec![]
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        let now = Utc::now().format("%Y-%m-%d %H:%M").to_string();
        let message = format!("sync: {} {}", device_id, now);

        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        self.set_state(&SyncState {
            last_sync: Some(Utc::now().to_rfc3339()),
            last_commit: Some(oid.to_string()),
            device_id: Some(device_id.to_string()),
        })?;

        Ok(Some(oid.to_string()))
    }

    /// 从远程拉取并 fast-forward 合并到 checkout。非 ff 返回错误(M1 不合并)。
    pub fn pull(&self, auth: &ConfigRepoAuth<'_>, checkout: &Path) -> Result<()> {
        let config = self
            .config()?
            .ok_or_else(|| StoreError::Internal("未配置同步远程仓库".to_string()))?;
        Self::ensure_token_auth_url(&config.url)?;

        let repo = git2::Repository::open(checkout)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let mut remote = Self::origin_remote(&repo, &config.url)?;

        // 空远程(首次同步,远端尚无任何提交):视为 no-op,让后续 export/commit/push
        // 建立首个提交。否则 fetch 一个不存在的 ref 会报错并中断整个 sync_now,
        // 导致 export 永不执行、checkout 永远没内容。
        let empty_remote = {
            let callbacks = Self::token_callbacks(auth);
            match remote.connect_auth(git2::Direction::Fetch, Some(callbacks), None) {
                Ok(conn) => conn.list().map(|heads| heads.is_empty()).unwrap_or(false),
                // 连接失败不阻断,交给下方 fetch 报出可读的具体错误
                Err(_) => false,
            }
        };
        if empty_remote {
            return Ok(());
        }

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(Self::token_callbacks(auth));
        remote
            .fetch(&[&config.branch], Some(&mut fetch_opts), None)
            .map_err(|e| StoreError::Internal(format!("拉取失败: {}", e.message())))?;

        let fetch_head = repo
            .find_reference("FETCH_HEAD")
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let fetch_commit = fetch_head
            .peel_to_commit()
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        // 无 HEAD(空仓库,首次 clone 回退路径):直接建立分支指向 fetch_commit。
        let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        if head_commit.is_none() {
            let refname = format!("refs/heads/{}", config.branch);
            repo.reference(&refname, fetch_commit.id(), true, "sync: initial branch")
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            repo.set_head(&refname)
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            return Ok(());
        }

        let annotated = repo
            .find_annotated_commit(fetch_commit.id())
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let analysis = repo
            .merge_analysis(&[&annotated])
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;

        if analysis.0.is_fast_forward() {
            let refname = format!("refs/heads/{}", config.branch);
            let mut reference = repo
                .find_reference(&refname)
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            reference
                .set_target(fetch_commit.id(), "sync: fast-forward pull")
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            repo.set_head(&refname)
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
                .map_err(|e| StoreError::Internal(e.message().to_string()))?;
            return Ok(());
        }

        // 非 fast-forward:up to date 也视为成功(无新提交)
        if analysis.0.is_up_to_date() {
            return Ok(());
        }

        Err(StoreError::Internal(
            "远程配置数据库与本地存在分叉,M1 暂不支持合并,请手动处理后再同步".to_string(),
        ))
    }

    /// 推送 checkout 到远程。
    pub fn push(&self, auth: &ConfigRepoAuth<'_>, checkout: &Path) -> Result<()> {
        let config = self
            .config()?
            .ok_or_else(|| StoreError::Internal("未配置同步远程仓库".to_string()))?;
        Self::ensure_token_auth_url(&config.url)?;

        let repo = git2::Repository::open(checkout)
            .map_err(|e| StoreError::Internal(e.message().to_string()))?;
        let mut remote = Self::origin_remote(&repo, &config.url)?;

        let refspec = format!("refs/heads/{}:refs/heads/{}", config.branch, config.branch);
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(Self::token_callbacks(auth));

        remote
            .push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| StoreError::Internal(format!("推送失败: {}", e.message())))?;

        Ok(())
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
