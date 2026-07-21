//! Git 凭证管理模块
//!
//! 敏感数据(token/passphrase)存入 private 命名空间(永不同步)
//! 非敏感但仅本机有效的数据(username/email/default remote url)存入 private local settings

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::storage::error::Result;
use crate::storage::store::Store;

/// private 命名空间(仅本地,永不同步)
const NS_PRIVATE: &str = "private.credentials";
/// public 命名空间(可同步)
const NS_SETTINGS: &str = "settings";
/// local 命名空间(仅本机,不同步)
const NS_LOCAL: &str = "private.local";
const DATA_CENTER_CONFIG_REPO_TOKEN: &str = "data_center.config_repo.token";

/// 敏感数据安全级别
///
/// L0 — 绝对机密:access token、私钥、passphrase
///      展示时完全掩码(••••••••),不露任何原始字符
///      永不出现在日志、错误信息、前端响应中
///
/// L1 — 敏感:SSH 密钥路径、邮箱
///      展示时可部分显示(如路径只显示文件名)
///      不同步到远程
///
/// L2 — 普通 private:设备名等
///      仅本地存储,可正常展示

/// Git 认证配置(完整视图,前端展示用)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCredentials {
    /// GitHub/Git 用户名
    pub username: Option<String>,
    /// 邮箱
    pub email: Option<String>,
    /// 默认远程仓库 URL
    pub remote_url: Option<String>,
    /// Access Token(敏感,仅本地存储)— 返回时脱敏(只显示前4位+****)
    pub token_masked: Option<String>,
    /// 是否已配置 token
    pub has_token: bool,
    /// SSH 密钥路径
    pub ssh_key_path: Option<String>,
    /// 是否有 SSH passphrase
    pub has_ssh_passphrase: bool,
}

/// 数据中心配置仓库专用凭据状态(前端展示用,不返回明文)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataCenterConfigCredentialStatus {
    /// 是否已为配置中心仓库显式配置 Access Token
    pub has_token: bool,
    /// L0 绝对机密,只返回固定掩码
    pub token_masked: Option<String>,
    /// 凭据引用,用于解释同步使用的是哪个专用凭据
    pub credential_ref: String,
}

impl Store {
    /// 获取 Git 凭证信息(脱敏后的视图)
    pub fn get_git_credentials(&self) -> GitCredentials {
        let username = self
            .get(NS_SETTINGS, "git.username")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let email = self
            .get(NS_SETTINGS, "git.email")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let remote_url = self
            .get(NS_LOCAL, "git.default_remote_url")
            .or_else(|| self.get(NS_SETTINGS, "git.default_remote_url"))
            .and_then(|v| v.as_str().map(|s| s.to_string()));

        let token_raw = self
            .get(NS_PRIVATE, "git.access_token")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let has_token = token_raw.is_some();
        // L0 绝对机密:完全掩码,不露任何字符
        let token_masked = token_raw.map(|_| "••••••••".to_string());

        let ssh_key_path = self
            .get(NS_PRIVATE, "git.ssh_key_path")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let has_ssh_passphrase = self
            .get(NS_PRIVATE, "git.ssh_passphrase")
            .map(|v| !v.is_null() && v.as_str().map(|s| !s.is_empty()).unwrap_or(false))
            .unwrap_or(false);

        // Note: passphrase 是 L0,get_git_credentials 不返回明文/掩码,只返回 has_ssh_passphrase bool

        GitCredentials {
            username,
            email,
            remote_url,
            token_masked,
            has_token,
            ssh_key_path,
            has_ssh_passphrase,
        }
    }

    /// 设置 Git 用户名(public)
    pub fn set_git_username(&mut self, username: &str) -> Result<()> {
        self.set(NS_SETTINGS, "git.username", json!(username))
    }

    /// 设置 Git 邮箱(public)
    pub fn set_git_email(&mut self, email: &str) -> Result<()> {
        self.set(NS_SETTINGS, "git.email", json!(email))
    }

    /// 设置默认远程仓库 URL(local/private)。
    ///
    /// 这是本机选择偏好,不能同步到云端;否则会变成用远程配置决定远程配置来源。
    pub fn set_git_remote_url(&mut self, url: &str) -> Result<()> {
        self.set(NS_LOCAL, "git.default_remote_url", json!(url))?;
        self.delete(NS_SETTINGS, "git.default_remote_url")?;
        Ok(())
    }

    /// 将历史版本误写入 public settings 的默认远程迁移到本机 local。
    pub fn migrate_git_remote_url_to_local(&mut self) -> Result<()> {
        if self.get(NS_LOCAL, "git.default_remote_url").is_none() {
            if let Some(value) = self.get(NS_SETTINGS, "git.default_remote_url") {
                self.set(NS_LOCAL, "git.default_remote_url", value)?;
            }
        }
        self.delete(NS_SETTINGS, "git.default_remote_url")?;
        Ok(())
    }

    /// 设置 Access Token(private,仅本地)
    pub fn set_git_token(&mut self, token: &str) -> Result<()> {
        self.set(NS_PRIVATE, "git.access_token", json!(token))
    }

    /// 清除 Access Token
    pub fn clear_git_token(&mut self) -> Result<()> {
        self.delete(NS_PRIVATE, "git.access_token")
    }

    /// 获取 Access Token 明文(仅内部使用,如 push 时)
    pub fn get_git_token_raw(&self) -> Option<String> {
        self.get(NS_PRIVATE, "git.access_token")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    /// 获取数据中心配置仓库专用凭据状态。
    pub fn get_data_center_config_credential_status(&self) -> DataCenterConfigCredentialStatus {
        let token_raw = self.get_data_center_config_token_raw();
        let has_token = token_raw.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
        DataCenterConfigCredentialStatus {
            has_token,
            token_masked: has_token.then(|| "••••••••".to_string()),
            credential_ref: DATA_CENTER_CONFIG_REPO_TOKEN.to_string(),
        }
    }

    /// 设置数据中心配置仓库专用 Access Token(private,仅本地)。
    pub fn set_data_center_config_token(&mut self, token: &str) -> Result<()> {
        self.set(NS_PRIVATE, DATA_CENTER_CONFIG_REPO_TOKEN, json!(token))
    }

    /// 清除数据中心配置仓库专用 Access Token。
    pub fn clear_data_center_config_token(&mut self) -> Result<()> {
        self.delete(NS_PRIVATE, DATA_CENTER_CONFIG_REPO_TOKEN)
    }

    /// 获取数据中心配置仓库专用 Access Token 明文(仅同步内部使用)。
    pub fn get_data_center_config_token_raw(&self) -> Option<String> {
        self.get(NS_PRIVATE, DATA_CENTER_CONFIG_REPO_TOKEN)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    /// 设置 SSH 密钥路径(private)
    pub fn set_git_ssh_key(&mut self, path: &str, passphrase: Option<&str>) -> Result<()> {
        self.set(NS_PRIVATE, "git.ssh_key_path", json!(path))?;
        if let Some(pp) = passphrase {
            self.set(NS_PRIVATE, "git.ssh_passphrase", json!(pp))?;
        } else {
            self.delete(NS_PRIVATE, "git.ssh_passphrase")?;
        }
        Ok(())
    }

    /// 获取 SSH 密钥路径(内部使用)
    pub fn get_git_ssh_key(&self) -> Option<(String, Option<String>)> {
        let path = self
            .get(NS_PRIVATE, "git.ssh_key_path")
            .and_then(|v| v.as_str().map(|s| s.to_string()))?;
        let passphrase = self
            .get(NS_PRIVATE, "git.ssh_passphrase")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        Some((path, passphrase))
    }
}
