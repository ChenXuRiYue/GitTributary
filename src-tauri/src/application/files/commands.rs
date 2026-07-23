//! 文件管理 Core 的只读 Tauri 命令。

use std::collections::BTreeMap;

use na_files::{
    FileWorkspace, ListOptions, ListReport, ScanOptions, ScanReport, SearchOptions, SearchReport,
    TextFile,
};
use na_flow::FlowNodeDefinition;

pub(crate) fn flow_node_definitions() -> Vec<FlowNodeDefinition> {
    vec![
        FlowNodeDefinition {
            uses: "noteaura/files/assert-exists@v1".to_string(),
            name: "校验文件存在".to_string(),
            node_type: "validate".to_string(),
            summary: "检查目标路径是否存在并可选校验非空".to_string(),
            description: "在写入、提交或推送前确认文件或目录存在。".to_string(),
            inputs_schema: BTreeMap::from([
                ("path".to_string(), "string".to_string()),
                ("non_empty".to_string(), "boolean?".to_string()),
            ]),
            outputs_schema: BTreeMap::from([("path".to_string(), "string".to_string())]),
        },
        FlowNodeDefinition {
            uses: "noteaura/files/sync-dir@v1".to_string(),
            name: "同步目录".to_string(),
            node_type: "sync".to_string(),
            summary: "把源目录中的文件递归复制到目标目录".to_string(),
            description: "用于在本地目录之间同步构建产物；当前不会删除目标目录中的孤立文件。"
                .to_string(),
            inputs_schema: BTreeMap::from([
                ("from".to_string(), "string".to_string()),
                ("to".to_string(), "string".to_string()),
            ]),
            outputs_schema: BTreeMap::from([("changed_count".to_string(), "number".to_string())]),
        },
    ]
}

#[tauri::command]
pub(crate) fn files_list(
    root: String,
    relative_dir: Option<String>,
    options: Option<ListOptions>,
) -> Result<ListReport, String> {
    FileWorkspace::open(root)
        .and_then(|workspace| {
            workspace.list(
                relative_dir.as_deref().unwrap_or(""),
                options.unwrap_or_default(),
            )
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn files_scan(
    root: String,
    relative_dir: Option<String>,
    options: Option<ScanOptions>,
) -> Result<ScanReport, String> {
    FileWorkspace::open(root)
        .and_then(|workspace| {
            workspace.scan(
                relative_dir.as_deref().unwrap_or(""),
                options.unwrap_or_default(),
            )
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn files_search(
    root: String,
    relative_dir: Option<String>,
    query: String,
    options: Option<SearchOptions>,
) -> Result<SearchReport, String> {
    FileWorkspace::open(root)
        .and_then(|workspace| {
            workspace.search(
                relative_dir.as_deref().unwrap_or(""),
                &query,
                options.unwrap_or_default(),
            )
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn files_read_text(
    root: String,
    path: String,
    max_bytes: Option<usize>,
) -> Result<TextFile, String> {
    FileWorkspace::open(root)
        .and_then(|workspace| workspace.read_text(&path, max_bytes.unwrap_or(1024 * 1024)))
        .map_err(|error| error.to_string())
}
