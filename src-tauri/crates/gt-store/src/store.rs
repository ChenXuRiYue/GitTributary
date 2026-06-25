use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::{Result, StoreError};
use crate::namespace::{Namespace, Visibility};

/// 数据中心主结构体
pub struct Store {
    /// 数据目录(.gittributary/data/)
    data_dir: PathBuf,
    /// profiles 目录(.gittributary/profiles/)
    profiles_dir: PathBuf,
    /// 已加载的命名空间
    namespaces: HashMap<String, Namespace>,
    /// 当前激活的 profile 名称
    active_profile: Option<String>,
}

/// 根据命名空间名推断可见性:
/// secrets / 以 "private." 开头 → Private,其他 → Public
pub fn infer_visibility(name: &str) -> Visibility {
    if name == "secrets" || name.starts_with("private.") {
        Visibility::Private
    } else {
        Visibility::Public
    }
}

impl Store {
    /// 打开(或初始化)数据中心
    /// base_dir: .gittributary/ 根目录
    pub fn open(base_dir: &Path) -> Result<Self> {
        let data_dir = base_dir.join("data");
        let profiles_dir = base_dir.join("profiles");
        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(&profiles_dir)?;

        let mut store = Self {
            data_dir,
            profiles_dir,
            namespaces: HashMap::new(),
            active_profile: None,
        };

        // 加载已有命名空间
        store.load_all_namespaces()?;

        // 加载 active profile
        store.load_active_profile()?;

        Ok(store)
    }

