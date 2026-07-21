use crate::storage::Store;

use super::credentials_store::{DataCenterConfigCredentialStatus, GitCredentials};

use crate::Result;

const CREDENTIAL_NAMESPACE: &str = "private.credentials";
const PROJECT_TOKEN_PREFIX: &str = "project.";
const PROJECT_TOKEN_SUFFIX: &str = ".token";

fn project_token_key(repo_path: &str) -> String {
    format!("{PROJECT_TOKEN_PREFIX}{repo_path}{PROJECT_TOKEN_SUFFIX}")
}

fn repo_path_from_project_token_key(key: &str) -> Option<String> {
    key.strip_prefix(PROJECT_TOKEN_PREFIX)
        .and_then(|path| path.strip_suffix(PROJECT_TOKEN_SUFFIX))
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string)
}

pub struct CredentialsRepository<'a> {
    store: &'a Store,
}

impl<'a> CredentialsRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn summary(&self) -> GitCredentials {
        self.store.get_git_credentials()
    }

    pub fn data_center_config_status(&self) -> DataCenterConfigCredentialStatus {
        self.store.get_data_center_config_credential_status()
    }

    pub fn global_token(&self) -> Option<String> {
        self.store.get_git_token_raw()
    }

    pub fn data_center_config_token(&self) -> Option<String> {
        self.store.get_data_center_config_token_raw()
    }

    pub fn ssh_key(&self) -> Option<(String, Option<String>)> {
        self.store.get_git_ssh_key()
    }

    pub fn project_token(&self, repo_path: &str) -> Option<String> {
        self.store
            .get(CREDENTIAL_NAMESPACE, &project_token_key(repo_path))
            .and_then(|value| value.as_str().map(str::to_string))
    }

    pub fn project_token_repo_paths(&self) -> Vec<String> {
        let mut paths = self
            .store
            .scan(CREDENTIAL_NAMESPACE, PROJECT_TOKEN_PREFIX)
            .into_iter()
            .filter_map(|(key, value)| {
                value
                    .as_str()
                    .filter(|token| !token.is_empty())
                    .and_then(|_| repo_path_from_project_token_key(&key))
            })
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        paths
    }
}

pub struct CredentialsRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> CredentialsRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn set_global_token(&mut self, token: &str) -> Result<()> {
        self.store.set_git_token(token)?;
        Ok(())
    }

    pub fn clear_global_token(&mut self) -> Result<()> {
        self.store.clear_git_token()?;
        Ok(())
    }

    pub fn set_data_center_config_token(&mut self, token: &str) -> Result<()> {
        self.store.set_data_center_config_token(token)?;
        Ok(())
    }

    pub fn clear_data_center_config_token(&mut self) -> Result<()> {
        self.store.clear_data_center_config_token()?;
        Ok(())
    }

    pub fn set_ssh_key(&mut self, path: &str, passphrase: Option<&str>) -> Result<()> {
        self.store.set_git_ssh_key(path, passphrase)?;
        Ok(())
    }

    pub fn set_project_token(&mut self, repo_path: &str, token: &str) -> Result<()> {
        self.store.set(
            CREDENTIAL_NAMESPACE,
            &project_token_key(repo_path),
            serde_json::json!(token),
        )?;
        Ok(())
    }

    pub fn clear_project_token(&mut self, repo_path: &str) -> Result<()> {
        self.store
            .delete(CREDENTIAL_NAMESPACE, &project_token_key(repo_path))?;
        Ok(())
    }
}
