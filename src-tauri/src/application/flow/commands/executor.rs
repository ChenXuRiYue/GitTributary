use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use na_flow::{
    FlowActionExecutor, FlowActionOutcome, FlowExecutionContext, FlowNodeOwner, FlowNodeSpec,
};
use na_git::GitRepo;
use serde_json::{json, Value};

use crate::application::data::sync::sync_data_center_now;
use crate::application::git::auth::resolve_auth;
use crate::application::git::identity::{commit_identity_for_repo_remote, preferred_commit_remote};
use crate::application::plugins::registry::PluginFlowNodeBindingSnapshot;
use crate::AppState;

pub(super) const MAX_PLUGIN_NODE_OUTCOME_BYTES: usize = 256 * 1024;

pub(super) struct AppFlowActionExecutor<'a> {
    state: &'a AppState,
    plugin_bindings: BTreeMap<String, PluginFlowNodeBindingSnapshot>,
}

impl<'a> AppFlowActionExecutor<'a> {
    pub(super) fn new(
        state: &'a AppState,
        plugin_bindings: BTreeMap<String, PluginFlowNodeBindingSnapshot>,
    ) -> Self {
        Self {
            state,
            plugin_bindings,
        }
    }
}

impl FlowActionExecutor for AppFlowActionExecutor<'_> {
    fn execute(
        &mut self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> na_flow::Result<FlowActionOutcome> {
        if matches!(node.owner.as_ref(), Some(FlowNodeOwner::Plugin(_))) {
            return self.execute_plugin_node(node, inputs, context);
        }
        let outcome = match node.uses.as_str() {
            "noteaura/files/assert-exists@v1" => self.assert_exists(inputs),
            "noteaura/files/sync-dir@v1" => self.sync_dir(inputs),
            "noteaura/git/commit-all@v1" => self.commit_all(inputs),
            "noteaura/git/push@v1" => self.push(inputs),
            "noteaura/store/sync-now@v1" => self.sync_store(),
            _ => Err(na_flow::FlowError::Validation(format!(
                "节点动作未实现: {}",
                node.uses
            ))),
        }?;
        Ok(outcome)
    }
}

