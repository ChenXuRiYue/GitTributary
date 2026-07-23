use crate::storage::Store;

use crate::Result;

pub struct ProfileRepository<'a> {
    store: &'a Store,
}

impl<'a> ProfileRepository<'a> {
    pub(crate) fn new(store: &'a Store) -> Self {
        Self { store }
    }

    pub fn list(&self) -> Result<Vec<String>> {
        Ok(self.store.list_profiles()?)
    }

    pub fn active(&self) -> Option<String> {
        self.store.active_profile().map(str::to_string)
    }
}

pub struct ProfileRepositoryMut<'a> {
    store: &'a mut Store,
}

impl<'a> ProfileRepositoryMut<'a> {
    pub(crate) fn new(store: &'a mut Store) -> Self {
        Self { store }
    }

    pub fn switch(&mut self, name: &str) -> Result<()> {
        self.store.switch_profile(name)?;
        Ok(())
    }

    pub fn create(&mut self, name: &str) -> Result<()> {
        self.store.create_profile(name)?;
        Ok(())
    }

    pub fn delete(&mut self, name: &str) -> Result<()> {
        self.store.delete_profile(name)?;
        Ok(())
    }
}
