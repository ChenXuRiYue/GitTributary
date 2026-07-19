// 探针脚本: 直接调用真正的 state.ts 里的 parseSiteWorkspaceConfigState，
// 喂入从 ~/.git-tributary/data/sites.jsonl 里提取出的真实最新 workspace.config
// 值，验证解析是否成功、结果是否符合预期。用 tsx 直接跑 TS 源码，不依赖
// vite/tauri 环境。
//
// 运行: npx tsx scripts/probe_parse_workspace_config.ts
import { readFileSync } from "node:fs";
import { parseSiteWorkspaceConfigState } from "../src/core/site/state";

const raw = JSON.parse(readFileSync("/tmp/real_workspace_config_value.json", "utf8"));

console.log("=== 输入 (真实存储数据) ===");
console.log("groups.length:", raw.groups?.length);
console.log("activeGroupId:", raw.activeGroupId);

console.log("\n=== 调用 parseSiteWorkspaceConfigState(raw) ===");
const result = parseSiteWorkspaceConfigState(raw);

if (result === null) {
  console.error("❌ 解析失败：parseSiteWorkspaceConfigState 返回 null");
  process.exit(1);
}

console.log("✅ 解析成功");
console.log("解析后 groups.length:", result.groups.length);
console.log("解析后 activeGroupId:", result.activeGroupId);
for (const g of result.groups) {
  console.log(`  - id=${g.id} name=${g.name} sourceRepoPath=${g.sourceRepoPath} documentScope.length=${g.documentScope.length} runHistory.length=${g.runHistory.length} target=${g.target ? "有" : "无"}`);
}

if (result.groups.length !== raw.groups.length) {
  console.error(`❌ 数量不一致！输入 ${raw.groups.length} 个任务，解析后只剩 ${result.groups.length} 个 —— 说明某些任务被 parseWorkspaceGroup 判定为非法而丢弃了`);
  process.exit(1);
}

console.log("\n✅ 解析结果与输入一致，前端解析函数没有问题。");
