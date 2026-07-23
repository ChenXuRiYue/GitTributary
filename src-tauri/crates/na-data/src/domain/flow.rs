use crate::storage::Store;
use na_flow::{record_from_value, record_to_value, workflow_key, FlowRecord};

use crate::Result;

pub struct FlowDefinitionRepository<'a> {
    store: &'a Store,
}

impl<'a> FlowDefinitionRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn get(&self, id: &str) -> Result<Option<FlowRecord>> {
        self.store
            .get(na_flow::FLOW_NAMESPACE, &workflow_key(id))
            .map(record_from_value)
            .transpose()
            .map_err(Into::into)
    }

    pub fn list(&self) -> Result<Vec<FlowRecord>> {
        self.store
            .scan(na_flow::FLOW_NAMESPACE, na_flow::FLOW_KEY_PREFIX)
            .into_iter()
            .map(|(_, value)| record_from_value(value).map_err(Into::into))
            .collect()
    }

    pub fn folders(&self) -> Result<Vec<String>> {
        self.store
            .get(na_flow::FLOW_NAMESPACE, na_flow::FLOW_FOLDERS_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map(|folders| folders.unwrap_or_default())
            .map_err(Into::into)
    }
}

pub struct FlowDefinitionRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> FlowDefinitionRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn get(&self, id: &str) -> Result<Option<FlowRecord>> {
        FlowDefinitionRepository::new(self.store).get(id)
    }

    pub fn save(&mut self, record: &FlowRecord) -> Result<()> {
        self.store.set(
            na_flow::FLOW_NAMESPACE,
            &workflow_key(&record.summary.id),
            record_to_value(record)?,
        )?;
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.store
            .delete(na_flow::FLOW_NAMESPACE, &workflow_key(id))?;
        Ok(())
    }

    pub fn save_folders(&mut self, folders: &[String]) -> Result<()> {
        self.store.set(
            na_flow::FLOW_NAMESPACE,
            na_flow::FLOW_FOLDERS_KEY,
            serde_json::to_value(folders)?,
        )?;
        Ok(())
    }
}
