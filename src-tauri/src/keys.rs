//! Store key 命名 helper。
//!
//! `gt-store` 只是通用的 `(namespace, key) -> value` KV 存储,
//! 具体的 key 命名规则(比如"某个仓库的项目 token 存在哪个 key")
//! 属于胶水层的约定,不该下沉到 `gt-store` 里,因此集中放在这里,
//! 供 `auth.rs` / `commands::remote` / `commands::credentials` 等模块共用。

/// 项目级 Access Token 在 `private.credentials` 命名空间下的 key。
pub(crate) fn project_token_key_for_path(path: &str) -> String {
    format!("project.{}.token", path)
}

/// 某个仓库 + 某个远程名的 commit identity 覆盖配置的 key。
pub(crate) fn remote_meta_key(repo_path: &str, remote_name: &str) -> String {
    format!("remote.{}.{}.meta", repo_path, remote_name)
}

/// 反解 `project_token_key_for_path` 生成的 key,取回仓库路径。
pub(crate) fn repo_path_from_project_token_key(key: &str) -> Option<String> {
    key.strip_prefix("project.")
        .and_then(|path| path.strip_suffix(".token"))
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_token_key_for_path_formats_key() {
        assert_eq!(
            project_token_key_for_path("/repo/a"),
            "project./repo/a.token"
        );
    }

    #[test]
    fn repo_path_from_project_token_key_round_trips() {
        let key = project_token_key_for_path("/repo/a");
        assert_eq!(
            repo_path_from_project_token_key(&key),
            Some("/repo/a".to_string())
        );
    }

    #[test]
    fn repo_path_from_project_token_key_rejects_non_matching_key() {
        assert_eq!(repo_path_from_project_token_key("settings.theme"), None);
        assert_eq!(repo_path_from_project_token_key("project.only_prefix"), None);
    }

    #[test]
    fn remote_meta_key_formats_key() {
        assert_eq!(
            remote_meta_key("/repo/a", "origin"),
            "remote./repo/a.origin.meta"
        );
    }
}
