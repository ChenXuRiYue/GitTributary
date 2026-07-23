use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("命名空间 '{0}' 不存在")]
    NamespaceNotFound(String),

    #[error("Profile '{0}' 不存在")]
    ProfileNotFound(String),

    #[error("操作失败: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;
