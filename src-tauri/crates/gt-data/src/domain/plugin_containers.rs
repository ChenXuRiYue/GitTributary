use std::collections::{BTreeMap, BTreeSet};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::storage::{validate_namespace_name, Store};
use serde::{Deserialize, Serialize};

use super::plugin_data::PluginDataQuota;
use crate::{DataError, Result};

const NAMESPACE: &str = "plugin-containers";
const FORMAT_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginContainerStatus {
    Attached,
    Orphaned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginContainerRecord {
    pub format: u16,
    pub plugin_id: String,
    pub installed_version: Option<String>,
    pub generation: u64,
    pub status: PluginContainerStatus,
    pub quota: PluginDataQuota,
    pub last_seen_unix_ms: u64,
}

pub struct PluginContainerRepository<'a> {
    store: &'a Store,
}

impl<'a> PluginContainerRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn get(&self, plugin_id: &str) -> Result<Option<PluginContainerRecord>> {
        validate_plugin_id(plugin_id)?;
        self.store
            .get(NAMESPACE, plugin_id)
            .map(decode_record)
            .transpose()
    }

    pub fn list(&self) -> Result<Vec<PluginContainerRecord>> {
        self.store
            .entries(NAMESPACE)
            .into_iter()
            .map(|(_, value)| decode_record(value))
            .collect()
    }
}

pub struct PluginContainerRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> PluginContainerRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn get(&self, plugin_id: &str) -> Result<Option<PluginContainerRecord>> {
        PluginContainerRepository::new(self.store).get(plugin_id)
    }

    /// Attach an installed plugin to its existing container. Payload data is never rewritten.
    pub fn attach(
        &mut self,
        plugin_id: &str,
        installed_version: &str,
    ) -> Result<PluginContainerRecord> {
        validate_plugin_id(plugin_id)?;
        if installed_version.trim().is_empty() {
            return Err(DataError::PluginContainer(
                "插件安装版本不能为空".to_string(),
            ));
        }
        let previous = self.get(plugin_id)?;
        let record = PluginContainerRecord {
            format: FORMAT_VERSION,
            plugin_id: plugin_id.to_string(),
            installed_version: Some(installed_version.to_string()),
            generation: previous
                .as_ref()
                .map_or(1, |record| record.generation.saturating_add(1)),
            status: PluginContainerStatus::Attached,
            quota: previous
                .as_ref()
                .map_or_else(PluginDataQuota::default, |record| record.quota),
            last_seen_unix_ms: now_unix_ms(),
        };
        self.write(&record)?;
        Ok(record)
    }

    /// Detach the plugin but retain both metadata and opaque plugin payload for reinstall.
    pub fn mark_orphaned(&mut self, plugin_id: &str) -> Result<PluginContainerRecord> {
        validate_plugin_id(plugin_id)?;
        let previous = self.get(plugin_id)?;
        let record = PluginContainerRecord {
            format: FORMAT_VERSION,
            plugin_id: plugin_id.to_string(),
            installed_version: None,
            generation: previous
                .as_ref()
                .map_or(1, |record| record.generation.saturating_add(1)),
            status: PluginContainerStatus::Orphaned,
            quota: previous
                .as_ref()
                .map_or_else(PluginDataQuota::default, |record| record.quota),
            last_seen_unix_ms: now_unix_ms(),
        };
        self.write(&record)?;
        Ok(record)
    }

    /// Repair lifecycle metadata from the authoritative installed-plugin registry.
    pub fn reconcile<I, S1, S2>(&mut self, installed: I) -> Result<()>
    where
        I: IntoIterator<Item = (S1, S2)>,
        S1: AsRef<str>,
        S2: AsRef<str>,
    {
        let installed = installed
            .into_iter()
            .map(|(id, version)| (id.as_ref().to_string(), version.as_ref().to_string()))
            .collect::<BTreeMap<_, _>>();
        for (plugin_id, version) in &installed {
            let already_current = self.get(plugin_id)?.is_some_and(|record| {
                record.status == PluginContainerStatus::Attached
                    && record.installed_version.as_deref() == Some(version.as_str())
            });
            if !already_current {
                self.attach(plugin_id, version)?;
            }
        }

        let installed_ids = installed.keys().cloned().collect::<BTreeSet<_>>();
        let attached_ids = PluginContainerRepository::new(self.store)
            .list()?
            .into_iter()
            .filter(|record| record.status == PluginContainerStatus::Attached)
            .map(|record| record.plugin_id)
            .collect::<Vec<_>>();
        for plugin_id in attached_ids {
            if !installed_ids.contains(&plugin_id) {
                self.mark_orphaned(&plugin_id)?;
            }
        }
        Ok(())
    }

    fn write(&mut self, record: &PluginContainerRecord) -> Result<()> {
        self.store
            .set(NAMESPACE, &record.plugin_id, serde_json::to_value(record)?)?;
        Ok(())
    }
}

