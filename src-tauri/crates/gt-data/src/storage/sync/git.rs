use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use super::{ConfigRepoAuth, SyncEngine, SyncState};
use crate::storage::error::{Result, StoreError};

impl SyncEngine {
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

        let empty_remote = {
            let callbacks = Self::token_callbacks(auth);
            match remote.connect_auth(git2::Direction::Fetch, Some(callbacks), None) {
                Ok(conn) => conn.list().map(|heads| heads.is_empty()).unwrap_or(false),
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
}
