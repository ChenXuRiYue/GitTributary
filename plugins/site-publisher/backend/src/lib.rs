use gt_site::SiteBuildConfig;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

pub const PLUGIN_ABI_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SitePublishRequest {
    build_config: SiteBuildConfig,
    target: SitePublishTarget,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SitePublishTarget {
    target_local_path: String,
    publish_dir: String,
    #[serde(default)]
    pages_url: String,
    #[serde(default)]
    auto_commit_message: String,
}

pub fn handle_request(method: &str, payload: Value) -> Result<Value, String> {
    match method {
        "site.scan" => {
            let repo_path = required_field::<String>(&payload, "repoPath")?;
            serialize(gt_site::scan_repo(repo_path).map_err(|error| error.to_string())?)
        }
        "site.build" => {
            let config = required_field::<SiteBuildConfig>(&payload, "config")?;
            serialize(gt_site::build_site(config).map_err(|error| error.to_string())?)
        }
        "flow.site.scan" => flow_scan(payload),
        "flow.site.build" => flow_build(payload),
        "site.publish.plan" => {
            let request = required_field::<SitePublishRequest>(&payload, "request")?;
            serialize(
                gt_site::plan_publish_target(
                    &request.build_config,
                    &request.target.target_local_path,
                    &request.target.publish_dir,
                )
                .map_err(|error| error.to_string())?,
            )
        }
        "site.publish.materialize" => {
            let request = required_field::<SitePublishRequest>(&payload, "request")?;
            serialize(
                gt_site::build_publish_artifact(
                    request.build_config,
                    &request.target.target_local_path,
                    &request.target.publish_dir,
                    &request.target.pages_url,
                    &request.target.auto_commit_message,
                )
                .map_err(|error| error.to_string())?,
            )
        }
        _ => Err(format!("unsupported method: {method}")),
    }
}

fn flow_scan(payload: Value) -> Result<Value, String> {
    let inputs = required_field::<BTreeMap<String, String>>(&payload, "inputs")?;
    let repo_path = inputs
        .get("repo_path")
        .or_else(|| inputs.get("repoPath"))
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| "missing flow input: repo_path".to_string())?;
    let report = gt_site::scan_repo(repo_path).map_err(|error| error.to_string())?;
    Ok(json!({
        "outputs": report,
        "skipped": false,
        "message": "site_scan_completed"
    }))
}

fn flow_build(payload: Value) -> Result<Value, String> {
    let inputs = required_field::<BTreeMap<String, String>>(&payload, "inputs")?;
    let config = SiteBuildConfig {
        repo_path: required_input(&inputs, "repo_path")?,
        output_dir: required_input(&inputs, "output_dir")?,
        site_title: required_input(&inputs, "site_title")?,
        include: list_input(&inputs, "include")?,
        exclude: optional_list_input(&inputs, "exclude")?,
        theme: optional_input(&inputs, "theme").unwrap_or_else(|| "typora-light".to_string()),
        with_search: boolean_input(&inputs, "with_search", true)?,
        copy_assets: boolean_input(&inputs, "copy_assets", true)?,
    };
    let report = gt_site::build_site(config).map_err(|error| error.to_string())?;
    Ok(json!({
        "outputs": report,
        "skipped": false,
        "message": "site_build_completed"
    }))
}

fn required_input(inputs: &BTreeMap<String, String>, key: &str) -> Result<String, String> {
    optional_input(inputs, key).ok_or_else(|| format!("missing flow input: {key}"))
}

