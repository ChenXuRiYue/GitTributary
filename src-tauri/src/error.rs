//! 错误信息分类 helper。
//!
//! 这些函数把底层库(git2/网络层)返回的英文错误字符串,
//! 归类成前端可以用来做条件判断的 `status` code,
//! 并生成中文可读提示。属于跨领域的"错误展示"逻辑,
//! 不属于任何单个业务 crate,因此放在胶水层。

/// 分类项目级远程仓库检查(add_remote/set_remote_url/clone_remote_repo)的错误。
pub(crate) fn classify_project_remote_check_error(error: &str) -> (String, String) {
    let lower = error.to_lowercase();
    if lower.contains("authentication")
        || lower.contains("auth")
        || lower.contains("credential")
        || lower.contains("401")
        || lower.contains("403")
    {
        return (
            "auth_failed".to_string(),
            "认证失败,请检查 Access Token 权限".to_string(),
        );
    }
    if lower.contains("not found")
        || lower.contains("404")
        || lower.contains("repository not found")
    {
        return (
            "not_found".to_string(),
            "仓库不存在或当前 Token 无权访问".to_string(),
        );
    }
    if lower.contains("resolve")
        || lower.contains("network")
        || lower.contains("timeout")
        || lower.contains("couldn't connect")
        || lower.contains("failed to connect")
    {
        return (
            "network_failed".to_string(),
            "网络连接失败,请检查网络或代理".to_string(),
        );
    }

    ("invalid".to_string(), error.to_string())
}

/// 分类数据中心配置仓库检查的错误。
pub(crate) fn classify_config_repo_check_error(error: &str) -> (String, String) {
    let lower = error.to_lowercase();
    if lower.contains("authentication")
        || lower.contains("auth")
        || lower.contains("credential")
        || lower.contains("401")
        || lower.contains("403")
    {
        return (
            "auth_failed".to_string(),
            "认证失败,请检查配置中心专用 Access Token 权限".to_string(),
        );
    }
    if lower.contains("not found")
        || lower.contains("404")
        || lower.contains("repository not found")
    {
        return (
            "not_found".to_string(),
            "仓库不存在或当前 Token 无权访问".to_string(),
        );
    }
    if lower.contains("resolve")
        || lower.contains("network")
        || lower.contains("timeout")
        || lower.contains("couldn't connect")
        || lower.contains("failed to connect")
    {
        return (
            "network_failed".to_string(),
            "网络连接失败,请检查网络或代理".to_string(),
        );
    }

    ("invalid".to_string(), error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_project_remote_check_error_detects_auth_failure() {
        let (status, message) = classify_project_remote_check_error("401 authentication failed");
        assert_eq!(status, "auth_failed");
        assert!(message.contains("认证失败"));
    }

    #[test]
    fn classify_project_remote_check_error_detects_not_found() {
        let (status, _) = classify_project_remote_check_error("repository not found (404)");
        assert_eq!(status, "not_found");
    }

    #[test]
    fn classify_project_remote_check_error_detects_network_failure() {
        let (status, _) =
            classify_project_remote_check_error("failed to connect: couldn't connect to host");
        assert_eq!(status, "network_failed");
    }

    #[test]
    fn classify_project_remote_check_error_falls_back_to_invalid() {
        let (status, message) = classify_project_remote_check_error("something else broke");
        assert_eq!(status, "invalid");
        assert_eq!(message, "something else broke");
    }

    #[test]
    fn classify_config_repo_check_error_detects_auth_failure() {
        let (status, message) = classify_config_repo_check_error("403 Forbidden");
        assert_eq!(status, "auth_failed");
        assert!(message.contains("配置中心专用"));
    }
}
