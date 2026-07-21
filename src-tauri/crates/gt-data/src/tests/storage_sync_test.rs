//! Phase 1 同步数据层测试:latest_with_ts / set_with_ts / export / import LWW / 排除 private。
//! git 网络层(commit/pull/push)因 https-only 约束无法用本地 bare 仓库测试,留作手动验证。

use std::fs;
use std::path::Path;

use crate::storage::sync::SyncConfig;
use crate::storage::{Store, SyncEngine};
use serde_json::json;
use tempfile::TempDir;

fn engine_with_config(base: &Path, env: Option<&str>) -> SyncEngine {
    let engine = SyncEngine::new(base);
    engine
        .set_config(&SyncConfig {
            url: "https://github.com/example/gt-config.git".to_string(),
            branch: "main".to_string(),
            active_environment_id: env.map(|s| s.to_string()),
            local_database_path: None,
            auto_sync: false,
            interval_seconds: 300,
        })
        .unwrap();
    engine
}

fn env_data_dir(checkout: &Path) -> std::path::PathBuf {
    checkout.join("environments").join("default").join("data")
}

#[test]
fn test_latest_with_ts_and_set_with_ts_preserve_timestamp() {
    let dir = TempDir::new().unwrap();
    let mut store = Store::open(dir.path()).unwrap();

    // set_with_ts 保留指定 t
    store
        .set_with_ts("settings", "k", json!("v1"), 100)
        .unwrap();
    let latest = store.latest_with_ts("settings");
    let k = latest.get("k").expect("k 应存在");
    assert_eq!(k.0, json!("v1"));
    assert_eq!(k.1, 100);

    // 后写入的成为 latest(按文件追加顺序,与现有 Namespace 语义一致)
    store
        .set_with_ts("settings", "k", json!("v2"), 200)
        .unwrap();
    let latest = store.latest_with_ts("settings");
    let k = latest.get("k").expect("k 应存在");
    assert_eq!(k.0, json!("v2"));
    assert_eq!(k.1, 200);

    // 即便 t 更小,只要是最后追加的,就是当前值
    store.set_with_ts("settings", "k", json!("v3"), 50).unwrap();
    let latest = store.latest_with_ts("settings");
    let k = latest.get("k").expect("k 应存在");
    assert_eq!(k.0, json!("v3"));
    assert_eq!(k.1, 50);
}

#[test]
fn test_export_excludes_private_namespaces() {
    let dir = TempDir::new().unwrap();
    let base = dir.path().to_path_buf();
    let mut store = Store::open(&base).unwrap();
    store.set("settings", "theme", json!("light")).unwrap();
    store
        .set("private.credentials", "token", json!("secret-token"))
        .unwrap();

    let engine = engine_with_config(&base, None);
    let checkout = base.join("databases").join("test-checkout");
    fs::create_dir_all(&checkout).unwrap();

    engine.export_public_to_checkout(&store, &checkout).unwrap();

    let env_data = env_data_dir(&checkout);
    assert!(
        env_data.join("settings.jsonl").exists(),
        "public ns 应被导出"
    );
    assert!(
        !env_data.join("private.credentials.jsonl").exists(),
        "private ns 绝不能进入 checkout"
    );
}

#[test]
fn test_export_only_includes_explicitly_syncable_namespaces() {
    let dir = TempDir::new().unwrap();
    let base = dir.path().to_path_buf();
    let mut store = Store::open(&base).unwrap();
    store.set("settings", "theme", json!("light")).unwrap();
    store
        .set("workspace", "repo.active", json!("/machine/local/repo"))
        .unwrap();
    store.set("ui-state", "sidebar.width", json!(240)).unwrap();
    store
        .set(
            "plugin.com.example.demo",
            "config",
            json!({ "enabled": true }),
        )
        .unwrap();

    let engine = engine_with_config(&base, None);
    let checkout = base.join("databases").join("policy-checkout");
    fs::create_dir_all(&checkout).unwrap();

    engine.export_public_to_checkout(&store, &checkout).unwrap();

    let env_data = env_data_dir(&checkout);
    assert!(env_data.join("settings.jsonl").exists());
    assert!(!env_data.join("workspace.jsonl").exists());
    assert!(!env_data.join("ui-state.jsonl").exists());
    assert!(!env_data.join("plugin.com.example.demo.jsonl").exists());
}

#[test]
fn test_export_removes_stale_non_syncable_snapshots() {
    let dir = TempDir::new().unwrap();
    let base = dir.path().to_path_buf();
    let mut store = Store::open(&base).unwrap();
    store.set("settings", "theme", json!("light")).unwrap();
    let engine = engine_with_config(&base, None);
    let checkout = base.join("databases").join("stale-cleanup");
    let env_data = env_data_dir(&checkout);
    fs::create_dir_all(&env_data).unwrap();
    fs::write(env_data.join("ui-state.jsonl"), "legacy-private\n").unwrap();
    fs::write(env_data.join("plugin.demo.jsonl"), "legacy-plugin\n").unwrap();
    fs::write(env_data.join("README.txt"), "unrelated\n").unwrap();

    engine.export_public_to_checkout(&store, &checkout).unwrap();

    assert!(!env_data.join("ui-state.jsonl").exists());
    assert!(!env_data.join("plugin.demo.jsonl").exists());
    assert!(env_data.join("settings.jsonl").exists());
    assert!(env_data.join("README.txt").exists());
}

