use std::collections::{BTreeSet, HashSet};

use serde::Deserialize;

use super::super::host_methods::required_permission;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostApiContract {
    api_version: u32,
    methods: Vec<HostMethodContract>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostMethodContract {
    method: String,
    permission: Option<String>,
    permission_source: Option<String>,
    cases: Vec<HostMethodCase>,
}

#[derive(Deserialize)]
struct HostMethodCase {
    id: String,
    kind: String,
}

#[test]
fn maps_permissions_to_methods() {
    assert_eq!(required_permission("git.log"), Some("git:read"));
    assert_eq!(required_permission("store.set"), Some("store:write"));
    assert_eq!(required_permission("files.search"), Some("files:read"));
    assert_eq!(
        required_permission("files.replaceTree"),
        Some("files:write")
    );
    assert_eq!(
        required_permission("git.pathUpdate.commit"),
        Some("git:write")
    );
    assert_eq!(
        required_permission("repositories.addRemote"),
        Some("git:write")
    );
    assert_eq!(required_permission("shell.openPath"), Some("shell:open"));
    assert_eq!(required_permission("flow.run"), None);
}

#[test]
fn public_host_methods_match_the_plugin_testkit_contract() {
    let contract: HostApiContract = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../packages/plugin-testkit/src/host-methods.v1.json"
    )))
    .unwrap();
    assert_eq!(contract.api_version, 1);

    let expected = BTreeSet::from([
        "backend.invoke",
        "files.list",
        "files.readText",
        "files.replaceTree",
        "files.scan",
        "files.search",
        "flow.list",
        "git.log",
        "git.overview",
        "git.pathUpdate.commit",
        "git.pathUpdate.prepare",
        "repositories.active",
        "repositories.addRemote",
        "repositories.configs",
        "shell.openPath",
        "shell.openUrl",
        "shell.revealPath",
        "store.delete",
        "store.get",
        "store.set",
        "workspace.info",
    ]);
    let actual = contract
        .methods
        .iter()
        .map(|item| item.method.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(actual, expected);

    let mut case_ids = HashSet::new();
    for method in contract.methods {
        assert!(
            method.cases.iter().any(|case| case.kind == "success"),
            "{} must publish a canonical success case",
            method.method
        );
        for case in method.cases {
            assert!(case_ids.insert(case.id), "host case ids must be unique");
        }
        if method.method == "backend.invoke" {
            assert_eq!(method.permission, None);
            assert_eq!(method.permission_source.as_deref(), Some("backend.methods"));
        } else {
            assert_eq!(
                required_permission(&method.method).map(str::to_owned),
                method.permission,
                "permission drift for {}",
                method.method
            );
        }
    }
}
