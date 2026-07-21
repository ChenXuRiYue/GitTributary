use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::namespace::Visibility;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataClass {
    PortableConfig,
    LocalState,
    RuntimeEvent,
    QueryProjection,
    Cache,
    Secret,
    PluginData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageClass {
    Jsonl,
    PortableDocument,
    EmbeddedKv,
    EventJournal,
    SqliteProjection,
    Keychain,
    Filesystem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncPolicy {
    Required,
    Optional,
    LocalOnly,
    Never,
}

impl SyncPolicy {
    pub fn is_syncable(self) -> bool {
        matches!(self, Self::Required | Self::Optional)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventPolicy {
    Publish,
    Private,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sensitivity {
    Public,
    Private,
    Secret,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct NamespacePolicy {
    pub data_class: DataClass,
    pub storage: StorageClass,
    pub sync: SyncPolicy,
    pub events: EventPolicy,
    pub sensitivity: Sensitivity,
    pub rebuildable: bool,
}

impl NamespacePolicy {
    pub const fn new(
        data_class: DataClass,
        storage: StorageClass,
        sync: SyncPolicy,
        events: EventPolicy,
        sensitivity: Sensitivity,
        rebuildable: bool,
    ) -> Self {
        Self {
            data_class,
            storage,
            sync,
            events,
            sensitivity,
            rebuildable,
        }
    }

    pub fn visibility(self) -> Visibility {
        if self.sync.is_syncable() {
            Visibility::Public
        } else {
            Visibility::Private
        }
    }
}

#[derive(Debug, Clone)]
pub struct NamespacePolicyRegistry {
    exact: BTreeMap<String, NamespacePolicy>,
    prefixes: Vec<(String, NamespacePolicy)>,
    fallback: NamespacePolicy,
}

impl NamespacePolicyRegistry {
    pub fn new(fallback: NamespacePolicy) -> Self {
        Self {
            exact: BTreeMap::new(),
            prefixes: Vec::new(),
            fallback,
        }
    }

    pub fn register_namespace(&mut self, namespace: impl Into<String>, policy: NamespacePolicy) {
        self.exact.insert(namespace.into(), policy);
    }

    pub fn register_prefix(&mut self, prefix: impl Into<String>, policy: NamespacePolicy) {
        let prefix = prefix.into();
        if let Some(existing) = self
            .prefixes
            .iter_mut()
            .find(|(registered, _)| registered == &prefix)
        {
            existing.1 = policy;
        } else {
            self.prefixes.push((prefix, policy));
            self.prefixes
                .sort_by(|(left, _), (right, _)| right.len().cmp(&left.len()));
        }
    }

    pub fn resolve(&self, namespace: &str) -> NamespacePolicy {
        let policy = self
            .exact
            .get(namespace)
            .copied()
            .or_else(|| {
                self.prefixes
                    .iter()
                    .find(|(prefix, _)| namespace.starts_with(prefix))
                    .map(|(_, policy)| *policy)
            })
            .unwrap_or(self.fallback);
        enforce_reserved_secret_policy(namespace, policy)
    }
}

pub fn is_reserved_secret_namespace(namespace: &str) -> bool {
    (namespace == "private.credentials"
        || (namespace.starts_with("private.") && namespace != "private.local"))
        || namespace == "secrets"
        || namespace.starts_with("secrets.")
}

fn enforce_reserved_secret_policy(namespace: &str, mut policy: NamespacePolicy) -> NamespacePolicy {
    if is_reserved_secret_namespace(namespace) {
        policy.data_class = DataClass::Secret;
        policy.sync = SyncPolicy::Never;
        policy.events = EventPolicy::Private;
        policy.sensitivity = Sensitivity::Secret;
        policy.rebuildable = false;
    }
    policy
}

impl Default for NamespacePolicyRegistry {
    fn default() -> Self {
        let portable = NamespacePolicy::new(
            DataClass::PortableConfig,
            StorageClass::Jsonl,
            SyncPolicy::Required,
            EventPolicy::Publish,
            Sensitivity::Public,
            false,
        );
        let local = NamespacePolicy::new(
            DataClass::LocalState,
            StorageClass::Jsonl,
            SyncPolicy::LocalOnly,
            EventPolicy::Private,
            Sensitivity::Private,
            false,
        );
        let secret = NamespacePolicy::new(
            DataClass::Secret,
            StorageClass::Jsonl,
            SyncPolicy::Never,
            EventPolicy::Private,
            Sensitivity::Secret,
            false,
        );
        let plugin_local = NamespacePolicy::new(
            DataClass::PluginData,
            StorageClass::Jsonl,
            SyncPolicy::LocalOnly,
            EventPolicy::Private,
            Sensitivity::Private,
            false,
        );

        let mut registry = Self::new(local);
        registry.register_namespace("settings", portable);
        registry.register_namespace("flows", portable);
        registry.register_namespace(
            "sites",
            NamespacePolicy::new(
                DataClass::PluginData,
                StorageClass::Jsonl,
                SyncPolicy::Optional,
                EventPolicy::Publish,
                Sensitivity::Public,
                false,
            ),
        );
        registry.register_namespace("workspace", local);
        registry.register_namespace("ui-state", local);
        registry.register_namespace("private.local", local);
        registry.register_namespace("private.credentials", secret);
        registry.register_namespace("plugin-containers", plugin_local);
        registry.register_namespace("secrets", secret);
        registry.register_prefix("private.", secret);
        registry.register_prefix("plugin.", plugin_local);
        registry
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_in_policies_separate_portable_local_and_secret_data() {
        let registry = NamespacePolicyRegistry::default();

        assert_eq!(registry.resolve("settings").sync, SyncPolicy::Required);
        assert_eq!(registry.resolve("flows").sync, SyncPolicy::Required);
        assert_eq!(registry.resolve("sites").sync, SyncPolicy::Optional);
        assert_eq!(registry.resolve("workspace").sync, SyncPolicy::LocalOnly);
        assert_eq!(registry.resolve("ui-state").sync, SyncPolicy::LocalOnly);
        let plugin_containers = registry.resolve("plugin-containers");
        assert_eq!(plugin_containers.data_class, DataClass::PluginData);
        assert_eq!(plugin_containers.sync, SyncPolicy::LocalOnly);
        assert_eq!(plugin_containers.events, EventPolicy::Private);
        assert_eq!(plugin_containers.sensitivity, Sensitivity::Private);
        assert_eq!(
            registry.resolve("private.credentials").sync,
            SyncPolicy::Never
        );
    }

    #[test]
    fn unknown_and_plugin_namespaces_are_local_by_default() {
        let registry = NamespacePolicyRegistry::default();

        assert_eq!(registry.resolve("unknown").sync, SyncPolicy::LocalOnly);
        assert_eq!(
            registry
                .resolve("plugin.com.example.demo.settings")
                .data_class,
            DataClass::PluginData
        );
        assert_eq!(
            registry.resolve("plugin.com.example.demo.settings").events,
            EventPolicy::Private
        );
    }

    #[test]
    fn reserved_secret_namespaces_cannot_be_downgraded() {
        let mut registry = NamespacePolicyRegistry::default();
        registry.register_namespace(
            "private.credentials",
            NamespacePolicy::new(
                DataClass::PortableConfig,
                StorageClass::PortableDocument,
                SyncPolicy::Required,
                EventPolicy::Publish,
                Sensitivity::Public,
                true,
            ),
        );

        let policy = registry.resolve("private.credentials");
        assert_eq!(policy.data_class, DataClass::Secret);
        assert_eq!(policy.sync, SyncPolicy::Never);
        assert_eq!(policy.events, EventPolicy::Private);
        assert_eq!(policy.sensitivity, Sensitivity::Secret);
        assert!(!policy.rebuildable);

        assert_eq!(
            registry.resolve("private.local").data_class,
            DataClass::LocalState
        );
    }

    #[test]
    fn longest_registered_prefix_wins() {
        let mut registry = NamespacePolicyRegistry::default();
        let portable_plugin = NamespacePolicy::new(
            DataClass::PluginData,
            StorageClass::Jsonl,
            SyncPolicy::Optional,
            EventPolicy::Publish,
            Sensitivity::Public,
            false,
        );
        registry.register_prefix("plugin.com.example.", portable_plugin);

        assert_eq!(
            registry.resolve("plugin.com.example.demo").sync,
            SyncPolicy::Optional
        );
    }
}
