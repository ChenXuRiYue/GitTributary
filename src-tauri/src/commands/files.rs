//! 文件管理 Core 的只读 Tauri 命令。

use gt_files::{
    FileWorkspace, ListOptions, ListReport, ScanOptions, ScanReport, SearchOptions, SearchReport,
    TextFile,
};

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
