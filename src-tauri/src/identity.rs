//! Commit identity(用户名/邮箱)解析。
//!
//! 优先级:某个远程的显式覆盖配置 > 全局 Git 凭证配置 > 应用默认值
//! ("GitTributary" / "gittributary@local")。
//!
//! 这里同时需要 `gt-data`(凭证/覆盖配置)和 `gt-git`
//! 的 `CommitIdentity` 类型,因此和 `auth.rs` 一样属于胶水层职责。

use gt_data::{DataHub, RemoteCommitIdentity};
use gt_git::{CommitIdentity, GitRepo};

use crate::AppState;

/// 某个仓库 + 某个远程的 commit identity 覆盖配置(用户显式设置的)。
pub(crate) type RemoteCommitIdentityConfig = RemoteCommitIdentity;

/// 读取某个仓库 + 远程的显式覆盖配置(如果用户设置过)。
pub(crate) fn remote_commit_identity_config(
    data: &DataHub,
    repo_path: &str,
    remote_name: &str,
) -> Option<RemoteCommitIdentityConfig> {
    data.remote_metadata()
        .commit_identity(repo_path, remote_name)
        .ok()
        .flatten()
}

/// 从全局 Git 凭证配置(`git.username` / `git.email`)取默认 identity。
pub(crate) fn default_commit_identity_config(data: &DataHub) -> RemoteCommitIdentityConfig {
    let credentials = data.credentials().summary();
    RemoteCommitIdentityConfig {
        name: credentials
            .username
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        email: credentials
            .email
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    }
}

/// 把"可能存在的远程覆盖配置"落地为一个必定完整的 `CommitIdentity`,
/// 覆盖配置 > 全局默认 > 应用兜底值。
pub(crate) fn fallback_commit_identity(
    state: &AppState,
    remote_identity: Option<RemoteCommitIdentityConfig>,
) -> CommitIdentity {
    let store = state.data.lock().unwrap();
    let default_identity = default_commit_identity_config(&store);
    CommitIdentity {
        name: remote_identity
            .as_ref()
            .and_then(|identity| identity.name.clone())
            .or(default_identity.name)
            .unwrap_or_else(|| "GitTributary".to_string()),
        email: remote_identity
            .as_ref()
            .and_then(|identity| identity.email.clone())
            .or(default_identity.email)
            .unwrap_or_else(|| "gittributary@local".to_string()),
    }
}

/// 一个仓库有多个远程时,优先用 `origin` 做 commit identity 判断的依据,
/// 否则用第一个远程;没有远程时返回 `None`。
pub(crate) fn preferred_commit_remote(repo: &GitRepo) -> Option<String> {
    let remotes = repo.remotes().ok()?;
    if remotes.iter().any(|remote| remote.name == "origin") {
        return Some("origin".to_string());
    }
    remotes.first().map(|remote| remote.name.clone())
}

/// 组合入口:给定仓库路径 + (可选)远程名,解析出最终要用的 commit identity。
pub(crate) fn commit_identity_for_repo_remote(
    state: &AppState,
    repo_path: &str,
    remote_name: Option<&str>,
) -> CommitIdentity {
    let remote_identity = {
        let store = state.data.lock().unwrap();
        remote_name.and_then(|remote| remote_commit_identity_config(&store, repo_path, remote))
    };
    fallback_commit_identity(state, remote_identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_store() -> (TempDir, DataHub) {
        let dir = TempDir::new().unwrap();
        let data = DataHub::open(dir.path()).unwrap();
        (dir, data)
    }

    fn temp_app_state() -> (TempDir, AppState) {
        let (dir, store) = temp_store();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            data: std::sync::Mutex::new(store.into()),
            event_pool: std::sync::Mutex::new(gt_flow::EventPool::new()),
            node_registry: std::sync::Mutex::new(gt_flow::FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: crate::extensions::ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(crate::plugin_host::PluginHostSupervisor::default()),
        };
        (dir, state)
    }

    fn init_repo_with_commit(dir: &std::path::Path) -> GitRepo {
        let repo = GitRepo::init(dir).unwrap();
        std::fs::write(dir.join("README.md"), "# hi\n").unwrap();
        repo.stage_all().unwrap();
        repo.commit("init: first commit").unwrap();
        repo
    }

    #[test]
    fn default_commit_identity_config_reads_from_git_credentials() {
        let (_dir, mut store) = temp_store();
        store
            .settings_mut()
            .set(gt_data::setting_keys::GIT_USERNAME, "Alice".to_string())
            .unwrap();
        store
            .settings_mut()
            .set(
                gt_data::setting_keys::GIT_EMAIL,
                "alice@example.com".to_string(),
            )
            .unwrap();
        let identity = default_commit_identity_config(&store);
        assert_eq!(identity.name, Some("Alice".to_string()));
        assert_eq!(identity.email, Some("alice@example.com".to_string()));
    }

    #[test]
    fn fallback_commit_identity_uses_app_defaults_when_nothing_configured() {
        let (_dir, state) = temp_app_state();
        let identity = fallback_commit_identity(&state, None);
        assert_eq!(identity.name, "GitTributary");
        assert_eq!(identity.email, "gittributary@local");
    }

    #[test]
    fn fallback_commit_identity_prefers_remote_identity_over_defaults() {
        let (_dir, state) = temp_app_state();
        {
            let mut store = state.data.lock().unwrap();
            store
                .settings_mut()
                .set(gt_data::setting_keys::GIT_USERNAME, "Alice".to_string())
                .unwrap();
        }
        let remote_identity = RemoteCommitIdentityConfig {
            name: Some("Bob".to_string()),
            email: None,
        };
        let identity = fallback_commit_identity(&state, Some(remote_identity));
        assert_eq!(identity.name, "Bob");
    }

    #[test]
    fn preferred_commit_remote_prefers_origin() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(dir.path());
        repo.add_remote("origin", "https://github.com/a/b.git")
            .unwrap();
        repo.add_remote("upstream", "https://github.com/c/d.git")
            .unwrap();
        assert_eq!(preferred_commit_remote(&repo), Some("origin".to_string()));
    }

    #[test]
    fn preferred_commit_remote_falls_back_to_first_remote() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(dir.path());
        repo.add_remote("upstream", "https://github.com/c/d.git")
            .unwrap();
        assert_eq!(preferred_commit_remote(&repo), Some("upstream".to_string()));
    }

    #[test]
    fn preferred_commit_remote_none_when_no_remotes() {
        let dir = TempDir::new().unwrap();
        let repo = init_repo_with_commit(dir.path());
        assert_eq!(preferred_commit_remote(&repo), None);
    }
}
