import type { FlowRunStatus, FlowTriggerSummary } from "../types";

export function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function statusTone(enabled: boolean) {
  return enabled
    ? "border-green-200 bg-green-50 text-green-700"
    : "border-slate-200 bg-slate-50 text-slate-600";
}

export function runStatusText(status: FlowRunStatus) {
  switch (status) {
    case "pending":
      return "等待中";
    case "running":
      return "运行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "skipped":
      return "已跳过";
    default:
      return status;
  }
}

export function runStatusTone(status: FlowRunStatus) {
  switch (status) {
    case "succeeded":
      return "border-green-200 bg-green-50 text-green-700";
    case "failed":
      return "border-red-200 bg-red-50 text-red-700";
    case "running":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "skipped":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function triggerText(trigger: FlowTriggerSummary) {
  switch (trigger.kind) {
    case "workflow_dispatch":
      return "手动运行入口";
    case "schedule":
      return "定时触发";
    case "file_watch":
      return "文件监听触发";
    case "store_changed":
      return "数据中心变更触发";
    default:
      if (trigger.kind.startsWith("git.")) return "Git 事件触发";
      if (trigger.kind.startsWith("flow.")) return "Flow 运行事件触发";
      return "事件触发";
  }
}

export function shortJson(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return String(value);
  }
}
