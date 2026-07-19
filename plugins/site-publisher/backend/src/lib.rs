use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::path::PathBuf;
use std::time::Instant;

use gt_git::{
    commit_pages_git, normalize_git_name, prepare_pages_git, resolve_repo_root,
    verify_pages_push_access, AuthMethod, CommitIdentity, GitRepo, PagesCommitGitOptions,
    PagesPrepareGitOptions,
};
use gt_site::{SiteBuildConfig, SiteBuildReport};
use serde::Deserialize;
use serde_json::{json, Value};

pub const PLUGIN_ABI_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SitePublishRequest {
    build_config: SiteBuildConfig,
    target: SitePublishTarget,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SitePublishTarget {
    target_local_path: String,
    target_branch: String,
    publish_dir: String,
    remote_name: String,
    #[serde(default)]
    pages_url: String,
    #[serde(default)]
    auto_commit_message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPublishContext {
    target_root: String,
    remote_name: String,
    remote_url: String,
    auth: GitAuthContext,
    mode: String,
    credential_ref: Option<String>,
    commit_identity: GitCommitIdentity,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum GitAuthContext {
    Token {
        token: String,
    },
    SshKey {
        private_key: String,
        passphrase: Option<String>,
    },
    Agent,
    None,
}

#[derive(Debug, Deserialize)]
struct GitCommitIdentity {
    name: String,
    email: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SitePublishReport {
    build: SiteBuildReport,
    target_repo_path: String,
    publish_dir: String,
    publish_path: String,
    branch: String,
    remote_name: String,
    pages_url: String,
    copied_file_count: usize,
    changed_count: usize,
    commit: Option<String>,
    pushed: bool,
    credential_mode: String,
    credential_ref: Option<String>,
    duration_ms: u128,
}

pub fn handle_request(method: &str, payload: Value) -> Result<Value, String> {
    match method {
        "site.scan" => {
            let repo_path = required_field::<String>(&payload, "repoPath")?;
            serialize(gt_site::scan_repo(repo_path).map_err(|error| error.to_string())?)
        }
        "site.build" => {
            let config = required_field::<SiteBuildConfig>(&payload, "config")?;
            serialize(gt_site::build_site(config).map_err(|error| error.to_string())?)
        }
        "site.publish" => {
            let request = required_field::<SitePublishRequest>(&payload, "request")?;
            let context = required_field::<GitPublishContext>(&payload, "gitContext")?;
            serialize(publish_pages(request, context)?)
        }
        _ => Err(format!("unsupported method: {method}")),
    }
}

fn publish_pages(
    request: SitePublishRequest,
    context: GitPublishContext,
) -> Result<SitePublishReport, String> {
    let started = Instant::now();
    let branch = normalize_git_name(&request.target.target_branch, "目标分支")
        .map_err(|error| error.to_string())?;
    let remote_name = normalize_git_name(&request.target.remote_name, "发布远程")
        .map_err(|error| error.to_string())?;
    let target_root =
        resolve_repo_root(&request.target.target_local_path).map_err(|error| error.to_string())?;
    let context_root = PathBuf::from(&context.target_root)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if target_root != context_root {
        return Err("Git 上下文与发布目标不匹配".to_string());
    }
    if remote_name != context.remote_name {
        return Err("Git 上下文与发布远程不匹配".to_string());
    }
    let target_repo = GitRepo::open(&target_root).map_err(|error| error.to_string())?;
    let current_remote_url = target_repo
        .remotes()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|remote| remote.name == remote_name)
        .map(|remote| remote.url)
        .ok_or_else(|| format!("远程 '{remote_name}' 不存在"))?;
    if current_remote_url != context.remote_url {
        return Err("Git 上下文与发布远程 URL 不匹配".to_string());
    }
    let auth = auth_method(context.auth);
    let target_plan = gt_site::plan_publish_target(
        &request.build_config,
        &target_root,
        &request.target.publish_dir,
    )
    .map_err(|error| classify_pages_publish_error(&error.to_string()))?;

    prepare_pages_git(PagesPrepareGitOptions {
        target_local_path: target_root.clone(),
        branch: branch.clone(),
        remote_name: remote_name.clone(),
        allowed_dirty_pathspec: Some(target_plan.publish_pathspec.clone()),
        auth: auth.clone(),
    })
    .map_err(|error| classify_pages_publish_error(&error.to_string()))?;
    verify_pages_push_access(&target_root, &remote_name, &branch, &auth)
        .map_err(|error| classify_pages_publish_error(&error.to_string()))?;

    let prepared = gt_site::prepare_publish_output(
        request.build_config,
        &target_root,
        &request.target.publish_dir,
        &request.target.pages_url,
        &request.target.auto_commit_message,
    )
    .map_err(|error| error.to_string())?;
    let git_report = commit_pages_git(PagesCommitGitOptions {
        target_local_path: target_root,
        branch,
        remote_name,
        publish_pathspec: target_plan.publish_pathspec,
        commit_message: prepared.commit_message.clone(),
        commit_identity: CommitIdentity {
            name: context.commit_identity.name,
            email: context.commit_identity.email,
        },
        auth,
    })
    .map_err(|error| classify_pages_publish_error(&error.to_string()))?;

    Ok(SitePublishReport {
        build: prepared.build,
        target_repo_path: git_report.target_repo_path,
        publish_dir: prepared.publish_dir,
        publish_path: prepared.publish_path,
        branch: git_report.branch,
        remote_name: git_report.remote_name,
        pages_url: prepared.pages_url,
        copied_file_count: prepared.copied_file_count,
        changed_count: git_report.changed_count,
        commit: git_report.commit,
        pushed: git_report.pushed,
        credential_mode: context.mode,
        credential_ref: context.credential_ref,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn auth_method(context: GitAuthContext) -> AuthMethod {
    match context {
        GitAuthContext::Token { token } => AuthMethod::Token(token),
        GitAuthContext::SshKey {
            private_key,
            passphrase,
        } => AuthMethod::SshKey {
            private_key,
            passphrase,
        },
        GitAuthContext::Agent => AuthMethod::Agent,
        GitAuthContext::None => AuthMethod::None,
    }
}

fn required_field<T: serde::de::DeserializeOwned>(
    payload: &Value,
    field: &str,
) -> Result<T, String> {
    payload
        .get(field)
        .cloned()
        .ok_or_else(|| format!("missing payload field: {field}"))
        .and_then(|value| serde_json::from_value(value).map_err(|error| error.to_string()))
}

fn serialize<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn classify_pages_publish_error(error: &str) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("too many redirects")
        || lower.contains("authentication replays")
        || lower.contains("authentication failed")
        || lower.contains("401")
        || lower.contains("403")
    {
        return format!(
            "{error}\n请检查 Pages 发布仓库远程 URL 与认证方式是否匹配: HTTPS 远程需要目标仓库可用的 GitHub Token, fine-grained token 至少需要 Contents: Read and write; SSH 远程请配置 SSH Key 或 Agent。"
        );
    }
    error.to_string()
}

#[no_mangle]
pub extern "C" fn gittributary_plugin_abi_version() -> u32 {
    PLUGIN_ABI_VERSION
}

#[no_mangle]
pub unsafe extern "C" fn gittributary_plugin_handle_request(
    method: *const c_char,
    payload: *const c_char,
) -> *mut c_char {
    if method.is_null() || payload.is_null() {
        return CString::new(r#"{"error":"invalid_pointer"}"#)
            .unwrap()
            .into_raw();
    }
    let method = CStr::from_ptr(method).to_string_lossy();
    let payload = CStr::from_ptr(payload).to_string_lossy();
    let result = serde_json::from_str::<Value>(&payload)
        .map_err(|error| error.to_string())
        .and_then(|value| handle_request(&method, value));
    let response = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    CString::new(response.to_string()).unwrap().into_raw()
}

#[no_mangle]
pub unsafe extern "C" fn gittributary_plugin_free_string(value: *mut c_char) {
    if !value.is_null() {
        drop(CString::from_raw(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_and_builds_through_plugin_methods() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("README.md"), "# Hello").unwrap();
        let scan = handle_request(
            "site.scan",
            json!({ "repoPath": temp.path().to_string_lossy() }),
        )
        .unwrap();
        assert_eq!(scan["markdownCount"], 1);

        let output = temp.path().join("site");
        let build = handle_request(
            "site.build",
            json!({
                "config": {
                    "repoPath": temp.path().to_string_lossy(),
                    "outputDir": output.to_string_lossy(),
                    "siteTitle": "Test",
                    "include": ["README.md"],
                    "exclude": [],
                    "theme": "typora-light",
                    "withSearch": true,
                    "copyAssets": true
                }
            }),
        )
        .unwrap();
        assert_eq!(build["pageCount"], 1);
    }

    #[test]
    fn accepts_host_git_auth_context_shapes() {
        let token: GitAuthContext = serde_json::from_value(json!({
            "kind": "token",
            "token": "secret"
        }))
        .unwrap();
        assert!(matches!(token, GitAuthContext::Token { .. }));

        let ssh: GitAuthContext = serde_json::from_value(json!({
            "kind": "ssh_key",
            "privateKey": "/tmp/id_ed25519",
            "passphrase": null
        }))
        .unwrap();
        assert!(matches!(ssh, GitAuthContext::SshKey { .. }));
    }
}
