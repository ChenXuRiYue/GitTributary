use std::sync::{Arc, Mutex};

use gt_data::DataHub;
use gt_flow::{EventPool, FlowNodeRegistry};
use gt_git::GitRepo;

use crate::application::plugins::host::PluginHostSupervisor;
use crate::application::plugins::registry::ExtensionRegistry;

/// 应用运行时共享状态。
pub struct AppState {
    pub repo: Mutex<Option<GitRepo>>,
    /// DataHub 是应用唯一的数据入口。
    pub data: Mutex<DataHub>,
    pub event_pool: Mutex<EventPool>,
    pub node_registry: Mutex<FlowNodeRegistry>,
    pub flow_execution: Mutex<()>,
    pub extensions: ExtensionRegistry,
    pub plugin_host: Arc<PluginHostSupervisor>,
}
