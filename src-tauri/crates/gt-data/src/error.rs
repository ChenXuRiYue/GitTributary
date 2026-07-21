use thiserror::Error;

#[derive(Debug, Error)]
pub enum DataError {
    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Storage(#[from] crate::storage::StoreError),

    #[error("数据序列化失败: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Flow 数据格式无效: {0}")]
    Flow(#[from] gt_flow::FlowError),

    #[error("运行日志错误: {0}")]
    RunJournal(String),

    #[error("运行结果错误: {0}")]
    RunResult(String),

    #[error("插件数据错误: {0}")]
    PluginData(String),

    #[error("插件容器错误: {0}")]
    PluginContainer(String),

    #[error("动态数据访问错误: {0}")]
    DynamicAccess(String),
}

pub type Result<T> = std::result::Result<T, DataError>;
