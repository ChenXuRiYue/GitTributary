import type { FlowNodeDefinition } from "../types";

export function nodeTypeText(type: string) {
  switch (type) {
    case "context":
      return "上下文";
    case "guard":
      return "判断";
    case "build":
      return "构建";
    case "validate":
      return "校验";
    case "sync":
      return "同步";
    case "git":
      return "Git";
    case "notify":
      return "通知";
    default:
      return type;
  }
}

export function nodeTypeMeta(type: string) {
  switch (type) {
    case "context":
      return {
        label: "上下文节点",
        summary: "为一次 Flow 运行解析路径、仓库、分支和配置上下文。",
        description: "通常放在发布链路前段,把事件、工作区和数据中心配置转换成后续节点可引用的输入。",
      };
    case "guard":
      return {
        label: "判断节点",
        summary: "判断 Flow 是否继续运行。",
        description: "用于处理前置条件、变更检查和分支判断。P0 只登记类型,P1 再接入 skipped、failed 等执行语义。",
      };
    case "build":
      return {
        label: "构建节点",
        summary: "把源数据或笔记内容构建成可消费产物。",
        description: "用于 HTML、静态资源、索引等产物生成。它通常会输出目录或文件路径,供校验、同步和 Git 节点继续使用。",
      };
    case "validate":
      return {
        label: "校验节点",
        summary: "检查产物或前置条件是否满足发布要求。",
        description: "用于在写入、提交、推送前提前暴露问题,避免空产物、缺失路径或错误目标进入后续高风险节点。",
      };
    case "sync":
      return {
        label: "同步节点",
        summary: "在目录、仓库或数据空间之间同步内容。",
        description: "用于把构建产物移动到目标工作区。后续可扩展增量同步、冲突报告和孤儿文件处理。",
      };
    case "git":
      return {
        label: "Git 节点",
        summary: "执行 Git 仓库相关动作。",
        description: "用于提交、推送、拉取等仓库操作。它通常位于发布链路后段,需要在执行器阶段具备更强的失败解释能力。",
      };
    case "notify":
      return {
        label: "通知节点",
        summary: "把 Flow 结果反馈给用户或界面。",
        description: "用于展示运行完成、失败或需要人工处理的结果。P0 先作为动作定义存在,后续接运行日志和系统通知。",
      };
    default:
      return {
        label: nodeTypeText(type),
        summary: "自定义节点类型。",
        description: "当前节点类型未登记内置说明。后续如果成为稳定能力,应补充类型定位、输入输出边界和典型使用场景。",
      };
  }
}

export function nodeTypeTone(type: string) {
  switch (type) {
    case "build":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "git":
      return "border-green-200 bg-green-50 text-green-700";
    case "sync":
      return "border-purple-200 bg-purple-50 text-purple-700";
    case "validate":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "unknown":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function sortedNodeDefinitions(definitions: FlowNodeDefinition[]) {
  return definitions
    .slice()
    .sort((a, b) => a.node_type.localeCompare(b.node_type) || a.uses.localeCompare(b.uses));
}

export function nodeSearchText(definition: FlowNodeDefinition) {
  return [
    definition.uses,
    definition.name,
    definition.node_type,
    nodeTypeText(definition.node_type),
    definition.summary,
    definition.description,
    ...Object.keys(definition.inputs_schema),
    ...Object.keys(definition.outputs_schema),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function nodeMatchesQuery(definition: FlowNodeDefinition, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return nodeSearchText(definition).includes(normalized);
}

export function groupNodeDefinitionsByType(definitions: FlowNodeDefinition[]) {
  return definitions.reduce<Record<string, FlowNodeDefinition[]>>((groups, definition) => {
    const key = definition.node_type || "unknown";
    groups[key] = groups[key] ?? [];
    groups[key].push(definition);
    return groups;
  }, {});
}
