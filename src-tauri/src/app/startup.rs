use std::sync::{Arc, Mutex};

use gt_data::DataHub;
use gt_flow::{EventDraft, EventPool};
use serde_json::json;
use tauri::Manager;

use crate::application::flow::commands::inspect_flow_node_sources;
use crate::application::plugins::host::PluginHostSupervisor;
use crate::application::plugins::registry::{self, ExtensionRegistry};
use crate::{publish_flow_event, AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化数据中心(存放在用户 home 下 .gittributary/)
    let store_dir = dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".git-tributary");
    let mut data = DataHub::open(&store_dir).expect("无法初始化数据中心");
    data.workspace_mut()
        .initialize()
        .expect("无法初始化 workspace");
    data.remote_metadata_mut()
        .migrate_default_remote_url()
        .expect("无法迁移 Git 默认远程配置");

    let plugins_dir = store_dir.join("plugins");
    if let Err(error) = std::fs::create_dir_all(&plugins_dir) {
        eprintln!("[extensions] 无法创建插件目录: {error}");
    }
    let extensions = ExtensionRegistry::discover(&plugins_dir);
    if let Err(error) = data.plugin_containers_mut().reconcile(
        extensions
            .list()
            .into_iter()
            .map(|extension| (extension.id, extension.version)),
    ) {
        eprintln!("[plugins] 无法协调插件数据容器状态: {error}");
    }
    let node_registry = inspect_flow_node_sources(&extensions)
        .unwrap_or_else(|error| panic!("无法汇聚 Flow 节点来源: {error}"));
    let extension_assets = extensions.clone();

    tauri::Builder::default()
        .register_uri_scheme_protocol("gt-plugin", move |_context, request| {
            registry::asset_response(&extension_assets, &request)
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            repo: Mutex::new(None),
            data: Mutex::new(data),
            event_pool: Mutex::new(EventPool::new()),
            node_registry: Mutex::new(node_registry),
            flow_execution: Mutex::new(()),
            extensions,
            plugin_host: Arc::new(PluginHostSupervisor::default()),
        })
        .setup(|app| {
            let state = app.state::<AppState>();
            if let Err(error) = state.plugin_host.start() {
                eprintln!("[gt-plugin-host] {error}");
            }
            let _ = publish_flow_event(
                &state,
                EventDraft {
                    source: "gittributary://app".to_string(),
                    event_type: "app.started".to_string(),
                    subject: Some("app:gittributary".to_string()),
                    data: json!({}),
                },
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::application::git::commands::open_repo,
            crate::application::git::commands::get_overview,
            crate::application::git::commands::get_status,
            crate::application::git::commands::stage_all,
            crate::application::git::commands::stage_files,
            crate::application::git::commands::commit_all,
            crate::application::git::commands::commit_selected,
            crate::application::git::commands::get_file_diff,
            crate::application::git::commands::get_branches,
            crate::application::git::commands::create_branch,
            crate::application::git::commands::checkout_branch,
            crate::application::git::commands::delete_branch,
            crate::application::git::commands::get_log,
            crate::application::git::commands::get_branch_log,
            crate::application::git::commands::get_commit_files,
            crate::application::git::commands::get_commit_file_diff,
            crate::application::git::remote::get_remotes,
            crate::application::git::remote::get_remote_configs,
            crate::application::git::remote::clone_remote_repo,
            crate::application::git::remote::add_remote,
            crate::application::git::remote::set_remote_url,
            crate::application::git::remote::remove_remote,
            crate::application::git::remote::git_fetch,
            crate::application::git::remote::git_push,
            crate::application::git::remote::git_pull,
            crate::application::git::remote::set_project_token,
            crate::application::files::commands::files_list,
            crate::application::files::commands::files_scan,
            crate::application::files::commands::files_search,
            crate::application::files::commands::files_read_text,
            crate::application::flow::commands::flow_validate,
            crate::application::flow::commands::flow_build_draft,
            crate::application::flow::commands::flow_save,
            crate::application::flow::commands::flow_list,
            crate::application::flow::commands::flow_get,
            crate::application::flow::commands::flow_delete,
            crate::application::flow::commands::flow_set_enabled,
            crate::application::flow::commands::flow_list_folders,
            crate::application::flow::commands::flow_create_folder,
            crate::application::flow::commands::flow_delete_folder,
            crate::application::flow::commands::flow_event_catalog,
            crate::application::flow::commands::flow_recent_events,
            crate::application::flow::commands::flow_emit_event,
            crate::application::flow::commands::flow_match_event,
            crate::application::flow::commands::flow_node_catalog,
            crate::application::flow::commands::flow_nodes,
            crate::application::flow::commands::flow_run,
            crate::application::flow::commands::flow_run_journal,
            crate::application::flow::commands::flow_run_list,
            crate::application::data::commands::store_get,
            crate::application::data::commands::store_set,
            crate::application::data::commands::store_delete,
            crate::application::data::commands::store_keys,
            crate::application::data::commands::store_namespaces,
            crate::application::data::commands::store_entries,
            crate::application::data::commands::store_scan,
            crate::application::data::commands::store_compact,
            crate::application::data::commands::store_list_environments,
            crate::application::data::commands::store_active_environment,
            crate::application::data::commands::store_switch_environment,
            crate::application::data::commands::store_create_environment,
            crate::application::data::commands::store_delete_environment,
            crate::application::data::workspace::get_workspace_info,
            crate::application::data::workspace::get_recent_repos,
            crate::application::data::sync::sync_get_config,
            crate::application::data::sync::spaces::sync_list_environments,
            crate::application::data::sync::spaces::sync_switch_environment,
            crate::application::data::sync::spaces::sync_create_space,
            crate::application::data::sync::sync_set_config,
            crate::application::data::sync::bind_data_center_config_remote,
            crate::application::data::sync::update_data_center_config_remote,
            crate::application::data::sync::unbind_data_center_config_remote,
            crate::application::data::sync::check_data_center_config_repo,
            crate::application::data::sync::sync_now,
            crate::application::data::sync::sync_get_state,
            crate::application::data::credentials::get_git_credentials,
            crate::application::data::credentials::get_data_center_config_credential_status,
            crate::application::data::credentials::set_git_username,
            crate::application::data::credentials::set_git_email,
            crate::application::data::credentials::set_git_remote_url,
            crate::application::data::credentials::set_git_token,
            crate::application::data::credentials::clear_git_token,
            crate::application::data::credentials::set_data_center_config_token,
            crate::application::data::credentials::clear_data_center_config_token,
            crate::application::data::credentials::set_git_ssh_key,
            crate::application::plugins::registry::extension_list,
            crate::application::plugins::registry::extension_call,
            crate::application::plugins::market::plugin_market_list,
            crate::application::plugins::market::plugin_install,
            crate::application::plugins::market::plugin_uninstall,
            crate::application::plugins::host::plugin_host_status,
            crate::application::plugins::host::plugin_host_ping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
