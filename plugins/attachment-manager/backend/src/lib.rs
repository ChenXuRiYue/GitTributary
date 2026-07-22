mod abi;
mod github;
mod model;
mod paths;
mod references;
mod rewrite;
mod scan;

use serde::Serialize;
use serde_json::Value;

use model::{
    GitHubConfigCheckRequest, GitHubMigrationRequest, PreviewChunkRequest, PreviewRequest,
    ScanRequest,
};

pub use abi::{
    gittributary_plugin_abi_version, gittributary_plugin_free_string,
    gittributary_plugin_handle_request, PLUGIN_ABI_VERSION,
};

pub fn handle_request(method: &str, payload: Value) -> Result<Value, String> {
    match method {
        "attachments.scan" => {
            let request = deserialize::<ScanRequest>(payload)?;
            serialize(scan::scan_repository(&request.repo_path)?)
        }
        "attachments.preview" => {
            let request = deserialize::<PreviewRequest>(payload)?;
            serialize(scan::read_preview(&request.repo_path, &request.path)?)
        }
        "attachments.previewChunk" => {
            let request = deserialize::<PreviewChunkRequest>(payload)?;
            serialize(scan::read_preview_chunk(
                &request.repo_path,
                &request.path,
                request.offset,
                request.expected_size,
            )?)
        }
        "attachments.checkGithubImageConfig" => {
            let request = deserialize::<GitHubConfigCheckRequest>(payload)?;
            serialize(github::check_github_config(request.config)?)
        }
        "attachments.migrateGithubImages" => {
            let request = deserialize::<GitHubMigrationRequest>(payload)?;
            serialize(github::migrate_github_images(request)?)
        }
        _ => Err(format!("unsupported method: {method}")),
    }
}

fn deserialize<T: serde::de::DeserializeOwned>(payload: Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|error| error.to_string())
}

fn serialize<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
