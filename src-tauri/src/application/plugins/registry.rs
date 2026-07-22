mod assets;
mod backend_payload;
mod call;
mod host_methods;
mod manifest;
mod path_update;
mod payload;
mod state;

pub use assets::asset_response;
pub use manifest::ExtensionManifest;
pub(crate) use manifest::{
    backend_library_relative_path, read_manifest, validate_backend_exists, validate_manifest,
};
pub use state::ExtensionRegistry;
pub(crate) use state::PluginFlowNodeBindingSnapshot;

#[tauri::command]
pub fn extension_list(state: tauri::State<'_, crate::AppState>) -> Vec<state::ExtensionListItem> {
    call::extension_list(state)
}

#[tauri::command]
pub async fn extension_call(
    plugin_id: String,
    generation: u64,
    method: String,
    payload: Option<serde_json::Value>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    call::extension_call(plugin_id, generation, method, payload, state).await
}

#[cfg(test)]
mod tests;