fn validate_plugin_id(plugin_id: &str) -> Result<()> {
    validate_namespace_name(&format!("plugin.{plugin_id}"))?;
    Ok(())
}

fn decode_record(value: serde_json::Value) -> Result<PluginContainerRecord> {
    let record: PluginContainerRecord = serde_json::from_value(value)?;
    if record.format != FORMAT_VERSION {
        return Err(DataError::PluginContainer(format!(
            "不支持的插件容器格式: {}",
            record.format
        )));
    }
    validate_plugin_id(&record.plugin_id)?;
    Ok(record)
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::DataHub;

    #[test]
    fn uninstall_orphans_and_reinstall_reattaches_without_deleting_payload() {
        let directory = tempfile::tempdir().unwrap();
        let mut data = DataHub::open(directory.path()).unwrap();
        let first = data
            .plugin_containers_mut()
            .attach("com.example.demo", "1.0.0")
            .unwrap();
        data.plugin_data_mut("com.example.demo")
            .unwrap()
            .set("plugin.com.example.demo.cache", "result", json!(null))
            .unwrap();

        let orphan = data
            .plugin_containers_mut()
            .mark_orphaned("com.example.demo")
            .unwrap();
        assert_eq!(orphan.status, PluginContainerStatus::Orphaned);
        assert_eq!(orphan.installed_version, None);
        assert!(orphan.generation > first.generation);
        assert_eq!(
            data.plugin_data("com.example.demo")
                .unwrap()
                .get("plugin.com.example.demo.cache", "result")
                .unwrap(),
            Some(json!(null))
        );

        let reattached = data
            .plugin_containers_mut()
            .attach("com.example.demo", "2.0.0")
            .unwrap();
        assert_eq!(reattached.status, PluginContainerStatus::Attached);
        assert_eq!(reattached.installed_version.as_deref(), Some("2.0.0"));
        assert_eq!(reattached.quota, first.quota);
        assert!(reattached.generation > orphan.generation);
    }

    #[test]
    fn reconcile_repairs_attached_and_orphaned_states() {
        let directory = tempfile::tempdir().unwrap();
        let mut data = DataHub::open(directory.path()).unwrap();
        data.plugin_containers_mut()
            .attach("com.example.removed", "1.0.0")
            .unwrap();

        data.plugin_containers_mut()
            .reconcile([("com.example.installed", "3.0.0")])
            .unwrap();

        assert_eq!(
            data.plugin_containers()
                .get("com.example.installed")
                .unwrap()
                .unwrap()
                .status,
            PluginContainerStatus::Attached
        );
        assert_eq!(
            data.plugin_containers()
                .get("com.example.removed")
                .unwrap()
                .unwrap()
                .status,
            PluginContainerStatus::Orphaned
        );

        let generation = data
            .plugin_containers()
            .get("com.example.installed")
            .unwrap()
            .unwrap()
            .generation;
        data.plugin_containers_mut()
            .reconcile([("com.example.installed", "3.0.0")])
            .unwrap();
        assert_eq!(
            data.plugin_containers()
                .get("com.example.installed")
                .unwrap()
                .unwrap()
                .generation,
            generation
        );
    }

    #[test]
    fn plugin_payload_repository_cannot_access_host_container_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let mut data = DataHub::open(directory.path()).unwrap();
        data.plugin_containers_mut()
            .attach("com.example.demo", "1.0.0")
            .unwrap();

        assert!(data
            .plugin_data("com.example.demo")
            .unwrap()
            .get("plugin-containers", "com.example.demo")
            .is_err());
        assert!(data
            .dynamic()
            .get("plugin-containers", "com.example.demo")
            .is_err());
        assert!(data
            .dynamic_mut()
            .set(
                "plugin-containers",
                "com.example.demo",
                json!({ "status": "orphaned" }),
            )
            .is_err());
        assert!(!data
            .dynamic()
            .namespaces()
            .iter()
            .any(|namespace| namespace.name == "plugin-containers"));
    }
}
