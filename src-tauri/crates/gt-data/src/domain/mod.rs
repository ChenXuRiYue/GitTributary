//! 面向 Core、插件宿主和 Flow runtime 的数据领域接口。

mod credentials;
mod credentials_store;
mod dynamic;
mod flow;
mod hub;
mod plugin_containers;
mod plugin_data;
mod profiles;
mod remote_metadata;
mod run_journal;
mod run_result;
mod settings;
mod workspace;
mod workspace_store;

pub use credentials::{CredentialsRepository, CredentialsRepositoryMut};
pub use credentials_store::{DataCenterConfigCredentialStatus, GitCredentials};
pub use dynamic::{DynamicDataRepository, DynamicDataRepositoryMut, DynamicNamespaceInfo};
pub use flow::{FlowDefinitionRepository, FlowDefinitionRepositoryMut};
pub use hub::DataHub;
pub use plugin_containers::{
    PluginContainerRecord, PluginContainerRepository, PluginContainerRepositoryMut,
    PluginContainerStatus,
};
pub use plugin_data::{
    PluginDataInfo, PluginDataQuota, PluginDataRepository, PluginDataRepositoryMut,
};
pub use profiles::{ProfileRepository, ProfileRepositoryMut};
pub use remote_metadata::{
    RemoteCommitIdentity, RemoteMetadataRepository, RemoteMetadataRepositoryMut,
};
pub use run_journal::{
    RunJournal, RunJournalConfig, RunJournalEventKind, RunJournalObserver, RunJournalRecord,
    RunJournalSummary,
};
pub use run_result::{
    RunResultStore, RunResultStoreConfig, SafeFlowJobResult, SafeFlowNodeResult, SafeFlowRunResult,
};
pub use settings::{setting_keys, DataKey, SettingsRepository, SettingsRepositoryMut};
pub use workspace::{WorkspaceRepository, WorkspaceRepositoryMut, WorkspaceSnapshot};
