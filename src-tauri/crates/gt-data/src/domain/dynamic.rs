use crate::storage::{
    is_reserved_secret_namespace, validate_namespace_name, DataClass, NamespacePolicy, Sensitivity,
    Store, Visibility,
};
use serde_json::Value;

use crate::{DataError, Result};

const HOST_OWNED_NAMESPACES: &[&str] = &["plugin-containers"];

#[derive(Debug, Clone)]
pub struct DynamicNamespaceInfo {
    pub name: String,
    pub count: usize,
    pub visibility: Visibility,
    pub policy: NamespacePolicy,
}

pub struct DynamicDataRepository<'a> {
    store: &'a Store,
}

impl<'a> DynamicDataRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn get(&self, namespace: &str, key: &str) -> Result<Option<Value>> {
        require_read(self.store, namespace)?;
        Ok(self.store.get(namespace, key))
    }

    pub fn keys(&self, namespace: &str) -> Result<Vec<String>> {
        require_read(self.store, namespace)?;
        Ok(self.store.keys(namespace))
    }

    pub fn entries(&self, namespace: &str) -> Result<Vec<(String, Value)>> {
        require_read(self.store, namespace)?;
        Ok(self.store.entries(namespace))
    }

    pub fn scan(&self, namespace: &str, prefix: &str) -> Result<Vec<(String, Value)>> {
        require_read(self.store, namespace)?;
        Ok(self.store.scan(namespace, prefix))
    }

    pub fn namespaces(&self) -> Vec<DynamicNamespaceInfo> {
        self.store
            .namespaces()
            .into_iter()
            .filter_map(|name| {
                if HOST_OWNED_NAMESPACES.contains(&name.as_str()) {
                    return None;
                }
                let policy = self.store.namespace_policy(&name);
                (policy.sensitivity != Sensitivity::Secret).then(|| DynamicNamespaceInfo {
                    count: self.store.namespace_len(&name),
                    visibility: self
                        .store
                        .namespace_visibility(&name)
                        .unwrap_or(Visibility::Private),
                    policy,
                    name,
                })
            })
            .collect()
    }
}

pub struct DynamicDataRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> DynamicDataRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn set(&mut self, namespace: &str, key: &str, value: Value) -> Result<bool> {
        require_write(self.store, namespace)?;
        self.store.set(namespace, key, value)?;
        Ok(self.store.publishes_events(namespace))
    }

    pub fn delete(&mut self, namespace: &str, key: &str) -> Result<bool> {
        require_write(self.store, namespace)?;
        self.store.delete(namespace, key)?;
        Ok(self.store.publishes_events(namespace))
    }

    pub fn compact(&mut self, namespace: &str) -> Result<()> {
        require_write(self.store, namespace)?;
        self.store.compact(namespace)?;
        Ok(())
    }
}

fn require_read(store: &Store, namespace: &str) -> Result<()> {
    validate_namespace_name(namespace)?;
    if HOST_OWNED_NAMESPACES.contains(&namespace)
        || is_reserved_secret_namespace(namespace)
        || store.namespace_policy(namespace).sensitivity == Sensitivity::Secret
    {
        return Err(DataError::DynamicAccess(format!(
            "禁止通过动态数据 API 访问敏感命名空间: {namespace}"
        )));
    }
    Ok(())
}

fn require_write(store: &Store, namespace: &str) -> Result<()> {
    require_read(store, namespace)?;
    let policy = store.namespace_policy(namespace);
    if matches!(namespace, "workspace" | "private.local")
        || !matches!(policy.data_class, DataClass::LocalState | DataClass::Cache)
    {
        return Err(DataError::DynamicAccess(format!(
            "命名空间必须通过领域 Repository 写入: {namespace}"
        )));
    }
    Ok(())
}
