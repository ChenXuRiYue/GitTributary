//! Git 凭证管理模块
//!
//! 敏感数据(token/passphrase)存入 private 命名空间(永不同步)
//! 非敏感数据(username/email/remote url)存入 public settings

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::Result;
use crate::store::Store;

/// private 命名空间(仅本地,永不同步)
const NS_PRIVATE: &str = "private.credentials";
/// public 命名空间(可同步)
const NS_SETTINGS: &str = "settings";

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

impl Store {
    /// 获取 Git 凭证信息(脱敏后的视图)
    pub fn get_git_credentials(&self) -> GitCredentials {
        let username = self.get(NS_SETTINGS, "git.username")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let email = self.get(NS_SETTINGS, "git.email")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let remote_url = self.get(NS_SETTINGS, "git.default_remote_url")
            .and_then(|v| v.as_str().map(|s| s.to_string()));

        let token_raw = self.get(NS_PRIVATE, "git.access_token")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let has_token = token_raw.is_some();
        let token_masked = token_raw.map(|t| {
            if t.len() > 4 {
                format!("{}****", &t[..4])
            } else {
                "****".to_string()
            }
        });

        let ssh_key_path = self.get(NS_PRIVATE, "git.ssh_key_path")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        let has_ssh_passphrase = self.get(NS_PRIVATE, "git.ssh_passphrase")
            .map(|v| !v.is_null() && v.as_str().map(|s| !s.is_empty()).unwrap_or(false))
            .unwrap_or(false);

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

    /// 设置默认远程仓库 URL(public)
    pub fn set_git_remote_url(&mut self, url: &str) -> Result<()> {
        self.set(NS_SETTINGS, "git.default_remote_url", json!(url))
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
        let path = self.get(NS_PRIVATE, "git.ssh_key_path")
            .and_then(|v| v.as_str().map(|s| s.to_string()))?;
        let passphrase = self.get(NS_PRIVATE, "git.ssh_passphrase")
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        Some((path, passphrase))
    }
}
