use na_flow::{EventDraft, EventReceipt};
use na_git::{GitRepo, RepoOverview};
use serde_json::json;

use crate::application::flow::commands::flow_records_from_data;
use crate::AppState;

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
            source: "noteaura://na-git".to_string(),
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