#[test]
fn test_export_then_import_lww() {
    // 设备 A:a@100, b@200
    let dir_a = TempDir::new().unwrap();
    let base_a = dir_a.path().to_path_buf();
    let mut store_a = Store::open(&base_a).unwrap();
    store_a
        .set_with_ts("settings", "a", json!("A1"), 100)
        .unwrap();
    store_a
        .set_with_ts("settings", "b", json!("B1"), 200)
        .unwrap();

    let engine_a = engine_with_config(&base_a, None);
    let checkout_a = base_a.join("databases").join("a");
    fs::create_dir_all(&checkout_a).unwrap();
    engine_a
        .export_public_to_checkout(&store_a, &checkout_a)
        .unwrap();

    // 设备 B:从 A 的 checkout import → 得到 a=A1, b=B1
    let dir_b = TempDir::new().unwrap();
    let base_b = dir_b.path().to_path_buf();
    let mut store_b = Store::open(&base_b).unwrap();
    let engine_b = engine_with_config(&base_b, None);
    engine_b
        .import_public_from_checkout(&mut store_b, &checkout_a)
        .unwrap();
    assert_eq!(store_b.get("settings", "a"), Some(json!("A1")));
    assert_eq!(store_b.get("settings", "b"), Some(json!("B1")));

    // B 新增 c@150,并把 a 改成 A2@50(比 A 的 100 更老)
    store_b
        .set_with_ts("settings", "c", json!("C1"), 150)
        .unwrap();
    store_b
        .set_with_ts("settings", "a", json!("A2"), 50)
        .unwrap();

    let checkout_b = base_b.join("databases").join("b");
    fs::create_dir_all(&checkout_b).unwrap();
    engine_b
        .export_public_to_checkout(&store_b, &checkout_b)
        .unwrap();

    // A 从 B 的 checkout import:
    //  - a:远端 t=50 < 本地 t=100 → 保留 A1
    //  - b:远端 t=200 >= 本地 t=200 → 保持 B1
    //  - c:本地无 → 引入 C1
    engine_a
        .import_public_from_checkout(&mut store_a, &checkout_b)
        .unwrap();
    assert_eq!(
        store_a.get("settings", "a"),
        Some(json!("A1")),
        "远端更老的 a 不应覆盖本地"
    );
    assert_eq!(store_a.get("settings", "b"), Some(json!("B1")));
    assert_eq!(
        store_a.get("settings", "c"),
        Some(json!("C1")),
        "新增的 c 应被引入"
    );
}

#[test]
fn test_import_skips_private_files_in_checkout() {
    // 安全网:即便 checkout 误含 private 文件,import 也不应读取
    let dir = TempDir::new().unwrap();
    let base = dir.path().to_path_buf();
    let mut store = Store::open(&base).unwrap();

    let engine = engine_with_config(&base, None);
    let checkout = base.join("databases").join("x");
    let env_data = env_data_dir(&checkout);
    fs::create_dir_all(&env_data).unwrap();
    // 误放的 private 文件
    fs::write(
        env_data.join("private.credentials.jsonl"),
        "{\"k\":\"token\",\"v\":\"leaked\",\"t\":999}\n",
    )
    .unwrap();
    fs::write(
        env_data.join("settings.jsonl"),
        "{\"k\":\"theme\",\"v\":\"dark\",\"t\":10}\n",
    )
    .unwrap();

    engine
        .import_public_from_checkout(&mut store, &checkout)
        .unwrap();
    assert_eq!(store.get("settings", "theme"), Some(json!("dark")));
    assert_eq!(
        store.get("private.credentials", "token"),
        None,
        "checkout 内的 private 文件必须被跳过"
    );
}

#[test]
fn test_import_skips_local_and_unknown_namespaces() {
    let dir = TempDir::new().unwrap();
    let base = dir.path().to_path_buf();
    let mut store = Store::open(&base).unwrap();

    let engine = engine_with_config(&base, None);
    let checkout = base.join("databases").join("policy-import");
    let env_data = env_data_dir(&checkout);
    fs::create_dir_all(&env_data).unwrap();
    fs::write(
        env_data.join("workspace.jsonl"),
        "{\"k\":\"repo.active\",\"v\":\"/other/device\",\"t\":10}\n",
    )
    .unwrap();
    fs::write(
        env_data.join("unknown.jsonl"),
        "{\"k\":\"value\",\"v\":42,\"t\":10}\n",
    )
    .unwrap();
    fs::write(
        env_data.join("flows.jsonl"),
        "{\"k\":\"workflow.demo\",\"v\":{\"enabled\":true},\"t\":10}\n",
    )
    .unwrap();

    engine
        .import_public_from_checkout(&mut store, &checkout)
        .unwrap();

    assert_eq!(store.get("workspace", "repo.active"), None);
    assert_eq!(store.get("unknown", "value"), None);
    assert_eq!(
        store.get("flows", "workflow.demo"),
        Some(json!({ "enabled": true }))
    );
}
