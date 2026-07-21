use crate::{DataHub, PluginDataQuota};

#[test]
fn plugin_container_round_trips_opaque_values_including_null() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();

    data.plugin_data_mut("com.example.demo")
        .unwrap()
        .set(
            "plugin.com.example.demo.ui",
            "nullable",
            serde_json::Value::Null,
        )
        .unwrap();
    data.plugin_data_mut("com.example.demo")
        .unwrap()
        .set(
            "plugin.com.example.demo.cache",
            "object",
            serde_json::json!({ "schema": 7, "value": [1, 2, 3] }),
        )
        .unwrap();

    assert_eq!(
        data.plugin_data("com.example.demo")
            .unwrap()
            .get("plugin.com.example.demo.ui", "nullable")
            .unwrap(),
        Some(serde_json::Value::Null)
    );
    assert_eq!(
        data.plugin_data("com.example.demo")
            .unwrap()
            .get("plugin.com.example.demo.cache", "object")
            .unwrap(),
        Some(serde_json::json!({ "schema": 7, "value": [1, 2, 3] }))
    );
}

#[test]
fn plugin_container_uses_one_physical_namespace_for_subspaces() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();
    for namespace in [
        "plugin.com.example.demo.ui",
        "plugin.com.example.demo.cache",
        "plugin.com.example.demo.future-schema",
    ] {
        data.plugin_data_mut("com.example.demo")
            .unwrap()
            .set(namespace, "key", serde_json::json!(namespace))
            .unwrap();
    }

    let data_files = std::fs::read_dir(directory.path().join("data"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    assert_eq!(data_files, vec!["plugin.com.example.demo.jsonl"]);
}

#[test]
fn plugin_container_enforces_scope_and_quota() {
    let directory = tempfile::tempdir().unwrap();
    let mut data = DataHub::open(directory.path()).unwrap();
    let quota = PluginDataQuota {
        max_keys: 1,
        max_value_bytes: 128,
        max_total_bytes: 128,
    };

    assert!(data
        .plugin_data_mut_with_quota("com.example.demo", quota)
        .unwrap()
        .set("plugin.other", "key", serde_json::json!(1))
        .is_err());
    data.plugin_data_mut_with_quota("com.example.demo", quota)
        .unwrap()
        .set("plugin.com.example.demo", "one", serde_json::json!(1))
        .unwrap();
    assert!(data
        .plugin_data_mut_with_quota("com.example.demo", quota)
        .unwrap()
        .set("plugin.com.example.demo", "two", serde_json::json!(2))
        .is_err());
    assert!(data.plugin_data("../escape").is_err());
}

#[test]
fn plugin_container_reads_and_migrates_legacy_scoped_data() {
    let directory = tempfile::tempdir().unwrap();
    let mut raw = crate::storage::Store::open(directory.path()).unwrap();
    raw.set(
        "plugin.com.example.demo.ui",
        "legacy",
        serde_json::json!({ "version": 1 }),
    )
    .unwrap();
    let mut data = DataHub::from_store(raw);

    assert_eq!(
        data.plugin_data("com.example.demo")
            .unwrap()
            .get("plugin.com.example.demo.ui", "legacy")
            .unwrap(),
        Some(serde_json::json!({ "version": 1 }))
    );
    data.plugin_data_mut("com.example.demo")
        .unwrap()
        .set(
            "plugin.com.example.demo.ui",
            "legacy",
            serde_json::json!({ "version": 2 }),
        )
        .unwrap();
    assert_eq!(
        data.plugin_data("com.example.demo")
            .unwrap()
            .get("plugin.com.example.demo.ui", "legacy")
            .unwrap(),
        Some(serde_json::json!({ "version": 2 }))
    );
}
