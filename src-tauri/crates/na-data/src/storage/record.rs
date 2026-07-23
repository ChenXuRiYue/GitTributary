use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSONL 中的单行记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    /// key(点分层级,如 "sidebar.width")
    pub k: String,
    /// value(任意 JSON 值,null 表示删除)
    pub v: Value,
    /// 写入时间(Unix 秒)
    pub t: i64,
}