fn optional_input(inputs: &BTreeMap<String, String>, key: &str) -> Option<String> {
    inputs
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn list_input(inputs: &BTreeMap<String, String>, key: &str) -> Result<Vec<String>, String> {
    let value = required_input(inputs, key)?;
    parse_list_input(&value).map_err(|error| format!("invalid flow input {key}: {error}"))
}

fn optional_list_input(
    inputs: &BTreeMap<String, String>,
    key: &str,
) -> Result<Vec<String>, String> {
    optional_input(inputs, key)
        .map(|value| {
            parse_list_input(&value).map_err(|error| format!("invalid flow input {key}: {error}"))
        })
        .transpose()
        .map(Option::unwrap_or_default)
}

fn parse_list_input(value: &str) -> Result<Vec<String>, String> {
    if value.starts_with('[') {
        return serde_json::from_str::<Vec<String>>(value).map_err(|error| error.to_string());
    }
    Ok(value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect())
}

fn boolean_input(
    inputs: &BTreeMap<String, String>,
    key: &str,
    default: bool,
) -> Result<bool, String> {
    match optional_input(inputs, key).as_deref() {
        None => Ok(default),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => Err(format!("invalid flow input {key}: expected true or false")),
    }
}

fn required_field<T: serde::de::DeserializeOwned>(
    payload: &Value,
    field: &str,
) -> Result<T, String> {
    payload
        .get(field)
        .cloned()
        .ok_or_else(|| format!("missing payload field: {field}"))
        .and_then(|value| serde_json::from_value(value).map_err(|error| error.to_string()))
}

fn serialize<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[no_mangle]
pub extern "C" fn gittributary_plugin_abi_version() -> u32 {
    PLUGIN_ABI_VERSION
}

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
        .map_err(|error| error.to_string())
        .and_then(|value| handle_request(&method, value));
    let response = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error }),
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

    #[test]
    fn scans_and_builds_through_plugin_methods() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("README.md"), "# Hello").unwrap();
        let scan = handle_request(
            "site.scan",
            json!({ "repoPath": temp.path().to_string_lossy() }),
        )
        .unwrap();
        assert_eq!(scan["markdownCount"], 1);

        let output = temp.path().join("site");
        let build = handle_request(
            "site.build",
            json!({
                "config": {
                    "repoPath": temp.path().to_string_lossy(),
                    "outputDir": output.to_string_lossy(),
                    "siteTitle": "Test",
                    "include": ["README.md"],
                    "exclude": [],
                    "theme": "typora-light",
                    "withSearch": true,
                    "copyAssets": true
                }
            }),
        )
        .unwrap();
        assert_eq!(build["pageCount"], 1);
    }

    #[test]
    fn plans_and_materializes_without_git_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join("README.md"), "# Hello").unwrap();
        let request = json!({
            "request": {
                "buildConfig": {
                    "repoPath": source,
                    "outputDir": source.join(".gittributary/site"),
                    "siteTitle": "Test",
                    "include": ["README.md"],
                    "exclude": [],
                    "theme": "typora-light",
                    "withSearch": true,
                    "copyAssets": true
                },
                "target": {
                    "targetLocalPath": target,
                    "publishDir": "docs",
                    "pagesUrl": "https://example.invalid/docs/",
                    "autoCommitMessage": "test: publish"
                }
            }
        });
        let plan = handle_request("site.publish.plan", request.clone()).unwrap();
        assert_eq!(plan["publishPathspec"], "docs");
        let artifact = handle_request("site.publish.materialize", request).unwrap();
        assert!(artifact["artifactPath"].as_str().is_some());
        assert!(source.join(".gittributary/site/.nojekyll").is_file());
    }

    #[test]
    fn scans_through_flow_node_contract() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("README.md"), "# Hello").unwrap();
        let outcome = handle_request(
            "flow.site.scan",
            json!({
                "inputs": { "repo_path": temp.path().to_string_lossy() },
                "context": {}
            }),
        )
        .unwrap();
        assert_eq!(outcome["skipped"], false);
        assert_eq!(outcome["outputs"]["markdownCount"], 1);
    }

    #[test]
    fn builds_through_flow_node_contract() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("README.md"), "# Hello").unwrap();
        let output = temp.path().join("site");
        let outcome = handle_request(
            "flow.site.build",
            json!({
                "inputs": {
                    "repo_path": temp.path().to_string_lossy(),
                    "output_dir": output.to_string_lossy(),
                    "site_title": "Test",
                    "include": "[\"README.md\"]",
                    "with_search": "false"
                },
                "context": {}
            }),
        )
        .unwrap();
        assert_eq!(outcome["skipped"], false);
        assert_eq!(outcome["outputs"]["pageCount"], 1);
        assert!(output.join("index.html").is_file());
    }
}
