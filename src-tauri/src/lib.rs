use std::sync::{Arc, Mutex};

use gt_data::DataHub;
use gt_flow::{EventDraft, EventPool, EventReceipt, FlowNodeRegistry};
use gt_git::{GitRepo, RepoOverview};
use serde_json::json;
use tauri::Manager;

mod auth;
mod commands;
mod config_dir;
mod error;
mod extensions;
mod identity;
mod plugin_host;
mod plugin_market;
use commands::credentials::{
    clear_data_center_config_token, clear_git_token, get_data_center_config_credential_status,
    get_git_credentials, set_data_center_config_token, set_git_email, set_git_remote_url,
    set_git_ssh_key, set_git_token, set_git_username,
};
use commands::files::{files_list, files_read_text, files_scan, files_search};
use commands::flow::{
    flow_build_draft, flow_create_folder, flow_delete, flow_delete_folder, flow_emit_event,
    flow_event_catalog, flow_get, flow_list, flow_list_folders, flow_match_event,
    flow_node_catalog, flow_nodes, flow_recent_events, flow_records_from_data, flow_run,
    flow_run_journal, flow_run_list, flow_save, flow_set_enabled, flow_validate,
    inspect_flow_node_sources,
};
use commands::git::{
    checkout_branch, commit_all, commit_selected, create_branch, delete_branch, get_branch_log,
    get_branches, get_commit_file_diff, get_commit_files, get_file_diff, get_log, get_overview,
    get_status, open_repo, stage_all, stage_files,
};
use commands::remote::{
    add_remote, clone_remote_repo, get_remote_configs, get_remotes, git_fetch, git_pull, git_push,
    remove_remote, set_project_token, set_remote_url,
};
use commands::store::{
    store_active_environment, store_active_profile, store_compact, store_create_environment,
    store_create_profile, store_delete, store_delete_environment, store_delete_profile,
    store_entries, store_get, store_keys, store_list_environments, store_list_profiles,
    store_namespaces, store_scan, store_set, store_switch_environment, store_switch_profile,
};
use commands::sync::{
    check_data_center_config_repo, sync_data_center_now, sync_get_config, sync_get_state, sync_now,
    sync_set_config, unbind_data_center_config_remote, update_data_center_config_remote,
};
use commands::workspace::{get_recent_repos, get_workspace_info};
use extensions::{extension_call, extension_list, ExtensionRegistry};
use plugin_host::{plugin_host_ping, plugin_host_status, PluginHostSupervisor};
use plugin_market::{plugin_install, plugin_market_list, plugin_uninstall};

/// 应用状态
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

pub(crate) fn set_active_repo_state(
    repo: GitRepo,
    state: &AppState,
) -> Result<RepoOverview, String> {
    let overview = repo.metadata().map_err(|e| e.to_string())?;
    let branch = overview.current_branch.clone();
    let repo_path = overview.path.to_string_lossy().to_string();
    {
        let mut repo_lock = state.repo.lock().unwrap();
        *repo_lock = Some(repo);
    }
    {
        let mut data = state.data.lock().unwrap();
        let _ = data.workspace_mut().sync(Some(&repo_path), Some(&branch));
    }
    let _ = publish_flow_event(
        state,
        EventDraft {
            source: "gittributary://gt-git".to_string(),
            event_type: "git.repo.opened".to_string(),
            subject: Some(format!("repo:{repo_path}")),
            data: json!({
                "repo": repo_path,
                "branch": branch,
            }),
        },
    );
    Ok(overview)
}

// ─── Flow event bus (shared by commands::flow / commands::store / commands::git) ──

pub(crate) fn publish_flow_event(
    state: &AppState,
    event: EventDraft,
) -> Result<EventReceipt, String> {
    let flows = {
        let store = state.data.lock().unwrap();
        flow_records_from_data(&store)?
    };
    let mut event_pool = state.event_pool.lock().unwrap();
    event_pool
        .publish(event, &flows)
        .map_err(|error| error.to_string())
}

pub(crate) fn match_flow_event(
    state: &AppState,
    event: EventDraft,
) -> Result<EventReceipt, String> {
    let flows = {
        let store = state.data.lock().unwrap();
        flow_records_from_data(&store)?
    };
    let event_pool = state.event_pool.lock().unwrap();
    event_pool
        .match_event(event, &flows)
        .map_err(|error| error.to_string())
}

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
            extensions::asset_response(&extension_assets, &request)
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
            open_repo,
            get_overview,
            get_status,
            stage_all,
            stage_files,
            commit_all,
            commit_selected,
            get_file_diff,
            get_branches,
            create_branch,
            checkout_branch,
            delete_branch,
            get_log,
            get_branch_log,
            get_commit_files,
            get_commit_file_diff,
            get_remotes,
            get_remote_configs,
            clone_remote_repo,
            add_remote,
            set_remote_url,
            remove_remote,
            git_fetch,
            git_push,
            git_pull,
            set_project_token,
            files_list,
            files_scan,
            files_search,
            files_read_text,
            flow_validate,
            flow_build_draft,
            flow_save,
            flow_list,
            flow_get,
            flow_delete,
            flow_set_enabled,
            flow_list_folders,
            flow_create_folder,
            flow_delete_folder,
            flow_event_catalog,
            flow_recent_events,
            flow_emit_event,
            flow_match_event,
            flow_node_catalog,
            flow_nodes,
            flow_run,
            flow_run_journal,
            flow_run_list,
            store_get,
            store_set,
            store_delete,
            store_keys,
            store_namespaces,
            store_entries,
            store_scan,
            store_compact,
            store_list_profiles,
            store_list_environments,
            store_active_profile,
            store_active_environment,
            store_switch_profile,
            store_switch_environment,
            store_create_profile,
            store_create_environment,
            store_delete_profile,
            store_delete_environment,
            get_workspace_info,
            get_recent_repos,
            sync_get_config,
            sync_set_config,
            update_data_center_config_remote,
            unbind_data_center_config_remote,
            check_data_center_config_repo,
            sync_now,
            sync_get_state,
            get_git_credentials,
            get_data_center_config_credential_status,
            set_git_username,
            set_git_email,
            set_git_remote_url,
            set_git_token,
            clear_git_token,
            set_data_center_config_token,
            clear_data_center_config_token,
            set_git_ssh_key,
            extension_list,
            extension_call,
            plugin_market_list,
            plugin_install,
            plugin_uninstall,
            plugin_host_status,
            plugin_host_ping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
