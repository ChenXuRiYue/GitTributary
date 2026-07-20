//! Git 认证解析。
//!
//! 这段逻辑同时需要知道 `gt-store` 的凭证存储结构(项目级 token 存哪个 key、
//! 全局 token、SSH key 配置)和 `gt-git` 的认证接口(`AuthMethod`),
//! 因此天然只能待在胶水层:既不该让 `gt-git` 关心凭证存在哪里,
//! 也不该让 `gt-store` 关心怎么用凭证做 Git 认证。
//!
//! 优先级链(项目 token → 全局 token → SSH key → SSH agent → None)
//! 目前在 `resolve_auth` / `resolve_auth_for_publish_target` /
//! `credential_summary_for_remote` 三处独立实现,是已知的重复,
//! 后续如果认证策略变复杂,值得抽成一个共享的决策函数。这次重构
//! 只做“搬文件”,不改变这三处各自的行为。

use gt_git::AuthMethod;
use gt_store::Store;

use crate::keys::project_token_key_for_path;
use crate::AppState;

/// 面向发布目标(Pages 等)的认证解析结果,比 `AuthMethod` 多了
/// 可展示的 `mode` 和 `credential_ref`,用于前端展示"用了哪种凭证"。
#[derive(Debug, Clone)]
pub(crate) struct ResolvedAuth {
    pub(crate) method: AuthMethod,
    pub(crate) mode: String,
    pub(crate) credential_ref: Option<String>,
}

/// 解析认证方式:项目级 token 优先 → 公共级 token → SSH → Agent → None
pub(crate) fn resolve_auth(state: &AppState) -> AuthMethod {
    let store = state.store.lock().unwrap();
    let repo_lock = state.repo.lock().unwrap();

    // 1. 项目级 token(从当前仓库路径对应的 store key)
    if let Some(repo) = repo_lock.as_ref() {
        if let Some(workdir) = repo.workdir() {
            let project_key = format!("project.{}.token", workdir.display());
            if let Some(val) = store.get("private.credentials", &project_key) {
                if let Some(token) = val.as_str() {
                    if !token.is_empty() {
                        return AuthMethod::Token(token.to_string());
                    }
                }
            }
        }
    }

    // 2. 公共级 token
    if let Some(token) = store.get_git_token_raw() {
        if !token.is_empty() {
            return AuthMethod::Token(token);
        }
    }

    // 3. SSH key
    if let Some((key_path, passphrase)) = store.get_git_ssh_key() {
        return AuthMethod::SshKey {
            private_key: key_path,
            passphrase,
        };
    }

    // 4. 尝试 SSH agent
    AuthMethod::Agent
}

pub(crate) fn resolve_auth_for_publish_target(
    state: &AppState,
    repo_path: &std::path::Path,
    remote_url: Option<&str>,
    credential_ref: Option<&str>,
) -> ResolvedAuth {
    let repo_path = repo_path.to_string_lossy().to_string();
    let store = state.store.lock().unwrap();
    let url = remote_url.unwrap_or_default().trim().to_ascii_lowercase();
    let prefers_ssh = url.starts_with("git@") || url.starts_with("ssh://");
    let prefers_https = url.starts_with("http://") || url.starts_with("https://");

    if !prefers_ssh {
        if let Some(credential_ref) = credential_ref.and_then(|value| value.strip_prefix("repo:")) {
            let key = project_token_key_for_path(credential_ref);
            if let Some(val) = store.get("private.credentials", &key) {
                if let Some(token) = val.as_str() {
                    if !token.is_empty() {
                        return ResolvedAuth {
                            method: AuthMethod::Token(token.to_string()),
                            mode: "repo_token".to_string(),
                            credential_ref: Some(format!("repo:{credential_ref}")),
                        };
                    }
                }
            }
        }
        if matches!(credential_ref, Some("global:git.access_token")) {
            if let Some(token) = store.get_git_token_raw() {
                if !token.is_empty() {
                    return ResolvedAuth {
                        method: AuthMethod::Token(token),
                        mode: "app_global_token".to_string(),
                        credential_ref: Some("global:git.access_token".to_string()),
                    };
                }
            }
        }

        let project_key = project_token_key_for_path(&repo_path);
        if let Some(val) = store.get("private.credentials", &project_key) {
            if let Some(token) = val.as_str() {
                if !token.is_empty() {
                    return ResolvedAuth {
                        method: AuthMethod::Token(token.to_string()),
                        mode: "repo_token".to_string(),
                        credential_ref: Some(format!("repo:{repo_path}")),
                    };
                }
            }
        }

        if let Some(token) = store.get_git_token_raw() {
            if !token.is_empty() {
                return ResolvedAuth {
                    method: AuthMethod::Token(token),
                    mode: "app_global_token".to_string(),
                    credential_ref: Some("global:git.access_token".to_string()),
                };
            }
        }
    }

    if let Some((key_path, passphrase)) = store.get_git_ssh_key() {
        return ResolvedAuth {
            method: AuthMethod::SshKey {
                private_key: key_path.clone(),
                passphrase,
            },
            mode: "ssh_key".to_string(),
            credential_ref: Some(format!("ssh:{key_path}")),
        };
    }

    if prefers_https {
        return ResolvedAuth {
            method: AuthMethod::None,
            mode: "system".to_string(),
            credential_ref: Some("system:credential-helper".to_string()),
        };
    }

    ResolvedAuth {
        method: AuthMethod::Agent,
        mode: "ssh_agent".to_string(),
        credential_ref: Some("system:ssh-agent".to_string()),
    }
}

