import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  shell: "src/core/git/GitPanel.tsx",
  changes: "src/core/git/views/ChangesView.tsx",
  history: "src/core/git/views/HistoryView.tsx",
  branches: "src/core/git/views/BranchesView.tsx",
  remote: "src/core/git/views/RemoteView.tsx",
};
const HISTORY_FIRST_PAGE_MAX = 100;

async function parse(relativePath) {
  const source = await readFile(path.join(ROOT, relativePath), "utf8");
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function invokeCalls(sourceFile, command) {
  const calls = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "invoke") return;
    const [name] = node.arguments;
    if (name && ts.isStringLiteralLike(name) && name.text === command) calls.push(node);
  });
  return calls;
}

function findVariableInitializer(sourceFile, variableName) {
  let initializer;
  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
    if (node.name.text === variableName) initializer = node.initializer;
  });
  return initializer;
}

function callsIdentifier(node, identifier) {
  let found = false;
  walk(node, (candidate) => {
    if (
      ts.isCallExpression(candidate)
      && ts.isIdentifier(candidate.expression)
      && candidate.expression.text === identifier
    ) {
      found = true;
    }
  });
  return found;
}

function activeViewHasKey(sourceFile) {
  let hasKey = false;
  walk(sourceFile, (node) => {
    if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return;
    if (!ts.isIdentifier(node.tagName) || node.tagName.text !== "ActiveView") return;
    hasKey ||= node.attributes.properties.some(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "key",
    );
  });
  return hasKey;
}

function numericConstants(sourceFile) {
  const values = new Map();
  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    if (ts.isNumericLiteral(node.initializer)) {
      values.set(node.name.text, Number(node.initializer.text));
    }
  });
  return values;
}

function historyLimit(call, constants) {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return null;
  const limit = options.properties.find(
    (property) => ts.isPropertyAssignment(property)
      && ((ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
        && property.name.text === "limit"),
  );
  if (!limit || !ts.isPropertyAssignment(limit)) return null;
  if (ts.isNumericLiteral(limit.initializer)) return Number(limit.initializer.text);
  if (ts.isIdentifier(limit.initializer)) return constants.get(limit.initializer.text) ?? null;
  return null;
}

const shell = await parse(FILES.shell);
const changes = await parse(FILES.changes);
const history = await parse(FILES.history);
const branches = await parse(FILES.branches);
const remote = await parse(FILES.remote);

const checks = [
  {
    name: "Git Shell 不为装饰统计加载 status/branches/log",
    run() {
      const forbidden = ["get_status", "get_branches", "get_log"]
        .filter((command) => invokeCalls(shell, command).length > 0);
      return forbidden.length === 0
        ? null
        : `${FILES.shell} 仍调用 ${forbidden.join(", ")}`;
    },
  },
  {
    name: "切换 Git Tab 不刷新上下文或重开仓库",
    run() {
      const handler = findVariableInitializer(shell, "selectView");
      if (!handler) return `${FILES.shell} 缺少 selectView，需同步更新契约定位`;
      const forbiddenCommands = ["open_repo", "get_overview", "get_workspace_info"]
        .filter((command) => invokeCallsInNode(handler, command).length > 0);
      if (callsIdentifier(handler, "refreshGitContext")) forbiddenCommands.push("refreshGitContext");
      return forbiddenCommands.length === 0
        ? null
        : `selectView 仍触发 ${forbiddenCommands.join(", ")}`;
    },
  },
  {
    name: "活动视图不使用 key 强制 remount",
    run: () => activeViewHasKey(shell) ? `${FILES.shell} 的 <ActiveView> 仍声明 key` : null,
  },
  {
    name: `History 首批日志显式限流且不超过 ${HISTORY_FIRST_PAGE_MAX}`,
    run() {
      const calls = invokeCalls(history, "get_log");
      if (calls.length === 0) return `${FILES.history} 缺少 get_log 首批加载`;
      const constants = numericConstants(history);
      const limits = calls.map((call) => historyLimit(call, constants));
      return limits.every((limit) => limit !== null && limit > 0 && limit <= HISTORY_FIRST_PAGE_MAX)
        ? null
        : `get_log limit 必须是可静态验证的 1..${HISTORY_FIRST_PAGE_MAX}，当前: ${limits.join(", ")}`;
    },
  },
  {
    name: "Changes 只有一个 status 扫描实现且不重开仓库",
    run() {
      const statusCount = invokeCalls(changes, "get_status").length;
      const openCount = invokeCalls(changes, "open_repo").length;
      if (statusCount === 1 && openCount === 0) return null;
      return `${FILES.changes} 当前 get_status=${statusCount}, open_repo=${openCount}；目标为 1, 0`;
    },
  },
  {
    name: "Branches 只有一个按需加载实现",
    run() {
      const branchLoads = invokeCalls(branches, "get_branches").length;
      const repoOpens = invokeCalls(branches, "open_repo").length;
      if (branchLoads === 1 && repoOpens === 0) return null;
      return `${FILES.branches} 当前 get_branches=${branchLoads}, open_repo=${repoOpens}；目标为 1, 0`;
    },
  },
  {
    name: "Remote 复用 Shell 仓库会话",
    run() {
      const forbidden = ["get_workspace_info", "open_repo", "get_overview"]
        .filter((command) => invokeCalls(remote, command).length > 0);
      return forbidden.length === 0
        ? null
        : `${FILES.remote} 仍调用 ${forbidden.join(", ")}`;
    },
  },
];

function invokeCallsInNode(node, command) {
  const calls = [];
  walk(node, (candidate) => {
    if (!ts.isCallExpression(candidate)) return;
    if (!ts.isIdentifier(candidate.expression) || candidate.expression.text !== "invoke") return;
    const [name] = candidate.arguments;
    if (name && ts.isStringLiteralLike(name) && name.text === command) calls.push(candidate);
  });
  return calls;
}

let failures = 0;
console.log(`Git performance contract (${checks.length} checks)`);
for (const check of checks) {
  const error = check.run();
  if (error) {
    failures += 1;
    console.error(`FAIL ${check.name}\n     ${error}`);
  } else {
    console.log(`PASS ${check.name}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${checks.length} performance contracts failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${checks.length} performance contracts passed.`);
}
