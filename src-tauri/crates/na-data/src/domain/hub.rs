use std::path::Path;

use crate::storage::{NamespacePolicy, Store};

use super::credentials::{CredentialsRepository, CredentialsRepositoryMut};
use super::dynamic::{DynamicDataRepository, DynamicDataRepositoryMut};
use super::flow::{FlowDefinitionRepository, FlowDefinitionRepositoryMut};
use super::plugin_containers::{PluginContainerRepository, PluginContainerRepositoryMut};
use super::plugin_data::{PluginDataQuota, PluginDataRepository, PluginDataRepositoryMut};
use super::profiles::{ProfileRepository, ProfileRepositoryMut};
use super::remote_metadata::{RemoteMetadataRepository, RemoteMetadataRepositoryMut};
use super::run_journal::RunJournal;
use super::run_result::RunResultStore;
use super::settings::{SettingsRepository, SettingsRepositoryMut};
use super::workspace::{WorkspaceRepository, WorkspaceRepositoryMut};
use crate::Result;

/// 应用级数据门面。业务只能通过显式 Repository 或基础设施端口访问数据。
pub struct DataHub {
    store: Store,
    run_journal: RunJournal,
    run_results: RunResultStore,
}

impl DataHub {
    pub fn open(base_dir: &Path) -> Result<Self> {
        let store = Store::open(base_dir)?;
        Ok(Self::from_store(store))
    }

    pub(crate) fn from_store(store: Store) -> Self {
        let run_journal = RunJournal::new(store.base_dir());
        let run_results = RunResultStore::new(store.base_dir());
        Self {
            store,
            run_journal,
            run_results,
        }
    }

    pub fn workspace(&self) -> WorkspaceRepository<'_> {
        WorkspaceRepository::new(&self.store)
    }

    pub fn workspace_mut(&mut self) -> WorkspaceRepositoryMut<'_> {
        WorkspaceRepositoryMut::new(&mut self.store)
    }

    pub fn settings(&self) -> SettingsRepository<'_> {
        SettingsRepository::new(&self.store)
    }

    pub fn settings_mut(&mut self) -> SettingsRepositoryMut<'_> {
        SettingsRepositoryMut::new(&mut self.store)
    }

    pub fn flows(&self) -> FlowDefinitionRepository<'_> {
        FlowDefinitionRepository::new(&self.store)
    }

    pub fn flows_mut(&mut self) -> FlowDefinitionRepositoryMut<'_> {
        FlowDefinitionRepositoryMut::new(&mut self.store)
    }

    pub fn credentials(&self) -> CredentialsRepository<'_> {
        CredentialsRepository::new(&self.store)
    }

    pub fn credentials_mut(&mut self) -> CredentialsRepositoryMut<'_> {
        CredentialsRepositoryMut::new(&mut self.store)
    }

    pub fn remote_metadata(&self) -> RemoteMetadataRepository<'_> {
        RemoteMetadataRepository::new(&self.store)
    }

    pub fn remote_metadata_mut(&mut self) -> RemoteMetadataRepositoryMut<'_> {
        RemoteMetadataRepositoryMut::new(&mut self.store)
    }

    pub fn run_journal(&self) -> &RunJournal {
        &self.run_journal
    }

    pub fn run_results(&self) -> &RunResultStore {
        &self.run_results
    }

    pub fn plugin_data(&self, plugin_id: &str) -> Result<PluginDataRepository<'_>> {
        PluginDataRepository::new(&self.store, plugin_id)
    }

    pub fn plugin_containers(&self) -> PluginContainerRepository<'_> {
        PluginContainerRepository::new(&self.store)
    }

    pub fn plugin_containers_mut(&mut self) -> PluginContainerRepositoryMut<'_> {
        PluginContainerRepositoryMut::new(&mut self.store)
    }

    pub fn plugin_data_mut(&mut self, plugin_id: &str) -> Result<PluginDataRepositoryMut<'_>> {
        PluginDataRepositoryMut::new(&mut self.store, plugin_id)
    }

    pub fn plugin_data_with_quota(
        &self,
        plugin_id: &str,
        quota: PluginDataQuota,
    ) -> Result<PluginDataRepository<'_>> {
        PluginDataRepository::with_quota(&self.store, plugin_id, quota)
    }

    pub fn plugin_data_mut_with_quota(
        &mut self,
        plugin_id: &str,
        quota: PluginDataQuota,
    ) -> Result<PluginDataRepositoryMut<'_>> {
        PluginDataRepositoryMut::with_quota(&mut self.store, plugin_id, quota)
    }

    pub fn dynamic(&self) -> DynamicDataRepository<'_> {
        DynamicDataRepository::new(&self.store)
    }

    pub fn dynamic_mut(&mut self) -> DynamicDataRepositoryMut<'_> {
        DynamicDataRepositoryMut::new(&mut self.store)
    }

    pub fn profiles(&self) -> ProfileRepository<'_> {
        ProfileRepository::new(&self.store)
    }

    pub fn profiles_mut(&mut self) -> ProfileRepositoryMut<'_> {
        ProfileRepositoryMut::new(&mut self.store)
    }

    pub fn import_public_from_checkout(
        &mut self,
        engine: &crate::storage::SyncEngine,
        checkout: &Path,
    ) -> Result<()> {
        engine.import_public_from_checkout(&mut self.store, checkout)?;
        Ok(())
    }

    pub fn export_public_to_checkout(
        &self,
        engine: &crate::storage::SyncEngine,
        checkout: &Path,
    ) -> Result<()> {
        engine.export_public_to_checkout(&self.store, checkout)?;
        Ok(())
    }

    pub fn register_namespace_policy(&mut self, namespace: &str, policy: NamespacePolicy) {
        self.store.register_namespace_policy(namespace, policy);
    }
}
