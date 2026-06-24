use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::Value;

use crate::error::Result;
use crate::record::Record;

/// 单个命名空间:对应一个 .jsonl 文件 + 内存 HashMap
pub struct Namespace {
    /// 命名空间名称
    pub name: String,
    /// .jsonl 文件路径
    path: PathBuf,
    /// 内存中的当前值(key → latest value)
    data: HashMap<String, Value>,
}

impl Namespace {
    /// 加载(或创建)一个命名空间
    pub fn open(dir: &Path, name: &str) -> Result<Self> {
        let path = dir.join(format!("{}.jsonl", name));
        let mut data = HashMap::new();

        if path.exists() {
            let file = File::open(&path)?;
            let reader = BufReader::new(file);
            for line in reader.lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(record) = serde_json::from_str::<Record>(&line) {
                    if record.v.is_null() {
                        data.remove(&record.k);
                    } else {
                        data.insert(record.k, record.v);
                    }
                }
            }
        }

        Ok(Self {
            name: name.to_string(),
            path,
            data,
        })
    }

    /// 获取值
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data.get(key)
    }

    /// 设置值(写入内存 + 追加到文件)
    pub fn set(&mut self, key: &str, value: Value) -> Result<()> {
        let record = Record {
            k: key.to_string(),
            v: value.clone(),
            t: Utc::now().timestamp(),
        };

        // 追加到文件
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let mut line = serde_json::to_string(&record)?;
        line.push('\n');
        file.write_all(line.as_bytes())?;

        // 更新内存
        self.data.insert(key.to_string(), value);
        Ok(())
    }

    /// 删除 key(写入 null 记录)
    pub fn delete(&mut self, key: &str) -> Result<()> {
        let record = Record {
            k: key.to_string(),
            v: Value::Null,
            t: Utc::now().timestamp(),
        };

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let mut line = serde_json::to_string(&record)?;
        line.push('\n');
        file.write_all(line.as_bytes())?;

        self.data.remove(key);
        Ok(())
    }

    /// 列出所有 key
    pub fn keys(&self) -> Vec<String> {
        self.data.keys().cloned().collect()
    }

    /// 按前缀扫描
    pub fn scan(&self, prefix: &str) -> Vec<(String, Value)> {
        self.data
            .iter()
            .filter(|(k, _)| k.starts_with(prefix))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// 条目数
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// 全部 KV(用于可视化)
    pub fn entries(&self) -> Vec<(String, Value)> {
        self.data.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    /// Compaction:重写文件只保留每个 key 的最新值
    pub fn compact(&mut self) -> Result<()> {
        let now = Utc::now().timestamp();
        let mut file = File::create(&self.path)?;
        for (k, v) in &self.data {
            let record = Record {
                k: k.clone(),
                v: v.clone(),
                t: now,
            };
            let mut line = serde_json::to_string(&record)?;
            line.push('\n');
            file.write_all(line.as_bytes())?;
        }
        Ok(())
    }

    /// 获取某 key 的历史值(从文件中全量扫描)
    pub fn history(&self, key: &str) -> Result<Vec<(Value, i64)>> {
        let mut result = Vec::new();
        if !self.path.exists() {
            return Ok(result);
        }
        let file = File::open(&self.path)?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line?;
            if let Ok(record) = serde_json::from_str::<Record>(&line) {
                if record.k == key {
                    result.push((record.v, record.t));
                }
            }
        }
        Ok(result)
    }

    /// 文件行数(判断是否需要 compact)
    pub fn file_lines(&self) -> Result<usize> {
        if !self.path.exists() {
            return Ok(0);
        }
        let file = File::open(&self.path)?;
        Ok(BufReader::new(file).lines().count())
    }
}
