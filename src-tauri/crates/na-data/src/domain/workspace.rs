use crate::storage::Store;

use crate::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSnapshot {
    pub active_repo: Option<String>,
    pub active_branch: Option<String>,
    pub recent_repos: Vec<String>,
    pub bound_repos: Vec<String>,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
}

pub struct WorkspaceRepository<'a> {
    store: &'a Store,
}

impl<'a> WorkspaceRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn snapshot(&self) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            active_repo: self.store.active_repo(),
            active_branch: self.store.active_branch(),
            recent_repos: self.store.recent_repos(),
            bound_repos: self.store.bound_repos(),
            device_id: self.store.device_id(),
            device_name: self.store.device_name(),
        }
    }

    pub fn active_repo(&self) -> Option<String> {
        self.store.active_repo()
    }

    pub fn recent_repos(&self) -> Vec<String> {
        self.store.recent_repos()
    }
}

pub struct WorkspaceRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> WorkspaceRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn initialize(&mut self) -> Result<()> {
        self.store.init_workspace()?;
        Ok(())
    }

    pub fn sync(&mut self, repo_path: Option<&str>, branch: Option<&str>) -> Result<()> {
        self.store.sync_workspace(repo_path, branch)?;
        Ok(())
    }

    pub fn set_active_repo(&mut self, path: &str) -> Result<()> {
        self.store.set_active_repo(path)?;
        Ok(())
    }

    pub fn bind_repo(&mut self, path: &str) -> Result<()> {
        self.store.bind_repo(path)?;
        Ok(())
    }

    pub fn unbind_repo(&mut self, path: &str) -> Result<()> {
        self.store.unbind_repo(path)?;
        Ok(())
    }
}