/// 展示用的凭证摘要(不返回明文),用于远程配置聚合视图。
pub(crate) fn credential_summary_for_remote(
    store: &Store,
    workdir: Option<&str>,
    url: &str,
) -> (String, Option<String>) {
    let url = url.trim().to_ascii_lowercase();
    let prefers_ssh = url.starts_with("git@") || url.starts_with("ssh://");

    if !prefers_ssh {
        if let Some(path) = workdir {
            let project_key = project_token_key_for_path(path);
            if let Some(val) = store.get("private.credentials", &project_key) {
                if val.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
                    return ("repo_token".to_string(), Some(format!("repo:{}", path)));
                }
            }
        }

        if let Some(token) = store.get_git_token_raw() {
            if !token.is_empty() {
                return (
                    "app_global_token".to_string(),
                    Some("global:git.access_token".to_string()),
                );
            }
        }
    }

    if let Some((key_path, _)) = store.get_git_ssh_key() {
        return ("ssh_key".to_string(), Some(format!("ssh:{}", key_path)));
    }

    if prefers_ssh {
        return (
            "ssh_agent".to_string(),
            Some("system:ssh-agent".to_string()),
        );
    }

    (
        "system".to_string(),
        Some("system:credential-helper".to_string()),
    )
}

/// 校验一个远程仓库 URL + Token 是否可用(HTTPS + 非空 + 可连接)。
pub(crate) fn validate_project_remote_token(url: &str, token: &str) -> Result<(), String> {
    let normalized_url = url.trim();
    if !normalized_url.starts_with("https://") {
        return Err("remote 使用 Token 校验时请填写 HTTPS URL".to_string());
    }

    let token = token.trim();
    if token.is_empty() {
        return Err("请先填写 Access Token".to_string());
    }

    match gt_git::check_remote_access(normalized_url, &AuthMethod::Token(token.to_string())) {
        Ok(_) => Ok(()),
        Err(e) => {
            let (_, message) = crate::error::classify_project_remote_check_error(&e.to_string());
            Err(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn temp_store() -> (TempDir, Store) {
        let dir = TempDir::new().unwrap();
        let store = Store::open(dir.path()).unwrap();
        (dir, store)
    }

    fn temp_app_state() -> (TempDir, AppState) {
        let (dir, store) = temp_store();
        let state = AppState {
            repo: std::sync::Mutex::new(None),
            store: std::sync::Mutex::new(store),
            event_pool: std::sync::Mutex::new(gt_flow::EventPool::new()),
            node_registry: std::sync::Mutex::new(gt_flow::FlowNodeRegistry::new()),
            flow_execution: std::sync::Mutex::new(()),
            extensions: crate::extensions::ExtensionRegistry::default(),
            plugin_host: std::sync::Arc::new(crate::plugin_host::PluginHostSupervisor::default()),
        };
        (dir, state)
    }

    fn init_repo_with_commit(dir: &std::path::Path) -> gt_git::GitRepo {
        let repo = gt_git::GitRepo::init(dir).unwrap();
        fs::write(dir.join("README.md"), "# hi\n").unwrap();
        repo.stage_all().unwrap();
        repo.commit("init: first commit").unwrap();
        repo
    }

    #[test]
    fn validate_project_remote_token_rejects_non_https_url() {
        let err = validate_project_remote_token("git@github.com:a/b.git", "tok").unwrap_err();
        assert!(err.contains("HTTPS"));
    }

    #[test]
    fn validate_project_remote_token_rejects_empty_token() {
        let err = validate_project_remote_token("https://github.com/a/b.git", "  ").unwrap_err();
        assert!(err.contains("Access Token"));
    }

    #[test]
    fn resolve_auth_prefers_project_token_over_global_token() {
        let (dir, state) = temp_app_state();
        let repo = init_repo_with_commit(dir.path());
        let repo_path = repo.workdir().unwrap().display().to_string();
        {
            let mut store = state.store.lock().unwrap();
            store.set_git_token("global-token").unwrap();
            store
                .set(
                    "private.credentials",
                    &project_token_key_for_path(&repo_path),
                    serde_json::json!("project-token"),
                )
                .unwrap();
        }
        {
            let mut repo_lock = state.repo.lock().unwrap();
            *repo_lock = Some(repo);
        }

        match resolve_auth(&state) {
            AuthMethod::Token(token) => assert_eq!(token, "project-token"),
            other => panic!("expected project token auth, got {other:?}"),
        }
    }

    #[test]
    fn resolve_auth_falls_back_to_global_token_without_repo() {
        let (_dir, state) = temp_app_state();
        {
            let mut store = state.store.lock().unwrap();
            store.set_git_token("global-token").unwrap();
        }
        match resolve_auth(&state) {
            AuthMethod::Token(token) => assert_eq!(token, "global-token"),
            other => panic!("expected global token auth, got {other:?}"),
        }
    }

    #[test]
    fn resolve_auth_falls_back_to_agent_without_any_credential() {
        let (_dir, state) = temp_app_state();
        match resolve_auth(&state) {
            AuthMethod::Agent => {}
            other => panic!("expected agent fallback, got {other:?}"),
        }
    }

    #[test]
    fn resolve_auth_for_publish_target_prefers_repo_credential_ref() {
        let (dir, state) = temp_app_state();
        let repo_path = dir.path().display().to_string();
        {
            let mut store = state.store.lock().unwrap();
            store
                .set(
                    "private.credentials",
                    &project_token_key_for_path(&repo_path),
                    serde_json::json!("repo-scoped-token"),
                )
                .unwrap();
            store.set_git_token("global-token").unwrap();
        }

        let resolved = resolve_auth_for_publish_target(
            &state,
            dir.path(),
            Some("https://github.com/a/b.git"),
            Some(&format!("repo:{repo_path}")),
        );
        assert_eq!(resolved.mode, "repo_token");
        match resolved.method {
            AuthMethod::Token(token) => assert_eq!(token, "repo-scoped-token"),
            other => panic!("expected token auth, got {other:?}"),
        }
    }

    #[test]
    fn resolve_auth_for_publish_target_uses_ssh_agent_for_ssh_url_without_key() {
        let (dir, state) = temp_app_state();
        let resolved = resolve_auth_for_publish_target(
            &state,
            dir.path(),
            Some("git@github.com:a/b.git"),
            None,
        );
        assert_eq!(resolved.mode, "ssh_agent");
        assert!(matches!(resolved.method, AuthMethod::Agent));
    }

    #[test]
    fn resolve_auth_for_publish_target_falls_back_to_system_for_https_without_credentials() {
        let (dir, state) = temp_app_state();
        let resolved = resolve_auth_for_publish_target(
            &state,
            dir.path(),
            Some("https://github.com/a/b.git"),
            None,
        );
        assert_eq!(resolved.mode, "system");
        assert!(matches!(resolved.method, AuthMethod::None));
    }

    #[test]
    fn credential_summary_for_remote_reports_repo_token() {
        let (_dir, mut store) = temp_store();
        store
            .set(
                "private.credentials",
                &project_token_key_for_path("/repo/a"),
                serde_json::json!("tok"),
            )
            .unwrap();
        let (mode, reference) =
            credential_summary_for_remote(&store, Some("/repo/a"), "https://github.com/a/b.git");
        assert_eq!(mode, "repo_token");
        assert_eq!(reference, Some("repo:/repo/a".to_string()));
    }

    #[test]
    fn credential_summary_for_remote_reports_ssh_agent_for_ssh_url() {
        let (_dir, store) = temp_store();
        let (mode, _) = credential_summary_for_remote(&store, None, "git@github.com:a/b.git");
        assert_eq!(mode, "ssh_agent");
    }
}
