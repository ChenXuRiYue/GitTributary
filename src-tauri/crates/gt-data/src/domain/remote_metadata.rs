use crate::storage::Store;
use serde::{Deserialize, Serialize};

use crate::Result;

const LOCAL_NAMESPACE: &str = "private.local";
const SETTINGS_NAMESPACE: &str = "settings";
const DEFAULT_REMOTE_URL_KEY: &str = "git.default_remote_url";

fn remote_identity_key(repo_path: &str, remote_name: &str) -> String {
    format!("remote.{repo_path}.{remote_name}.meta")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

impl RemoteCommitIdentity {
    pub fn normalized(name: Option<&str>, email: Option<&str>) -> Self {
        Self {
            name: normalize_field(name),
            email: normalize_field(email),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.email.is_none()
    }
}

fn normalize_field(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub struct RemoteMetadataRepository<'a> {
    store: &'a Store,
}

impl<'a> RemoteMetadataRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn commit_identity(
        &self,
        repo_path: &str,
        remote_name: &str,
    ) -> Result<Option<RemoteCommitIdentity>> {
        self.store
            .get(
                LOCAL_NAMESPACE,
                &remote_identity_key(repo_path, remote_name),
            )
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }

    pub fn default_remote_url(&self) -> Option<String> {
        self.store
            .get(LOCAL_NAMESPACE, DEFAULT_REMOTE_URL_KEY)
            .or_else(|| self.store.get(SETTINGS_NAMESPACE, DEFAULT_REMOTE_URL_KEY))
            .and_then(|value| value.as_str().map(str::to_string))
    }
}

pub struct RemoteMetadataRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> RemoteMetadataRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn save_commit_identity(
        &mut self,
        repo_path: &str,
        remote_name: &str,
        identity: &RemoteCommitIdentity,
    ) -> Result<()> {
        if identity.is_empty() {
            return self.delete_commit_identity(repo_path, remote_name);
        }
        self.store.set(
            LOCAL_NAMESPACE,
            &remote_identity_key(repo_path, remote_name),
            serde_json::to_value(identity)?,
        )?;
        Ok(())
    }

    pub fn set_default_remote_url(&mut self, url: &str) -> Result<()> {
        self.store.set(
            LOCAL_NAMESPACE,
            DEFAULT_REMOTE_URL_KEY,
            serde_json::json!(url),
        )?;
        self.store
            .delete(SETTINGS_NAMESPACE, DEFAULT_REMOTE_URL_KEY)?;
        Ok(())
    }

    pub fn migrate_default_remote_url(&mut self) -> Result<()> {
        if self
            .store
            .get(LOCAL_NAMESPACE, DEFAULT_REMOTE_URL_KEY)
            .is_none()
        {
            if let Some(value) = self.store.get(SETTINGS_NAMESPACE, DEFAULT_REMOTE_URL_KEY) {
                self.store
                    .set(LOCAL_NAMESPACE, DEFAULT_REMOTE_URL_KEY, value)?;
            }
        }
        self.store
            .delete(SETTINGS_NAMESPACE, DEFAULT_REMOTE_URL_KEY)?;
        Ok(())
    }

    pub fn delete_commit_identity(&mut self, repo_path: &str, remote_name: &str) -> Result<()> {
        self.store.delete(
            LOCAL_NAMESPACE,
            &remote_identity_key(repo_path, remote_name),
        )?;
        Ok(())
    }
}
