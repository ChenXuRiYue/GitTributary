use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::ffi::{CStr, CString};
use std::fmt;
use std::os::raw::c_char;

pub const PLUGIN_ABI_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub repository: RepositoryInfo,
    pub branch: String,
    pub changed_files: usize,
    pub commits: Vec<CommitInfo>,
    pub flow_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepositoryInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitInfo {
    pub id: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInsightSummary {
    pub repository: RepositoryInfo,
    pub branch: String,
    pub changed_files: usize,
    pub commit_count: usize,
    pub contributor_count: usize,
    pub flow_count: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PluginError {
    UnsupportedMethod(String),
    InvalidPayload(String),
}

impl fmt::Display for PluginError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedMethod(method) => write!(formatter, "unsupported method: {method}"),
            Self::InvalidPayload(message) => write!(formatter, "invalid payload: {message}"),
        }
    }
}

impl std::error::Error for PluginError {}

pub fn summarize(snapshot: RepositorySnapshot) -> RepositoryInsightSummary {
    let contributors = snapshot
        .commits
        .iter()
        .map(|commit| commit.author.trim())
        .filter(|author| !author.is_empty())
        .collect::<BTreeSet<_>>();

    RepositoryInsightSummary {
        repository: snapshot.repository,
        branch: snapshot.branch,
        changed_files: snapshot.changed_files,
        commit_count: snapshot.commits.len(),
        contributor_count: contributors.len(),
        flow_count: snapshot.flow_count,
    }
}

/// Temporary JSON entrypoint used before the WIT-generated SDK is available.
/// The sidecar owns host calls and supplies their results as the request payload.
pub fn handle_request(method: &str, payload: Value) -> Result<Value, PluginError> {
    match method {
        "activate" => Ok(json!({
            "name": "repository-insights",
            "abiVersion": PLUGIN_ABI_VERSION
        })),
        "repository_summary" => {
            let snapshot_payload = payload.get("hostContext").cloned().unwrap_or(payload);
            let snapshot = serde_json::from_value(snapshot_payload)
                .map_err(|error| PluginError::InvalidPayload(error.to_string()))?;
            serde_json::to_value(summarize(snapshot))
                .map_err(|error| PluginError::InvalidPayload(error.to_string()))
        }
        _ => Err(PluginError::UnsupportedMethod(method.to_owned())),
    }
}

/// Loading probe only. Replace this with generated Component exports once the
/// GitTributary plugin WIT contract is stable.
#[no_mangle]
pub extern "C" fn gittributary_plugin_abi_version() -> u32 {
    PLUGIN_ABI_VERSION
}

/// MVP native ABI. The plugin is loaded only inside the isolated sidecar.
/// Strings are UTF-8 JSON and the returned allocation must be released with
/// `gittributary_plugin_free_string`.
#[no_mangle]
pub unsafe extern "C" fn gittributary_plugin_handle_request(
    method: *const c_char,
    payload: *const c_char,
) -> *mut c_char {
    if method.is_null() || payload.is_null() {
        return CString::new(r#"{"error":"invalid_pointer"}"#)
            .unwrap()
            .into_raw();
    }
    let method = CStr::from_ptr(method).to_string_lossy();
    let payload = CStr::from_ptr(payload).to_string_lossy();
    let result = serde_json::from_str::<Value>(&payload)
        .map_err(|error| PluginError::InvalidPayload(error.to_string()))
        .and_then(|value| handle_request(&method, value));
    let response = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    };
    CString::new(response.to_string()).unwrap().into_raw()
}

#[no_mangle]
pub unsafe extern "C" fn gittributary_plugin_free_string(value: *mut c_char) {
    if !value.is_null() {
        drop(CString::from_raw(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> RepositorySnapshot {
        RepositorySnapshot {
            repository: RepositoryInfo {
                id: "repo-1".into(),
                name: "Notes".into(),
            },
            branch: "main".into(),
            changed_files: 2,
            commits: vec![
                CommitInfo {
                    id: "a".into(),
                    author: "Mi".into(),
                },
                CommitInfo {
                    id: "b".into(),
                    author: "Alex".into(),
                },
                CommitInfo {
                    id: "c".into(),
                    author: "Mi".into(),
                },
                CommitInfo {
                    id: "d".into(),
                    author: "   ".into(),
                },
            ],
            flow_count: 3,
        }
    }

    #[test]
    fn builds_a_repository_summary() {
        let summary = summarize(snapshot());
        assert_eq!(summary.commit_count, 4);
        assert_eq!(summary.contributor_count, 2);
        assert_eq!(summary.changed_files, 2);
        assert_eq!(summary.flow_count, 3);
    }

    #[test]
    fn handles_json_requests() {
        let response = handle_request(
            "repository_summary",
            serde_json::to_value(snapshot()).unwrap(),
        )
        .unwrap();
        assert_eq!(response["repository"]["name"], "Notes");
        assert_eq!(response["contributorCount"], 2);
    }

    #[test]
    fn rejects_unknown_methods() {
        let error = handle_request("delete_everything", Value::Null).unwrap_err();
        assert_eq!(
            error,
            PluginError::UnsupportedMethod("delete_everything".into())
        );
    }
}
