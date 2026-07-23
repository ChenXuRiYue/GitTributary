use std::marker::PhantomData;

use crate::storage::Store;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::Result;

#[derive(Debug, PartialEq, Eq)]
pub struct DataKey<T> {
    namespace: &'static str,
    key: &'static str,
    marker: PhantomData<fn() -> T>,
}

impl<T> Copy for DataKey<T> {}

impl<T> Clone for DataKey<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> DataKey<T> {
    const fn new(namespace: &'static str, key: &'static str) -> Self {
        Self {
            namespace,
            key,
            marker: PhantomData,
        }
    }

    pub const fn namespace(self) -> &'static str {
        self.namespace
    }

    pub const fn key(self) -> &'static str {
        self.key
    }
}

pub mod setting_keys {
    use super::DataKey;

    pub const GIT_USERNAME: DataKey<String> = DataKey::new("settings", "git.username");
    pub const GIT_EMAIL: DataKey<String> = DataKey::new("settings", "git.email");
}

pub struct SettingsRepository<'a> {
    store: &'a Store,
}

impl<'a> SettingsRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn get<T: DeserializeOwned>(&self, key: DataKey<T>) -> Result<Option<T>> {
        self.store
            .get(key.namespace(), key.key())
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }
}

pub struct SettingsRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> SettingsRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn get<T: DeserializeOwned>(&self, key: DataKey<T>) -> Result<Option<T>> {
        SettingsRepository::new(self.store).get(key)
    }

    pub fn set<T: Serialize>(&mut self, key: DataKey<T>, value: T) -> Result<()> {
        self.store
            .set(key.namespace(), key.key(), serde_json::to_value(value)?)?;
        Ok(())
    }

    pub fn delete<T>(&mut self, key: DataKey<T>) -> Result<()> {
        self.store.delete(key.namespace(), key.key())?;
        Ok(())
    }
}
