//! 只读探针: 直接对真实生产数据目录 (~/.git-tributary/data) 调用
//! Namespace::open + get，验证 `sites` 命名空间里的 `workspace.config`
//! 是否能正常重放出最新值。不会写入任何数据 (只调用 open/get，不调用
//! set/delete)。用于诊断"进入文档发布页面时任务列表为空"的问题，排除
//! gt-store 底层重放逻辑本身出错的可能性。
//!
//! 运行: cargo test --test real_data_probe -- --nocapture --ignored
//! (标记为 #[ignore] 因为它依赖本机真实数据目录，不适合在 CI/其他机器上跑)

use std::path::PathBuf;

use gt_store::namespace::Namespace;
use gt_store::Visibility;

fn real_data_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join(".git-tributary").join("data");
    if dir.exists() { Some(dir) } else { None }
}

#[test]
#[ignore]
fn probe_workspace_config_replay() {
    let dir = real_data_dir().expect("~/.git-tributary/data 不存在，无法探测");
    let ns = Namespace::open(&dir, "sites", Visibility::Public)
        .expect("打开 sites 命名空间失败");

    let raw = ns.get("workspace.config");
    match raw {
        None => {
            println!("[probe] workspace.config: 不存在于重放结果中 (get 返回 None)");
            panic!("workspace.config 缺失 —— 这本身就是问题所在");
        }
        Some(value) => {
            println!("[probe] workspace.config 重放结果 (原始 JSON):\n{}", serde_json::to_string_pretty(value).unwrap());
            let groups = value.get("groups").and_then(|g| g.as_array());
            match groups {
                None => panic!("[probe] groups 字段缺失或不是数组"),
                Some(arr) => {
                    println!("[probe] groups 数组长度: {}", arr.len());
                    for (i, g) in arr.iter().enumerate() {
                        println!(
                            "[probe]   #{}: id={:?} name={:?} sourceRepoPath={:?} has_target={} has_documentScope={} has_runHistory={} has_env={}",
                            i,
                            g.get("id"),
                            g.get("name"),
                            g.get("sourceRepoPath"),
                            g.get("target").is_some(),
                            g.get("documentScope").is_some(),
                            g.get("runHistory").is_some(),
                            g.get("env").is_some(),
                        );
                    }
                    assert!(!arr.is_empty(), "groups 数组重放结果为空 —— 复现了问题");
                }
            }
        }
    }
}

/// 额外探测: 直接统计 jsonl 文件里 workspace.config 相关的行数与最后一行，
/// 交叉验证 Namespace::open 的重放结果与文件本身是否一致。
#[test]
#[ignore]
fn probe_raw_jsonl_tail() {
    let dir = real_data_dir().expect("~/.git-tributary/data 不存在，无法探测");
    let path = dir.join("sites.jsonl");
    let content = std::fs::read_to_string(&path).expect("读取 sites.jsonl 失败");
    let lines: Vec<&str> = content.lines().collect();
    println!("[probe] sites.jsonl 总行数: {}", lines.len());

    let mut last_workspace_config_line: Option<&str> = None;
    let mut workspace_config_count = 0usize;
    for line in &lines {
        if line.contains("\"k\":\"workspace.config\"") {
            workspace_config_count += 1;
            last_workspace_config_line = Some(line);
        }
    }
    println!("[probe] workspace.config 记录条数: {}", workspace_config_count);
    match last_workspace_config_line {
        None => panic!("[probe] 文件里根本没有 workspace.config 记录"),
        Some(line) => {
            let parsed: serde_json::Value = serde_json::from_str(line).expect("最后一条 workspace.config 记录不是合法 JSON");
            let groups_len = parsed
                .get("v")
                .and_then(|v| v.get("groups"))
                .and_then(|g| g.as_array())
                .map(|a| a.len());
            println!("[probe] 文件里最后一条 workspace.config 的 groups 长度: {:?}", groups_len);
        }
    }
}
