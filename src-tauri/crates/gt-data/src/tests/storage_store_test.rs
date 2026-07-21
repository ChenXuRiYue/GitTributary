use crate::storage::Store;
use serde_json::json;
use tempfile::TempDir;

fn setup() -> (TempDir, Store) {
    let dir = TempDir::new().unwrap();
    let store = Store::open(dir.path()).unwrap();
    (dir, store)
}

#[test]
fn test_get_set_delete() {
    let (_dir, mut store) = setup();

    // 初始为空
    assert_eq!(store.get("settings", "theme"), None);

    // 设置
    store.set("settings", "theme", json!("light")).unwrap();
    assert_eq!(store.get("settings", "theme"), Some(json!("light")));

    // 覆盖
    store.set("settings", "theme", json!("dark")).unwrap();
    assert_eq!(store.get("settings", "theme"), Some(json!("dark")));

    // 删除
    store.delete("settings", "theme").unwrap();
    assert_eq!(store.get("settings", "theme"), None);
}

#[test]
fn test_namespaces_and_keys() {
    let (_dir, mut store) = setup();

    store.set("settings", "a", json!(1)).unwrap();
    store.set("settings", "b", json!(2)).unwrap();
    store.set("ui-state", "x", json!("y")).unwrap();

    let mut ns = store.namespaces();
    ns.sort();
    assert_eq!(ns, vec!["settings", "ui-state"]);

    let mut keys = store.keys("settings");
    keys.sort();
    assert_eq!(keys, vec!["a", "b"]);
}

#[test]
fn test_scan_prefix() {
    let (_dir, mut store) = setup();

    store.set("settings", "sidebar.width", json!(220)).unwrap();
    store
        .set("settings", "sidebar.collapsed", json!(true))
        .unwrap();
    store.set("settings", "theme", json!("light")).unwrap();

    let results = store.scan("settings", "sidebar.");
    assert_eq!(results.len(), 2);
}

#[test]
fn test_persistence() {
    let dir = TempDir::new().unwrap();

    // 写入
    {
        let mut store = Store::open(dir.path()).unwrap();
        store.set("settings", "x", json!(42)).unwrap();
    }

    // 重新打开,数据应该还在
    {
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.get("settings", "x"), Some(json!(42)));
    }
}

#[test]
fn test_compact() {
    let (_dir, mut store) = setup();

    // 写入同一 key 多次
    for i in 0..10 {
        store.set("settings", "count", json!(i)).unwrap();
    }

    // compact 后值不变
    store.compact("settings").unwrap();
    assert_eq!(store.get("settings", "count"), Some(json!(9)));

    // 重新打开验证
    // (compact 重写了文件,重载应该正常)
}

#[test]
fn test_compact_preserves_lww_timestamp() {
    let (_dir, mut store) = setup();
    store
        .set_with_ts("settings", "count", json!(9), 123)
        .unwrap();
    store.compact("settings").unwrap();
    assert_eq!(store.latest_with_ts("settings")["count"].1, 123);
}

#[test]
fn test_history() {
    let (_dir, mut store) = setup();

    store.set("settings", "v", json!(1)).unwrap();
    store.set("settings", "v", json!(2)).unwrap();
    store.set("settings", "v", json!(3)).unwrap();

    let hist = store.history("settings", "v").unwrap();
    assert_eq!(hist.len(), 3);
    assert_eq!(hist[0].0, json!(1));
    assert_eq!(hist[2].0, json!(3));
}

#[test]
fn test_profiles() {
    let (_dir, mut store) = setup();

    // 设置基础 settings
    store.set("settings", "theme", json!("light")).unwrap();
    store
        .set("settings", "backup.interval", json!(300))
        .unwrap();

    // 创建 profile
    store.create_profile("work").unwrap();
    assert_eq!(store.active_profile(), Some("work"));

    // 修改 settings
    store.set("settings", "theme", json!("dark")).unwrap();

    // 创建第二个 profile
    store.create_profile("personal").unwrap();

    // 切换回 work → theme 应该恢复为 light
    store.switch_profile("work").unwrap();
    assert_eq!(store.get("settings", "theme"), Some(json!("light")));
    assert_eq!(store.active_profile(), Some("work"));

    // 列出 profiles
    let profiles = store.list_profiles().unwrap();
    assert!(profiles.contains(&"work".to_string()));
    assert!(profiles.contains(&"personal".to_string()));
}

#[test]
fn test_bound_repos_are_independent_from_active_repo() {
    let (_dir, mut store) = setup();
    store.init_workspace().unwrap();

    store.bind_repo("/tmp/repo-a").unwrap();
    store
        .sync_workspace(Some("/tmp/repo-b"), Some("main"))
        .unwrap();

    assert_eq!(store.active_repo(), Some("/tmp/repo-b".to_string()));
    assert_eq!(store.bound_repos(), vec!["/tmp/repo-a".to_string()]);

    store.bind_repo("/tmp/repo-a").unwrap();
    assert_eq!(store.bound_repos(), vec!["/tmp/repo-a".to_string()]);

    store.unbind_repo("/tmp/repo-a").unwrap();
    assert!(store.bound_repos().is_empty());
}

#[test]
fn test_rejects_unsafe_namespace_paths() {
    let dir = TempDir::new().unwrap();
    let mut store = Store::open(dir.path()).unwrap();

    assert!(store
        .set("plugin.demo.x/../../escape", "key", json!("value"))
        .is_err());
    assert!(store
        .set("plugin.demo\\escape", "key", json!("value"))
        .is_err());
    assert!(!dir.path().join("escape.jsonl").exists());
}
