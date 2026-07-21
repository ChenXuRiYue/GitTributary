use crate::storage::{validate_namespace_name, Store};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{DataError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDataQuota {
    pub max_keys: usize,
    pub max_value_bytes: usize,
    pub max_total_bytes: usize,
}

impl Default for PluginDataQuota {
    fn default() -> Self {
        Self {
            max_keys: 2048,
            max_value_bytes: 256 * 1024,
            max_total_bytes: 8 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginDataInfo {
    pub key_count: usize,
    pub live_bytes: usize,
    pub max_keys: usize,
    pub max_total_bytes: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct PluginValueEnvelope {
    format: u16,
    payload: Value,
}

pub struct PluginDataRepository<'a> {
    store: &'a Store,
    plugin_id: String,
    physical_namespace: String,
    quota: PluginDataQuota,
}

impl<'a> PluginDataRepository<'a> {
    pub(crate) fn new(store: &'a Store, plugin_id: &str) -> Result<Self> {
        Self::with_quota(store, plugin_id, PluginDataQuota::default())
    }

    pub(crate) fn with_quota(
        store: &'a Store,
        plugin_id: &str,
        quota: PluginDataQuota,
    ) -> Result<Self> {
        let physical_namespace = plugin_namespace(plugin_id)?;
        Ok(Self {
            store,
            plugin_id: plugin_id.to_string(),
            physical_namespace,
            quota,
        })
    }

    pub fn get(&self, logical_namespace: &str, key: &str) -> Result<Option<Value>> {
        let encoded = self.encoded_key(logical_namespace, key)?;
        if let Some(value) = self.store.get(&self.physical_namespace, &encoded) {
            return decode_value(value).map(Some);
        }
        Ok(self.store.get(logical_namespace, key))
    }

    pub fn scan(&self, logical_namespace: &str, prefix: &str) -> Result<Vec<(String, Value)>> {
        validate_logical_key(prefix)?;
        let encoded_prefix = encoded_prefix(logical_namespace, prefix, &self.plugin_id)?;
        let encoded_namespace_prefix =
            encoded_namespace_prefix(logical_namespace, &self.plugin_id)?;
        let mut values = self
            .store
            .scan(logical_namespace, prefix)
            .into_iter()
            .filter(|(key, _)| !key.starts_with("v1:"))
            .collect::<std::collections::BTreeMap<_, _>>();
        for item in self
            .store
            .scan(&self.physical_namespace, &encoded_prefix)
            .into_iter()
        {
            let (key, value) = item;
            let logical_key = key
                .strip_prefix(&encoded_namespace_prefix)
                .ok_or_else(|| DataError::PluginData("插件数据 key 编码损坏".to_string()))?
                .to_string();
            values.insert(logical_key, decode_value(value)?);
        }
        Ok(values.into_iter().collect())
    }

    pub fn info(&self) -> Result<PluginDataInfo> {
        let entries = self.store.entries(&self.physical_namespace);
        Ok(PluginDataInfo {
            key_count: entries.len(),
            live_bytes: live_bytes(&entries)?,
            max_keys: self.quota.max_keys,
            max_total_bytes: self.quota.max_total_bytes,
        })
    }

    fn encoded_key(&self, logical_namespace: &str, key: &str) -> Result<String> {
        validate_logical_key(key)?;
        Ok(format!(
            "{}{key}",
            encoded_namespace_prefix(logical_namespace, &self.plugin_id)?
        ))
    }
}

pub struct PluginDataRepositoryMut<'a> {
    store: &'a mut Store,
    plugin_id: String,
    physical_namespace: String,
    quota: PluginDataQuota,
}

impl<'a> PluginDataRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store, plugin_id: &str) -> Result<Self> {
        Self::with_quota(store, plugin_id, PluginDataQuota::default())
    }

    pub(crate) fn with_quota(
        store: &'a mut Store,
        plugin_id: &str,
        quota: PluginDataQuota,
    ) -> Result<Self> {
        let physical_namespace = plugin_namespace(plugin_id)?;
        Ok(Self {
            store,
            plugin_id: plugin_id.to_string(),
            physical_namespace,
            quota,
        })
    }

    pub fn set(&mut self, logical_namespace: &str, key: &str, value: Value) -> Result<()> {
        let encoded = self.encoded_key(logical_namespace, key)?;
        let envelope = serde_json::to_value(PluginValueEnvelope {
            format: 1,
            payload: value,
        })?;
        let value_bytes = serde_json::to_vec(&envelope)?.len();
        if value_bytes > self.quota.max_value_bytes {
            return Err(DataError::PluginData(format!(
                "插件单值超过限制: {value_bytes} > {}",
                self.quota.max_value_bytes
            )));
        }

        let entries = self.store.entries(&self.physical_namespace);
        let existing = entries.iter().find(|(entry_key, _)| entry_key == &encoded);
        let next_keys = entries.len() + usize::from(existing.is_none());
        let existing_bytes = existing
            .map(|(_, old)| serde_json::to_vec(old).map(|bytes| bytes.len()))
            .transpose()?
            .unwrap_or(0);
        let next_bytes = live_bytes(&entries)? - existing_bytes + value_bytes;
        if next_keys > self.quota.max_keys || next_bytes > self.quota.max_total_bytes {
            return Err(DataError::PluginData(format!(
                "插件数据配额不足: keys={next_keys}/{}, bytes={next_bytes}/{}",
                self.quota.max_keys, self.quota.max_total_bytes
            )));
        }
        self.store
            .set(&self.physical_namespace, &encoded, envelope)?;
        if self.store.get(logical_namespace, key).is_some() {
            self.store.delete(logical_namespace, key)?;
        }
        if self.store.namespace_storage_bytes(&self.physical_namespace)
            > (self.quota.max_total_bytes as u64).saturating_mul(2)
        {
            self.store.compact(&self.physical_namespace)?;
        }
        Ok(())
    }

    pub fn delete(&mut self, logical_namespace: &str, key: &str) -> Result<()> {
        let encoded = self.encoded_key(logical_namespace, key)?;
        self.store.delete(&self.physical_namespace, &encoded)?;
        if self.store.get(logical_namespace, key).is_some() {
            self.store.delete(logical_namespace, key)?;
        }
        Ok(())
    }

    fn encoded_key(&self, logical_namespace: &str, key: &str) -> Result<String> {
        validate_logical_key(key)?;
        Ok(format!(
            "{}{key}",
            encoded_namespace_prefix(logical_namespace, &self.plugin_id)?
        ))
    }
}

fn plugin_namespace(plugin_id: &str) -> Result<String> {
    let namespace = format!("plugin.{plugin_id}");
    validate_namespace_name(&namespace)?;
    Ok(namespace)
}

fn encoded_namespace_prefix(logical_namespace: &str, plugin_id: &str) -> Result<String> {
    let scoped = format!("plugin.{plugin_id}");
    if logical_namespace != scoped && !logical_namespace.starts_with(&format!("{scoped}.")) {
        return Err(DataError::PluginData(
            "插件只能访问自己的私有数据容器".to_string(),
        ));
    }
    validate_namespace_name(logical_namespace)?;
    Ok(format!(
        "v1:{}:{logical_namespace}:",
        logical_namespace.len()
    ))
}

fn encoded_prefix(logical_namespace: &str, key_prefix: &str, plugin_id: &str) -> Result<String> {
    Ok(format!(
        "{}{key_prefix}",
        encoded_namespace_prefix(logical_namespace, plugin_id)?
    ))
}

fn validate_logical_key(key: &str) -> Result<()> {
    if key.len() > 1024 || key.contains('\0') {
        return Err(DataError::PluginData("插件数据 key 非法".to_string()));
    }
    Ok(())
}

fn decode_value(value: Value) -> Result<Value> {
    let envelope: PluginValueEnvelope = serde_json::from_value(value)?;
    if envelope.format != 1 {
        return Err(DataError::PluginData(format!(
            "不支持的插件数据格式: {}",
            envelope.format
        )));
    }
    Ok(envelope.payload)
}

fn live_bytes(entries: &[(String, Value)]) -> Result<usize> {
    entries
        .iter()
        .map(|(_, value)| serde_json::to_vec(value).map(|bytes| bytes.len()))
        .try_fold(0usize, |total, size| {
            size.map(|size| total.saturating_add(size))
        })
        .map_err(Into::into)
}