    /// 扫描 data/ 目录下所有 .jsonl 文件作为命名空间加载
    fn load_all_namespaces(&mut self) -> Result<()> {
        if !self.data_dir.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(&self.data_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                let name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let vis = infer_visibility(&name);
                let ns = Namespace::open(&self.data_dir, &name, vis)?;
                self.namespaces.insert(name, ns);
            }
        }
        Ok(())
    }

    /// 确保命名空间已加载(不存在则创建)
    fn ensure_namespace(&mut self, name: &str) -> Result<()> {
        if !self.namespaces.contains_key(name) {
            let vis = infer_visibility(name);
            let ns = Namespace::open(&self.data_dir, name, vis)?;
            self.namespaces.insert(name.to_string(), ns);
        }
        Ok(())
    }

    // ─── KV 操作 ──────────────────────────────────────────────

    pub fn get(&self, namespace: &str, key: &str) -> Option<Value> {
        self.namespaces.get(namespace)?.get(key).cloned()
    }

    pub fn set(&mut self, namespace: &str, key: &str, value: Value) -> Result<()> {
        self.ensure_namespace(namespace)?;
        self.namespaces
            .get_mut(namespace)
            .unwrap()
            .set(key, value)
    }

    pub fn delete(&mut self, namespace: &str, key: &str) -> Result<()> {
        self.ensure_namespace(namespace)?;
        self.namespaces
            .get_mut(namespace)
            .unwrap()
            .delete(key)
    }

    pub fn keys(&self, namespace: &str) -> Vec<String> {
        self.namespaces
            .get(namespace)
            .map(|ns| ns.keys())
            .unwrap_or_default()
    }

    pub fn scan(&self, namespace: &str, prefix: &str) -> Vec<(String, Value)> {
        self.namespaces
            .get(namespace)
            .map(|ns| ns.scan(prefix))
            .unwrap_or_default()
    }

    pub fn entries(&self, namespace: &str) -> Vec<(String, Value)> {
        self.namespaces
            .get(namespace)
            .map(|ns| ns.entries())
            .unwrap_or_default()
    }

    pub fn namespaces(&self) -> Vec<String> {
        self.namespaces.keys().cloned().collect()
    }

    /// 获取命名空间的可见性
    pub fn namespace_visibility(&self, namespace: &str) -> Option<Visibility> {
        self.namespaces.get(namespace).map(|ns| ns.visibility)
    }

    /// 列出可同步的命名空间(Public)
    pub fn public_namespaces(&self) -> Vec<String> {
        self.namespaces.iter()
            .filter(|(_, ns)| ns.visibility == Visibility::Public)
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// 列出仅本地的命名空间(Private)
    pub fn private_namespaces(&self) -> Vec<String> {
        self.namespaces.iter()
            .filter(|(_, ns)| ns.visibility == Visibility::Private)
            .map(|(k, _)| k.clone())
            .collect()
    }

    pub fn namespace_len(&self, namespace: &str) -> usize {
        self.namespaces.get(namespace).map(|ns| ns.len()).unwrap_or(0)
    }

    pub fn compact(&mut self, namespace: &str) -> Result<()> {
        self.namespaces
            .get_mut(namespace)
            .ok_or_else(|| StoreError::NamespaceNotFound(namespace.to_string()))?
            .compact()
    }

    pub fn history(&self, namespace: &str, key: &str) -> Result<Vec<(Value, i64)>> {
        self.namespaces
            .get(namespace)
            .ok_or_else(|| StoreError::NamespaceNotFound(namespace.to_string()))?
            .history(key)
    }

    /// 读取某命名空间每个 key 的最新值与时间戳。
    /// 命名空间不存在时返回空 map(供 import LWW 比较用)。
    pub fn latest_with_ts(&self, namespace: &str) -> HashMap<String, (Value, i64)> {
        self.namespaces
            .get(namespace)
            .map(|ns| ns.latest_with_ts())
            .unwrap_or_default()
    }

    /// 用指定时间戳写入(用于 import 远端记录时保留原始 t)。
    pub fn set_with_ts(
        &mut self,
        namespace: &str,
        key: &str,
        value: Value,
        t: i64,
    ) -> Result<()> {
        self.ensure_namespace(namespace)?;
        self.namespaces
            .get_mut(namespace)
            .unwrap()
            .set_with_ts(key, value, t)
    }

    // ─── Profile 管理 ─────────────────────────────────────────

    fn active_profile_path(&self) -> PathBuf {
        self.profiles_dir.join("_active.json")
    }

    fn load_active_profile(&mut self) -> Result<()> {
        let path = self.active_profile_path();
        if path.exists() {
            let content = fs::read_to_string(&path)?;
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&content) {
                self.active_profile = obj.get("active").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
        }
        Ok(())
    }

    pub fn active_profile(&self) -> Option<&str> {
        self.active_profile.as_deref()
    }

    pub fn list_profiles(&self) -> Result<Vec<String>> {
        let mut profiles = Vec::new();
        if !self.profiles_dir.exists() {
            return Ok(profiles);
        }
        for entry in fs::read_dir(&self.profiles_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                let name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                profiles.push(name);
            }
        }
        profiles.sort();
        Ok(profiles)
    }

    /// 切换 profile:加载对应 .jsonl 覆盖 settings 命名空间
    pub fn switch_profile(&mut self, name: &str) -> Result<()> {
        let profile_path = self.profiles_dir.join(format!("{}.jsonl", name));
        if !profile_path.exists() {
            return Err(StoreError::ProfileNotFound(name.to_string()));
        }

        // 加载 profile 文件的 KV 覆盖到 settings 命名空间
        let profile_ns = Namespace::open(&self.profiles_dir, name, Visibility::Public)?;
        self.ensure_namespace("settings")?;
        let settings = self.namespaces.get_mut("settings").unwrap();
        for (k, v) in profile_ns.entries() {
            settings.set(&k, v)?;
        }

        // 记录 active
        self.active_profile = Some(name.to_string());
        let active_json = serde_json::json!({ "active": name });
        fs::write(self.active_profile_path(), serde_json::to_string_pretty(&active_json)?)?;

        Ok(())
    }

    /// 基于当前 settings 创建 profile 快照
    pub fn create_profile(&mut self, name: &str) -> Result<()> {
        let profile_path = self.profiles_dir.join(format!("{}.jsonl", name));
        let entries = self.entries("settings");

        // 写入 profile 文件
        let mut ns = Namespace::open(&self.profiles_dir, name, Visibility::Public)?;
        for (k, v) in entries {
            ns.set(&k, v)?;
        }

        // 如果是第一个 profile,设为 active
        if self.active_profile.is_none() {
            self.active_profile = Some(name.to_string());
            let active_json = serde_json::json!({ "active": name });
            fs::write(self.active_profile_path(), serde_json::to_string_pretty(&active_json)?)?;
        }

        Ok(())
    }

    pub fn delete_profile(&mut self, name: &str) -> Result<()> {
        let path = self.profiles_dir.join(format!("{}.jsonl", name));
        if path.exists() {
            fs::remove_file(path)?;
        }
        if self.active_profile.as_deref() == Some(name) {
            self.active_profile = None;
            let _ = fs::remove_file(self.active_profile_path());
        }
        Ok(())
    }
}
