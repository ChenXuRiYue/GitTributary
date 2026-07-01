use std::sync::Mutex;

use gt_flow::{EventDraft, EventPool, EventReceipt, FlowNodeRegistry};
use gt_git::{GitRepo, RepoOverview};
use gt_store::Store;
use serde_json::json;
use tauri::Manager;

mod auth;
mod commands;
mod config_dir;
mod error;
mod identity;
mod keys;
use commands::credentials::{
    clear_data_center_config_token, clear_git_token, get_data_center_config_credential_status,
    get_git_credentials, set_data_center_config_token, set_git_email, set_git_remote_url,
    set_git_ssh_key, set_git_token, set_git_username,
};
use commands::flow::{
    flow_build_draft, flow_create_folder, flow_delete, flow_delete_folder, flow_emit_event,
    flow_event_catalog, flow_get, flow_list, flow_list_folders, flow_match_event,
    flow_node_catalog, flow_nodes, flow_recent_events, flow_records_from_store, flow_run,
    flow_save, flow_set_enabled, flow_validate,
};
use commands::git::{
    checkout_branch, commit_all, commit_selected, create_branch, delete_branch, get_branch_log,
    get_branches, get_commit_file_diff, get_commit_files, get_file_diff, get_log, get_overview,
    get_status, open_repo, stage_all, stage_files,
};
use commands::remote::{
    add_remote, clone_remote_repo, get_remote_configs, get_remotes, git_fetch, git_pull,
    git_push, remove_remote, set_project_token, set_remote_url,
};
use commands::site::{site_build, site_open_output, site_publish_pages, site_scan};
use commands::store::{
    store_active_environment, store_active_profile, store_compact, store_create_environment,
    store_create_profile, store_delete, store_delete_environment, store_delete_profile,
    store_entries, store_get, store_keys, store_list_environments, store_list_profiles,
    store_namespaces, store_scan, store_set, store_switch_environment, store_switch_profile,
};
use commands::sync::{
    check_data_center_config_repo, sync_data_center_now, sync_get_config, sync_get_state,
    sync_now, sync_set_config, unbind_data_center_config_remote,
    update_data_center_config_remote,
};
use commands::workspace::{get_recent_repos, get_workspace_info};

/// 应用状态
pub struct AppState {
    pub repo: Mutex<Option<GitRepo>>,
    pub store: Mutex<Store>,
    pub event_pool: Mutex<EventPool>,
    pub node_registry: Mutex<FlowNodeRegistry>,
}

pub(crate) fn set_active_repo_state(
    repo: GitRepo,
    state: &AppState,
) -> Result<RepoOverview, String> {
    let overview = repo.overview().map_err(|e| e.to_string())?;
    let branch = overview.current_branch.clone();
    let repo_path = overview.path.to_string_lossy().to_string();
    {
        let mut repo_lock = state.repo.lock().unwrap();
        *repo_lock = Some(repo);
    }
    {
        let mut store = state.store.lock().unwrap();
        let _ = store.sync_workspace(Some(&repo_path), Some(&branch));
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
        let store = state.store.lock().unwrap();
        flow_records_from_store(&store)
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
        let store = state.store.lock().unwrap();
        flow_records_from_store(&store)
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
    let mut store = Store::open(&store_dir).expect("无法初始化数据中心");
    store.init_workspace().expect("无法初始化 workspace");
    store
        .migrate_git_remote_url_to_local()
        .expect("无法迁移 Git 默认远程配置");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            repo: Mutex::new(None),
            store: Mutex::new(store),
            event_pool: Mutex::new(EventPool::new()),
            node_registry: Mutex::new(FlowNodeRegistry::new()),
        })
        .setup(|app| {
            let state = app.state::<AppState>();
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
            site_scan,
            site_build,
            site_publish_pages,
            site_open_output,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
