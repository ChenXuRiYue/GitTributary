use std::collections::BTreeMap;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const FLOW_NAMESPACE: &str = "flows";
pub const FLOW_KEY_PREFIX: &str = "workflow.";
pub const FLOW_FOLDERS_KEY: &str = "folders";
pub const DEFAULT_FLOW_FOLDER: &str = "未分类";

#[derive(Debug, Error)]
pub enum FlowError {
    #[error("YAML 解析失败: {0}")]
    Yaml(String),
    #[error("Flow 校验失败: {0}")]
    Validation(String),
    #[error("Flow 记录格式无效: {0}")]
    Record(String),
}

pub type Result<T> = std::result::Result<T, FlowError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowTriggerSummary {
    pub kind: String,
    pub label: String,
    pub detail: Option<String>,
    #[serde(default)]
    pub filters: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowStepSummary {
    pub id: Option<String>,
    pub name: Option<String>,
    pub uses: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowJobSummary {
    pub id: String,
    pub name: Option<String>,
    pub steps: Vec<FlowStepSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub triggers: Vec<FlowTriggerSummary>,
    pub jobs: Vec<FlowJobSummary>,
    pub step_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FlowRecord {
    pub raw_yaml: String,
    pub summary: FlowSummary,
    pub enabled: bool,
    #[serde(default)]
    pub folder: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl FlowRecord {
    pub fn new(
        raw_yaml: String,
        summary: FlowSummary,
        folder: Option<String>,
        created_at: String,
        updated_at: String,
    ) -> Self {
        let enabled = summary.enabled;
        let folder = Some(normalize_folder(folder.as_deref(), Some(&summary)));
        Self {
            raw_yaml,
            summary,
            enabled,
            folder,
            created_at,
            updated_at,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool, updated_at: String) {
        self.enabled = enabled;
        self.summary.enabled = enabled;
        self.updated_at = updated_at;
    }
}

pub fn normalize_folder(folder: Option<&str>, summary: Option<&FlowSummary>) -> String {
    let normalized = folder
        .unwrap_or("")
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .collect::<Vec<_>>()
        .join("/");

    if normalized.is_empty() {
        summary
            .map(default_folder_for_summary)
            .unwrap_or_else(|| DEFAULT_FLOW_FOLDER.to_string())
    } else {
        normalized
    }
}

pub fn default_folder_for_summary(summary: &FlowSummary) -> String {
    match summary
        .triggers
        .first()
        .map(|trigger| trigger.kind.as_str())
    {
        Some("schedule") => "定时".to_string(),
        Some("workflow_dispatch") => "手动".to_string(),
        Some("file_watch") => "监听".to_string(),
        Some(kind) if kind.starts_with("git.") => "Git 事件".to_string(),
        Some(_) => "事件".to_string(),
        None => DEFAULT_FLOW_FOLDER.to_string(),
    }
}

pub fn workflow_key(id: &str) -> String {
    format!("{FLOW_KEY_PREFIX}{id}")
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn record_from_value(value: serde_json::Value) -> Result<FlowRecord> {
    serde_json::from_value(value).map_err(|e| FlowError::Record(e.to_string()))
}

pub fn record_to_value(record: &FlowRecord) -> Result<serde_json::Value> {
    serde_json::to_value(record).map_err(|e| FlowError::Record(e.to_string()))
}
