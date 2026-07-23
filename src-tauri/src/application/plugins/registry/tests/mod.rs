mod assets;
mod capabilities;
mod contract;
mod validation;

use crate::AppState;

fn app_state(data: na_data::DataHub) -> AppState {
    AppState {
        repo: std::sync::Mutex::new(None),
        data: std::sync::Mutex::new(data),
        event_pool: std::sync::Mutex::new(na_flow::EventPool::new()),
        node_registry: std::sync::Mutex::new(na_flow::FlowNodeRegistry::new()),
        flow_execution: std::sync::Mutex::new(()),
        extensions: super::ExtensionRegistry::default(),
        plugin_host: std::sync::Arc::new(
            crate::application::plugins::host::PluginHostSupervisor::default(),
        ),
    }
}
