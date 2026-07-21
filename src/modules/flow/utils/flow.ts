import type { FileTreeLeaf } from "@/shared/components/FileTree";
import { DEFAULT_FLOW_FOLDER } from "../constants";
import type { FlowListItem, FlowSection, FlowSummary } from "../types";

export function flowSectionLabel(section: FlowSection) {
  switch (section) {
    case "events": return "事件";
    case "nodes": return "节点";
    case "flows":
    default:
      return "编排";
  }
}

export function defaultFlowFolder(summary: FlowSummary) {
  const trigger = summary.triggers[0]?.kind ?? "manual";
  if (trigger === "schedule") return "定时";
  if (trigger === "workflow_dispatch") return "手动";
  if (trigger === "file_watch") return "监听";
  if (trigger.startsWith("git.")) return "Git 事件";
  return "事件";
}

export function normalizeFolder(folder?: string | null, summary?: FlowSummary) {
  const normalized = (folder ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || (summary ? defaultFlowFolder(summary) : DEFAULT_FLOW_FOLDER);
}

export function flowFileName(id: string) {
  return `${id.replace(/^flow\./, "").split(".").join("-")}.yml`;
}

export function flowMarker(enabled: boolean): FileTreeLeaf["marker"] {
  return enabled ? "active" : "muted";
}

export function flowMarkerClass(marker?: FileTreeLeaf["marker"]) {
  switch (marker) {
    case "active":
      return "bg-green-500";
    case "warning":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    case "muted":
    default:
      return "bg-muted-foreground/35";
  }
}

export function summaryFromItem(item: FlowListItem): FlowSummary {
  return { ...item.summary, enabled: item.enabled };
}