impl AppFlowActionExecutor<'_> {
    fn execute_plugin_node(
        &self,
        node: &FlowNodeSpec,
        inputs: &BTreeMap<String, String>,
        context: &FlowExecutionContext,
    ) -> na_flow::Result<FlowActionOutcome> {
        let binding = self.plugin_bindings.get(&node.uses).ok_or_else(|| {
            na_flow::FlowError::Validation(format!("插件节点运行快照不存在: {}", node.uses))
        })?;
        let value = self
            .state
            .extensions
            .invoke_flow_node(
                &self.state.plugin_host,
                binding,
                json!({
                    "inputs": inputs,
                    "context": {
                        "now": &context.now,
                    },
                }),
            )
            .map_err(to_validation_error)?;
        decode_plugin_node_outcome(&node.uses, value)
    }

    fn assert_exists(
        &self,
        inputs: &BTreeMap<String, String>,
    ) -> na_flow::Result<FlowActionOutcome> {
        let path = require_input(inputs, "path")?;
        let non_empty = inputs
            .get("non_empty")
            .map(|value| value == "true")
            .unwrap_or(false);
        let path_ref = Path::new(&path);
        if !path_ref.exists() {
            return Err(na_flow::FlowError::Validation(format!(
                "路径不存在: {}",
                path
            )));
        }
        if non_empty && is_empty_path(path_ref).map_err(to_validation_error)? {
            return Err(na_flow::FlowError::Validation(format!(
                "路径为空: {}",
                path
            )));
        }
        Ok(FlowActionOutcome {
            outputs: json!({ "path": path }),
            skipped: false,
            message: Some("path_exists".to_string()),
        })
    }

    fn sync_dir(&self, inputs: &BTreeMap<String, String>) -> na_flow::Result<FlowActionOutcome> {
        let from = require_input(inputs, "from")?;
        let to = require_input(inputs, "to")?;
        let changed_count =
            copy_dir_recursive(Path::new(&from), Path::new(&to)).map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "changed_count": changed_count }),
            skipped: false,
            message: Some(format!("synced {changed_count} files")),
        })
    }

    fn commit_all(&self, inputs: &BTreeMap<String, String>) -> na_flow::Result<FlowActionOutcome> {
        let repo_path = require_input(inputs, "repo")?;
        let message = require_input(inputs, "message")?;
        let repo = GitRepo::open(&repo_path).map_err(to_validation_error)?;
        let branch = repo.current_branch().unwrap_or_else(|_| "HEAD".to_string());
        let remote = preferred_commit_remote(&repo);
        let identity = commit_identity_for_repo_remote(self.state, &repo_path, remote.as_deref());
        repo.stage_all().map_err(to_validation_error)?;
        match repo.commit_with_identity(&message, &identity) {
            Ok(commit) => Ok(FlowActionOutcome {
                outputs: json!({ "commit": commit.id, "branch": branch }),
                skipped: false,
                message: Some("committed".to_string()),
            }),
            Err(na_git::GitError::NothingToCommit) => Ok(FlowActionOutcome {
                outputs: json!({ "commit": Value::Null, "branch": branch }),
                skipped: true,
                message: Some("nothing_to_commit".to_string()),
            }),
            Err(error) => Err(to_validation_error(error)),
        }
    }

    fn push(&self, inputs: &BTreeMap<String, String>) -> na_flow::Result<FlowActionOutcome> {
        let repo_path = require_input(inputs, "repo")?;
        let remote = require_input(inputs, "remote")?;
        let branch = require_input(inputs, "branch")?;
        let auth = resolve_auth(self.state);
        let repo = GitRepo::open(&repo_path).map_err(to_validation_error)?;
        repo.push(&remote, &branch, &auth)
            .map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "remote": remote, "branch": branch }),
            skipped: false,
            message: Some("pushed".to_string()),
        })
    }

    fn sync_store(&self) -> na_flow::Result<FlowActionOutcome> {
        let message = sync_data_center_now(self.state).map_err(to_validation_error)?;
        Ok(FlowActionOutcome {
            outputs: json!({ "message": message }),
            skipped: false,
            message: Some("store_synced".to_string()),
        })
    }
}

pub(super) fn decode_plugin_node_outcome(
    uses: &str,
    value: Value,
) -> na_flow::Result<FlowActionOutcome> {
    let size = serde_json::to_vec(&value)
        .map_err(to_validation_error)?
        .len();
    if size > MAX_PLUGIN_NODE_OUTCOME_BYTES {
        return Err(na_flow::FlowError::Validation(format!(
            "插件节点返回值超过 {} bytes 限制 ({uses}): {size}",
            MAX_PLUGIN_NODE_OUTCOME_BYTES
        )));
    }
    serde_json::from_value(value).map_err(|error| {
        na_flow::FlowError::Validation(format!("插件节点返回值无效 ({uses}): {error}"))
    })
}

pub(super) fn require_input(
    inputs: &BTreeMap<String, String>,
    key: &str,
) -> na_flow::Result<String> {
    inputs
        .get(key)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| na_flow::FlowError::Validation(format!("缺少输入: {key}")))
}

pub(super) fn is_empty_path(path: &Path) -> std::io::Result<bool> {
    if path.is_dir() {
        Ok(fs::read_dir(path)?.next().is_none())
    } else {
        Ok(path.metadata()?.len() == 0)
    }
}

pub(super) fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<usize> {
    if !from.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("源目录不存在: {}", from.display()),
        ));
    }
    fs::create_dir_all(to)?;
    let mut changed_count = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            changed_count += copy_dir_recursive(&source, &target)?;
        } else {
            fs::copy(&source, &target)?;
            changed_count += 1;
        }
    }
    Ok(changed_count)
}

fn to_validation_error(error: impl ToString) -> na_flow::FlowError {
    na_flow::FlowError::Validation(error.to_string())
}
