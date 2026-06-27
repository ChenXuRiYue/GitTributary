import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Code2,
  Database,
  Eye,
  FilePenLine,
  FolderPlus,
  FolderTree,
  List,
  ListPlus,
  Plus,
  Radio,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  Workflow,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileTree, type FileTreeLeaf } from "@/components/FileTree";
import { IconNav, type NavItem } from "@/components/IconNav";
import { Input } from "@/components/ui/input";
import { ResizeHandle } from "@/components/ResizeHandle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ViewMode = "read" | "operate";
type FlowListMode = "tree" | "list";
type FlowSection = "flows" | "events";

interface FlowTriggerSummary {
  kind: string;
  label: string;
  detail?: string | null;
  filters?: Record<string, string[]>;
}

interface EventDefinition {
  type: string;
  source: string;
  domain: string;
  summary: string;
  description: string;
  trigger_description: string;
  stability: string;
  filters: string[];
  data_schema: Record<string, string>;
}

interface FlowPermissionSummary {
  scope: string;
  values: string[];
  enabled: boolean;
}

interface FlowStepSummary {
  id?: string | null;
  name?: string | null;
  uses: string;
}

interface FlowJobSummary {
  id: string;
  name?: string | null;
  steps: FlowStepSummary[];
}

interface FlowSummary {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  triggers: FlowTriggerSummary[];
  permissions: FlowPermissionSummary[];
  jobs: FlowJobSummary[];
  step_count: number;
}

interface FlowRecord {
  raw_yaml: string;
  summary: FlowSummary;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  folder?: string | null;
}

interface FlowListItem {
  id: string;
  key: string;
  summary: FlowSummary;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  folder: string;
}

const SAMPLE_WORKFLOW = `name: 每日晚间备份

gt:
  id: flow.daily_evening_backup
  enabled: false
  description: 每天 18:00 检查当前仓库,有变更则提交

on:
  workflow_dispatch:

permissions:
  git: [status, commit]
  store: [read]

jobs:
  backup:
    runs-on: gittributary-local
    steps:
      - id: commit
        uses: gittributary/git/commit-all@v1
`;

const DEFAULT_FLOW_FOLDER = "未分类";

const flowNavItems: NavItem[] = [
  { id: "flows", name: "流", icon: Workflow },
  { id: "events", name: "事件列表", icon: Radio },
];

function defaultFlowFolder(summary: FlowSummary) {
  const trigger = summary.triggers[0]?.kind ?? "manual";
  if (trigger === "schedule") return "定时";
  if (trigger === "workflow_dispatch") return "手动";
  if (trigger === "file_watch") return "监听";
  if (trigger.startsWith("git.")) return "Git 事件";
  return "事件";
}

function normalizeFolder(folder?: string | null, summary?: FlowSummary) {
  const normalized = (folder ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || (summary ? defaultFlowFolder(summary) : DEFAULT_FLOW_FOLDER);
}

function flowFileName(id: string) {
  return `${id.replace(/^flow\./, "").split(".").join("-")}.yml`;
}

function permissionText(permission: FlowPermissionSummary) {
  if (!permission.enabled) return `${permission.scope}: false`;
  if (permission.values.length === 0) return `${permission.scope}: true`;
  return `${permission.scope}: ${permission.values.join(", ")}`;
}

function eventDomainMeta(domain: string) {
  switch (domain) {
    case "app":
      return {
        label: "应用",
        summary: "GitTributary 应用生命周期事件域。",
        description: "用于描述应用启动、关闭、恢复、初始化完成等全局生命周期信号。这个域适合承载启动后检查、会话恢复、全局状态初始化和应用级通知触发。",
      };
    case "ui":
      return {
        label: "界面",
        summary: "用户界面与人工操作事件域。",
        description: "用于描述用户主动发起的操作,例如手动运行 Flow、命令面板触发、后续按钮或交互入口触发。这个域强调人为意图,通常会携带 inputs。",
      };
    case "git":
      return {
        label: "Git",
        summary: "Git 仓库操作与状态变化事件域。",
        description: "用于描述仓库打开、提交创建、推送完成、拉取完成、分支变化等 Git 相关信号。这个域是笔记仓库自动化的主要入口,适合触发备份、同步、检查和发布类 Flow。",
      };
    case "store":
      return {
        label: "数据中心",
        summary: "GitTributary 数据中心配置变化事件域。",
        description: "用于描述公共配置、工作区状态、插件配置等数据中心 key 的变化。private 和 secrets 类命名空间默认不进入该域事件,避免敏感信息外泄。",
      };
    case "flow":
      return {
        label: "Flow",
        summary: "Flow 运行生命周期事件域。",
        description: "用于描述 Flow 自身的 queued、started、succeeded、failed、skipped 等运行结果。这个域用于串联 Flow、构建失败恢复链路和展示自动化运行状态。",
      };
    default:
      if (domain.startsWith("plugin.")) {
        return {
          label: "插件",
          summary: "插件扩展事件域。",
          description: "用于承载第三方或本地插件发布的事件。插件事件应通过 plugin.<plugin_id>.* 命名空间隔离,并声明事件定义、权限、版本和载荷 schema。",
        };
      }
      return {
        label: domain,
        summary: "自定义事件域。",
        description: "当前事件域未登记内置说明。后续如果该域成为稳定能力,应补充域定位、事件来源、权限边界和典型触发场景。",
      };
  }
}

function eventDomainText(domain: string) {
  return eventDomainMeta(domain).label;
}

function eventStabilityTone(stability: string) {
  switch (stability) {
    case "stable":
      return "border-green-200 bg-green-50 text-green-700";
    case "deprecated":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function groupEventsByDomain(events: EventDefinition[]) {
  return events.reduce<Record<string, EventDefinition[]>>((groups, event) => {
    const key = event.domain || "unknown";
    groups[key] = groups[key] ?? [];
    groups[key].push(event);
    return groups;
  }, {});
}

function sortedEvents(events: EventDefinition[]) {
  return events
    .slice()
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.type.localeCompare(b.type));
}

function eventSearchText(event: EventDefinition) {
  return [
    event.type,
    event.source,
    event.domain,
    event.summary,
    event.description,
    event.trigger_description,
    event.stability,
    ...event.filters,
    ...Object.keys(event.data_schema),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function eventMatchesQuery(event: EventDefinition, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return eventSearchText(event).includes(normalized);
}

function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusTone(enabled: boolean) {
  return enabled
    ? "border-green-200 bg-green-50 text-green-700"
    : "border-slate-200 bg-slate-50 text-slate-600";
}

function flowMarker(enabled: boolean): FileTreeLeaf["marker"] {
  return enabled ? "active" : "muted";
}

function flowMarkerClass(marker?: FileTreeLeaf["marker"]) {
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

function summaryFromItem(item: FlowListItem): FlowSummary {
  return { ...item.summary, enabled: item.enabled };
}

type FlowTreeSelection =
  | { type: "flow"; id: string }
  | { type: "folder"; path: string };

type FlowContextMenuState = {
  left: number;
  top: number;
  selection: FlowTreeSelection;
} | null;

type FlowPoint = {
  x: number;
  y: number;
};

const FLOW_ACTION_MENU_WIDTH = 152;
const FLOW_ACTION_ROW_HEIGHT = 32;
const FLOW_ACTION_MENU_PADDING_Y = 8;

function flowActionMenuHeight(selection: FlowTreeSelection) {
  return (selection.type === "folder" ? 3 : 2) * FLOW_ACTION_ROW_HEIGHT + FLOW_ACTION_MENU_PADDING_Y;
}

type FlowFolderCreateDraft = {
  parent: string;
  left: number;
  top: number;
  value: string;
} | null;

interface FlowFloatingActionsProps {
  menu: NonNullable<FlowContextMenuState>;
  onBeginCreateChildFolder: (folder: string, position: { left: number; top: number }) => void;
  onCreateFlow: (folder: string) => void;
  onDeleteFolder: (folder: string) => void;
  onEditFlow: (id: string) => void;
  onDeleteFlow: (id: string) => void;
}

function FlowFloatingActions({
  menu,
  onBeginCreateChildFolder,
  onCreateFlow,
  onDeleteFolder,
  onEditFlow,
  onDeleteFlow,
}: FlowFloatingActionsProps) {
  const content = (
    <div
      data-flow-floating-actions
      className="fixed z-[2147483647] rounded-md border bg-popover py-1 text-popover-foreground shadow-xl ring-1 ring-black/5"
      style={{ left: menu.left, top: menu.top, width: FLOW_ACTION_MENU_WIDTH }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {menu.selection.type === "folder" ? (
        <>
          <button
            type="button"
            title="新建子文件夹"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const folder = menu.selection.type === "folder" ? menu.selection.path : DEFAULT_FLOW_FOLDER;
              onBeginCreateChildFolder(folder, {
                left: menu.left,
                top: Math.min(menu.top + 6, window.innerHeight - 44),
              });
            }}
          >
            <FolderPlus className="size-3.5 shrink-0" />
            <span className="truncate">新建子文件夹</span>
          </button>
          <button
            type="button"
            title="添加 Flow"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => onCreateFlow(menu.selection.type === "folder" ? menu.selection.path : DEFAULT_FLOW_FOLDER)}
          >
            <FilePenLine className="size-3.5 shrink-0" />
            <span className="truncate">添加 Flow</span>
          </button>
          <button
            type="button"
            title="删除空文件夹"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              if (menu.selection.type === "folder") onDeleteFolder(menu.selection.path);
            }}
          >
            <Trash2 className="size-3.5 shrink-0" />
            <span className="truncate">删除空文件夹</span>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            title="编辑 YAML"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              if (menu.selection.type === "flow") onEditFlow(menu.selection.id);
            }}
          >
            <Code2 className="size-3.5 shrink-0" />
            <span className="truncate">编辑 YAML</span>
          </button>
          <button
            type="button"
            title="删除 Flow"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              if (menu.selection.type === "flow") onDeleteFlow(menu.selection.id);
            }}
          >
            <Trash2 className="size-3.5 shrink-0" />
            <span className="truncate">删除 Flow</span>
          </button>
        </>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

function FlowFolderCreateInput({
  draft,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: NonNullable<FlowFolderCreateDraft>;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-flow-folder-create]")) return;
      onCancel();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onCancel]);

  return createPortal(
    <div
      data-flow-folder-create
      className="fixed z-[2147483647] flex h-9 items-center gap-1 rounded-md border bg-popover px-1.5 shadow-xl ring-1 ring-black/5"
      style={{
        left: Math.min(draft.left, window.innerWidth - 220),
        top: draft.top,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <FolderPlus className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={draft.value}
        placeholder="新文件夹"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="h-7 w-40 rounded border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </div>,
    document.body,
  );
}

function FlowFileBrowser({
  flows,
  folders,
  selectedId,
  selectedFolder,
  onSelect,
  onContextMenu,
  canOperate,
  listMode,
  onListModeChange,
}: {
  flows: FlowListItem[];
  folders: string[];
  selectedId: string | null;
  selectedFolder: string | null;
  onSelect: (selection: FlowTreeSelection) => void;
  onContextMenu: (selection: FlowTreeSelection, point: FlowPoint) => void;
  canOperate: boolean;
  listMode: FlowListMode;
  onListModeChange: (mode: FlowListMode) => void;
}) {
  const selectedTreeId = selectedId ?? (selectedFolder ? `folder:${selectedFolder}` : undefined);
  const items = useMemo<FileTreeLeaf[]>(() => {
    const folderItems = folders.map((folder) => ({
      id: `folder:${folder}`,
      path: folder,
      label: folder.split("/").pop() ?? folder,
      icon: FolderTree,
      kind: "folder" as const,
    }));
    const flowItems = flows.map((flow) => {
      const summary = summaryFromItem(flow);
      const folder = normalizeFolder(flow.folder, summary);
      const file = flowFileName(flow.id);
      return {
        id: flow.id,
        path: `${folder}/${file}`,
        label: summary.name,
        subtitle: file,
        icon: Workflow,
        marker: flowMarker(flow.enabled),
      };
    });
    return [...folderItems, ...flowItems];
  }, [flows, folders]);
  const hasVisibleItems = items.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2">
        <span className="gt-label text-muted-foreground">流文件</span>
        <div className="inline-flex h-6 rounded-md border bg-background p-0.5">
          <button
            type="button"
            title="列表视图"
            onClick={() => onListModeChange("list")}
            className={cn(
              "flex size-5 items-center justify-center rounded transition-colors",
              listMode === "list" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            <List className="size-3.5" />
          </button>
          <button
            type="button"
            title="文件夹视图"
            onClick={() => onListModeChange("tree")}
            className={cn(
              "flex size-5 items-center justify-center rounded transition-colors",
              listMode === "tree" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            <FolderTree className="size-3.5" />
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" orientation="both">
        {!hasVisibleItems ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">还没有保存的 Flow。</div>
        ) : listMode === "tree" ? (
          <FileTree
            items={items}
            selectedId={selectedTreeId}
            onSelect={(id) => {
              if (id.startsWith("folder:")) {
                onSelect({ type: "folder", path: id.slice("folder:".length) });
              } else {
                onSelect({ type: "flow", id });
              }
            }}
            onContextMenu={(item, point) => {
              if (!canOperate) return;
              if (item.id.startsWith("folder:")) {
                onContextMenu({ type: "folder", path: item.id.slice("folder:".length) }, point);
              } else {
                onContextMenu({ type: "flow", id: item.id }, point);
              }
            }}
            defaultOpen="all"
            allowHorizontalScroll
            showFolderCount
          />
        ) : (
          <div className="min-w-max py-1 pr-2">
            {flows.map((flow) => {
              const summary = summaryFromItem(flow);
              const selected = flow.id === selectedId;
              const marker = flowMarker(flow.enabled);
              return (
                <button
                  key={flow.id}
                  type="button"
                  onClick={() => onSelect({ type: "flow", id: flow.id })}
                  className={cn(
                    "grid h-9 min-w-full grid-cols-[16px_minmax(168px,max-content)_minmax(120px,max-content)_auto] items-center gap-2 px-3 text-left transition-colors",
                    selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/45",
                  )}
                >
                  <Workflow className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="gt-tree whitespace-nowrap">{summary.name}</span>
                  <span className="gt-tree-meta whitespace-nowrap font-mono text-muted-foreground">
                    {flowFileName(flow.id)}
                  </span>
                  <span className={cn("size-1.5 rounded-full", flowMarkerClass(marker))} />
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const nextMode = mode === "read" ? "operate" : "read";
  const Icon = mode === "read" ? Wrench : Eye;
  const label = mode === "read" ? "切到操作模式" : "切到预览模式";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onChange(nextMode)}
      className={cn(
        "flex size-8 items-center justify-center rounded-md border bg-background transition-colors",
        mode === "read" ? "text-muted-foreground hover:bg-accent" : "bg-primary text-primary-foreground shadow-sm",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2 last:border-b-0">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="gt-label text-muted-foreground">{label}</p>
        <p className="gt-metric-compact truncate">{value}</p>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, aside }: { icon: LucideIcon; title: string; aside?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h4 className="gt-title-section truncate">{title}</h4>
      </div>
      {aside && <span className="gt-caption shrink-0 text-muted-foreground">{aside}</span>}
    </div>
  );
}

function EmptyState({ canOperate, onCreate }: { canOperate: boolean; onCreate: () => void }) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-md border bg-background p-5 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-muted">
          <Workflow className="size-5 text-muted-foreground" />
        </div>
        <h3 className="gt-title-panel mt-3">还没有 Flow</h3>
        <p className="gt-body mt-2 text-muted-foreground">
          先保存一个 YAML 工作流,这里会展示它的触发器、权限和步骤摘要。
        </p>
        {canOperate && (
          <Button className="mt-4" size="sm" onClick={onCreate}>
            <Plus className="size-3.5" />
            添加 Flow
          </Button>
        )}
      </div>
    </div>
  );
}

function EventCatalogView({
  events,
  isLoading,
}: {
  events: EventDefinition[];
  isLoading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [stabilityFilter, setStabilityFilter] = useState("all");
  const [filterabilityFilter, setFilterabilityFilter] = useState("all");
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const sorted = useMemo(() => sortedEvents(events), [events]);
  const domains = useMemo(() => Array.from(new Set(sorted.map((event) => event.domain))).sort(), [sorted]);
  const stabilities = useMemo(() => Array.from(new Set(sorted.map((event) => event.stability))).sort(), [sorted]);
  const filteredEvents = useMemo(() => {
    return sorted.filter((event) => {
      if (!eventMatchesQuery(event, query)) return false;
      if (domainFilter !== "all" && event.domain !== domainFilter) return false;
      if (stabilityFilter !== "all" && event.stability !== stabilityFilter) return false;
      if (filterabilityFilter === "filterable" && event.filters.length === 0) return false;
      if (filterabilityFilter === "plain" && event.filters.length > 0) return false;
      return true;
    });
  }, [domainFilter, filterabilityFilter, query, sorted, stabilityFilter]);
  const groupedFilteredEvents = groupEventsByDomain(filteredEvents);
  const groupedFilteredEntries = Object.entries(groupedFilteredEvents).sort(([a], [b]) => a.localeCompare(b));
  const selectedEvent = filteredEvents.find((event) => event.type === selectedType) ?? filteredEvents[0] ?? null;
  const selectedDomainMeta = selectedEvent ? eventDomainMeta(selectedEvent.domain) : null;
  const filterCount = events.reduce((count, event) => count + event.filters.length, 0);
  const schemaFieldCount = events.reduce((count, event) => count + Object.keys(event.data_schema).length, 0);
  const hasActiveFilters = Boolean(query.trim()) || domainFilter !== "all" || stabilityFilter !== "all" || filterabilityFilter !== "all";

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载事件列表...</div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden p-4">
        <section className="rounded-md border">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="gt-title-panel truncate">事件列表</h3>
                <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                  {events.length} 个事件
                </Badge>
              </div>
              <p className="gt-body mt-1 text-muted-foreground">
                当前事件池已登记的可触发信号,这些事件会作为 Flow 的入口。
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-4">
            <Metric label="事件数量" value={`${events.length}`} icon={Radio} />
            <Metric label="来源域" value={`${domains.length}`} icon={Database} />
            <Metric label="过滤字段" value={`${filterCount}`} icon={ListPlus} />
            <Metric label="载荷字段" value={`${schemaFieldCount}`} icon={Code2} />
          </div>
        </section>

        {selectedEvent && selectedDomainMeta && (
          <section className="rounded-md border">
            <SectionHeader
              icon={Database}
              title="当前域说明"
              aside={`${eventDomainText(selectedEvent.domain)} · ${filteredEvents.filter((event) => event.domain === selectedEvent.domain).length} events`}
            />
            <div className="px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="gt-body-strong truncate">{selectedDomainMeta.label}</p>
                <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                  {selectedEvent.domain}
                </Badge>
              </div>
              <p className="gt-caption mt-1 text-muted-foreground">{selectedDomainMeta.summary}</p>
              <p className="gt-body mt-2 text-muted-foreground">{selectedDomainMeta.description}</p>
            </div>
          </section>
        )}

        <section className="rounded-md border">
          <div className="grid gap-3 p-3 xl:grid-cols-[minmax(220px,1fr)_160px_150px_150px_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索事件名、来源、描述、载荷字段"
                className="h-8 pl-8"
              />
            </div>
            <select
              value={domainFilter}
              onChange={(event) => setDomainFilter(event.target.value)}
              className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
              aria-label="来源域筛选"
            >
              <option value="all">全部来源</option>
              {domains.map((domain) => (
                <option key={domain} value={domain}>{eventDomainText(domain)}</option>
              ))}
            </select>
            <select
              value={stabilityFilter}
              onChange={(event) => setStabilityFilter(event.target.value)}
              className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
              aria-label="稳定性筛选"
            >
              <option value="all">全部状态</option>
              {stabilities.map((stability) => (
                <option key={stability} value={stability}>{stability}</option>
              ))}
            </select>
            <select
              value={filterabilityFilter}
              onChange={(event) => setFilterabilityFilter(event.target.value)}
              className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
              aria-label="过滤能力筛选"
            >
              <option value="all">全部过滤能力</option>
              <option value="filterable">可过滤</option>
              <option value="plain">无过滤字段</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasActiveFilters}
              onClick={() => {
                setQuery("");
                setDomainFilter("all");
                setStabilityFilter("all");
                setFilterabilityFilter("all");
                setSelectedType(null);
              }}
            >
              清除
            </Button>
          </div>
          <div className="border-t px-3 py-2">
            <p className="gt-caption text-muted-foreground">
              当前显示 {filteredEvents.length} / {events.length} 个事件
            </p>
          </div>
        </section>

        {events.length === 0 ? (
          <section className="rounded-md border">
            <p className="gt-body px-4 py-3 text-muted-foreground">暂无已注册事件。</p>
          </section>
        ) : filteredEvents.length === 0 ? (
          <section className="rounded-md border">
            <p className="gt-body px-4 py-3 text-muted-foreground">没有符合筛选条件的事件。</p>
          </section>
        ) : (
          <section className="grid min-h-0 flex-1 overflow-hidden rounded-md border xl:grid-cols-[minmax(280px,0.42fr)_minmax(0,0.58fr)]">
            <div className="min-h-0 border-b xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <List className="size-4 shrink-0 text-muted-foreground" />
                  <h4 className="gt-title-section truncate">事件索引</h4>
                </div>
                <span className="gt-caption shrink-0 text-muted-foreground">{filteredEvents.length}</span>
              </div>
              <ScrollArea className="h-full" orientation="vertical">
                {groupedFilteredEntries.map(([domain, domainEvents]) => (
                  <div key={domain} className="border-b last:border-b-0">
                    <div className="sticky top-0 z-10 border-b bg-muted/70 px-3 py-1.5 backdrop-blur">
                      <p className="gt-label text-muted-foreground">{eventDomainText(domain)} · {domainEvents.length}</p>
                    </div>
                    {domainEvents.map((event) => {
                      const selected = selectedEvent?.type === event.type;
                      return (
                        <button
                          key={event.type}
                          type="button"
                          onClick={() => setSelectedType(event.type)}
                          className={cn(
                            "grid w-full grid-cols-[1fr_auto] gap-2 px-3 py-2.5 text-left transition-colors",
                            selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/45",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="gt-body-strong block truncate">{event.summary || event.description}</span>
                            <span className="gt-code mt-0.5 block truncate text-muted-foreground">{event.type}</span>
                          </span>
                          <span className="flex flex-col items-end gap-1">
                            <Badge variant="outline" className={cn("h-5 border", eventStabilityTone(event.stability))}>
                              {event.stability}
                            </Badge>
                            {event.filters.length > 0 && (
                              <span className="gt-caption text-muted-foreground">{event.filters.length} filters</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </ScrollArea>
            </div>

            <div className="min-h-0">
              {selectedEvent && (
                <div className="flex h-full min-w-0 flex-col">
                  <div className="border-b px-4 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h4 className="gt-title-panel truncate">{selectedEvent.summary || selectedEvent.description}</h4>
                      <Badge variant="outline" className={cn("h-5 border", eventStabilityTone(selectedEvent.stability))}>
                        {selectedEvent.stability}
                      </Badge>
                      <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                        {eventDomainText(selectedEvent.domain)}
                      </Badge>
                    </div>
                    <p className="gt-code mt-1 break-all text-muted-foreground">{selectedEvent.type}</p>
                    <p className="gt-caption mt-1 break-all text-muted-foreground">{selectedEvent.source}</p>
                  </div>

                  <ScrollArea className="min-h-0 flex-1" orientation="both">
                    <div className="space-y-4 p-4">
                      {selectedDomainMeta && (
                        <div className="rounded-md border bg-muted/20 px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Database className="size-3.5 shrink-0 text-muted-foreground" />
                            <p className="gt-body-strong truncate">{selectedDomainMeta.label}</p>
                          </div>
                          <p className="gt-caption mt-1 text-muted-foreground">{selectedDomainMeta.summary}</p>
                          <p className="gt-body mt-2 text-muted-foreground">{selectedDomainMeta.description}</p>
                        </div>
                      )}
                      <div>
                        <p className="gt-label text-muted-foreground">简要描述</p>
                        <p className="gt-body mt-1">{selectedEvent.description}</p>
                      </div>
                      <div>
                        <p className="gt-label text-muted-foreground">触发说明</p>
                        <p className="gt-body mt-1 text-muted-foreground">{selectedEvent.trigger_description}</p>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-md border">
                          <SectionHeader icon={ListPlus} title="过滤字段" aside={`${selectedEvent.filters.length}`} />
                          {selectedEvent.filters.length === 0 ? (
                            <p className="gt-body px-4 py-3 text-muted-foreground">该事件没有声明过滤字段。</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 p-3">
                              {selectedEvent.filters.map((filter) => (
                                <Badge key={filter} variant="outline" className="font-mono text-[10px]">
                                  {filter}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="rounded-md border">
                          <SectionHeader icon={Code2} title="事件载荷" aside={`${Object.keys(selectedEvent.data_schema).length}`} />
                          {Object.keys(selectedEvent.data_schema).length === 0 ? (
                            <p className="gt-body px-4 py-3 text-muted-foreground">该事件没有固定载荷字段。</p>
                          ) : (
                            <div className="divide-y">
                              {Object.entries(selectedEvent.data_schema).map(([key, value]) => (
                                <div key={key} className="grid grid-cols-[minmax(100px,0.45fr)_1fr] gap-2 px-3 py-2">
                                  <span className="gt-code truncate">{key}</span>
                                  <span className="gt-caption truncate text-muted-foreground">{value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </section>
        )}
    </div>
  );
}

function SummaryView({
  record,
  canOperate,
  onEdit,
  onToggle,
}: {
  record: FlowRecord;
  canOperate: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { summary } = record;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <section className="rounded-md border">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="gt-title-panel truncate">{summary.name}</h3>
              <Badge variant="outline" className={cn("h-5 border", statusTone(record.enabled))}>
                {record.enabled ? "已启用" : "已暂停"}
              </Badge>
            </div>
            {summary.description && (
              <p className="gt-body mt-1 text-muted-foreground">{summary.description}</p>
            )}
            <p className="gt-code mt-1 truncate text-muted-foreground">{summary.id}</p>
          </div>
          {canOperate && (
            <div className="flex shrink-0 items-center gap-2">
              <Switch checked={record.enabled} onCheckedChange={onToggle} />
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Code2 className="size-3.5" />
                编辑 YAML
              </Button>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-4">
          <Metric label="来源" value={`flows/${normalizeFolder(record.folder, summary)}/${flowFileName(summary.id)}`} icon={FilePenLine} />
          <Metric label="触发器" value={`${summary.triggers.length}`} icon={Radio} />
          <Metric label="权限域" value={`${summary.permissions.length}`} icon={ShieldCheck} />
          <Metric label="步骤" value={`${summary.step_count}`} icon={ListPlus} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-md border">
          <SectionHeader icon={Radio} title="触发器" />
          {summary.triggers.length === 0 ? (
            <p className="gt-body px-4 py-3 text-muted-foreground">未声明触发器。</p>
          ) : summary.triggers.map((trigger) => (
            <div key={trigger.kind} className="border-b px-4 py-3 last:border-b-0">
              <p className="gt-body-strong">{trigger.label}</p>
              {trigger.detail && <p className="gt-caption mt-0.5 text-muted-foreground">{trigger.detail}</p>}
            </div>
          ))}
        </section>

        <section className="rounded-md border">
          <SectionHeader icon={ShieldCheck} title="权限" />
          {summary.permissions.length === 0 ? (
            <p className="gt-body px-4 py-3 text-muted-foreground">未声明权限。</p>
          ) : summary.permissions.map((permission) => (
            <div key={permission.scope} className="border-b px-4 py-3 last:border-b-0">
              <p className="gt-code">{permissionText(permission)}</p>
            </div>
          ))}
        </section>
      </div>

      <section className="rounded-md border">
        <SectionHeader icon={Workflow} title="步骤摘要" aside={`${summary.jobs.length} jobs`} />
        {summary.jobs.map((job) => (
          <div key={job.id} className="border-b last:border-b-0">
            <div className="border-b bg-muted/25 px-4 py-2">
              <p className="gt-body-strong">{job.name || job.id}</p>
            </div>
            {job.steps.map((step, index) => (
              <div key={`${job.id}-${step.id ?? step.uses}-${index}`} className="grid grid-cols-[2rem_1fr] gap-3 border-b px-4 py-2.5 last:border-b-0">
                <span className="gt-caption text-muted-foreground">{index + 1}</span>
                <div className="min-w-0">
                  <p className="gt-code truncate">{step.uses}</p>
                  {(step.id || step.name) && (
                    <p className="gt-caption mt-0.5 text-muted-foreground">{step.name || step.id}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="rounded-md border">
        <SectionHeader icon={FilePenLine} title="存储信息" />
        <div className="grid md:grid-cols-2">
          <div className="border-b px-4 py-3 md:border-b-0 md:border-r">
            <p className="gt-label text-muted-foreground">创建时间</p>
            <p className="gt-body mt-1">{formatTime(record.created_at)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="gt-label text-muted-foreground">更新时间</p>
            <p className="gt-body mt-1">{formatTime(record.updated_at)}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function YamlEditor({
  yaml,
  folder,
  folders,
  status,
  error,
  isSaving,
  onChange,
  onFolderChange,
  onSave,
  onCancel,
  onDelete,
}: {
  yaml: string;
  folder: string;
  folders: string[];
  status: "idle" | "valid" | "invalid";
  error: string | null;
  isSaving: boolean;
  onChange: (value: string) => void;
  onFolderChange: (folder: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Code2 className="size-4 text-muted-foreground" />
          <h3 className="gt-title-panel">YAML</h3>
          {status === "valid" && (
            <Badge variant="outline" className="h-5 border-green-200 bg-green-50 text-green-700">
              <CheckCircle2 className="size-3" />
              可保存
            </Badge>
          )}
          {status === "invalid" && (
            <Badge variant="outline" className="h-5 border-red-200 bg-red-50 text-red-700">
              <XCircle className="size-3" />
              校验失败
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onDelete && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="size-3.5" />
              删除
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving || status === "invalid"}>
            <Save className="size-3.5" />
            保存
          </Button>
        </div>
      </div>
      {error && (
        <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <label className="gt-label shrink-0 text-muted-foreground" htmlFor="flow-folder-select">文件夹</label>
        <select
          id="flow-folder-select"
          value={folder}
          onChange={(event) => onFolderChange(event.target.value)}
          className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {folders.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <Textarea
          value={yaml}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="h-full min-h-[420px] resize-none font-mono text-xs leading-5"
        />
      </div>
    </div>
  );
}

export function FlowPanel() {
  const [section, setSection] = useState<FlowSection>("flows");
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [folders, setFolders] = useState<string[]>([DEFAULT_FLOW_FOLDER]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<FlowRecord | null>(null);
  const [mode, setMode] = useState<ViewMode>("read");
  const [isEditingYaml, setIsEditingYaml] = useState(false);
  const [listMode, setListMode] = useState<FlowListMode>("tree");
  const [fileListWidth, setFileListWidth] = useState(320);
  const [editorYaml, setEditorYaml] = useState(SAMPLE_WORKFLOW);
  const [editorFolder, setEditorFolder] = useState(DEFAULT_FLOW_FOLDER);
  const [contextMenu, setContextMenu] = useState<FlowContextMenuState>(null);
  const [folderCreateDraft, setFolderCreateDraft] = useState<FlowFolderCreateDraft>(null);
  const [editorStatus, setEditorStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEventsLoading, setIsEventsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canOperate = mode === "operate";
  const enabledCount = flows.filter((flow) => flow.enabled).length;

  const loadFlows = useCallback(async (preferredId?: string | null) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await invoke<FlowListItem[]>("flow_list");
      const folderList = await invoke<string[]>("flow_list_folders");
      const normalizedFolders = Array.from(new Set([
        ...folderList.map((folder) => normalizeFolder(folder)),
        ...list.map((flow) => normalizeFolder(flow.folder, flow.summary)),
      ])).sort();
      setFlows(list);
      setFolders(normalizedFolders.length > 0 ? normalizedFolders : [DEFAULT_FLOW_FOLDER]);
      const nextId = preferredId && list.some((flow) => flow.id === preferredId)
        ? preferredId
        : list[0]?.id ?? null;
      setSelectedId(nextId);
      if (nextId) {
        setSelectedFolder(null);
      }
      if (!nextId) {
        setSelectedRecord(null);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setIsEventsLoading(true);
    setLoadError(null);
    try {
      const list = await invoke<EventDefinition[]>("flow_event_catalog");
      setEvents(list);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsEventsLoading(false);
    }
  }, []);

  const loadRecord = useCallback(async (id: string | null) => {
    if (!id) {
      setSelectedRecord(null);
      return;
    }
    try {
      const record = await invoke<FlowRecord | null>("flow_get", { id });
      setSelectedRecord(record);
      if (record && isEditingYaml) {
        setEditorYaml(record.raw_yaml);
        setEditorFolder(normalizeFolder(record.folder, record.summary));
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setSelectedRecord(null);
    }
  }, [isEditingYaml]);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadRecord(selectedId);
  }, [loadRecord, selectedId]);

  useEffect(() => {
    if (!editorYaml.trim()) {
      setEditorStatus("idle");
      setEditorError(null);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        await invoke<FlowSummary>("flow_validate", { workflow: editorYaml });
        if (!cancelled) {
          setEditorStatus("valid");
          setEditorError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setEditorStatus("invalid");
          setEditorError(error instanceof Error ? error.message : String(error));
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [editorYaml]);

  const startCreate = () => {
    setSelectedId(null);
    setSelectedFolder(editorFolder);
    setSelectedRecord(null);
    setEditorYaml(SAMPLE_WORKFLOW);
    setEditorStatus("idle");
    setEditorError(null);
    setIsEditingYaml(true);
  };

  const startCreateInFolder = (folder: string) => {
    setEditorFolder(folder);
    setSelectedId(null);
    setSelectedFolder(folder);
    setSelectedRecord(null);
    setEditorYaml(SAMPLE_WORKFLOW);
    setEditorStatus("idle");
    setEditorError(null);
    setIsEditingYaml(true);
  };

  const startEdit = () => {
    if (selectedRecord) {
      setEditorYaml(selectedRecord.raw_yaml);
      setEditorFolder(normalizeFolder(selectedRecord.folder, selectedRecord.summary));
    } else if (selectedFolder) {
      setEditorFolder(selectedFolder);
    }
    setEditorStatus("idle");
    setEditorError(null);
    setIsEditingYaml(true);
  };

  const startEditFlowById = async (id: string) => {
    try {
      const record = await invoke<FlowRecord | null>("flow_get", { id });
      if (!record) return;
      setSelectedId(id);
      setSelectedFolder(null);
      setSelectedRecord(record);
      setEditorYaml(record.raw_yaml);
      setEditorFolder(normalizeFolder(record.folder, record.summary));
      setEditorStatus("idle");
      setEditorError(null);
      setIsEditingYaml(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const changeMode = (nextMode: ViewMode) => setMode(nextMode);

  const saveWorkflow = async () => {
    if (!editorYaml.trim()) {
      setEditorStatus("invalid");
      setEditorError("YAML 不能为空");
      return;
    }

    setIsSaving(true);
    try {
      const record = await invoke<FlowRecord>("flow_save", {
        request: { workflow: editorYaml, folder: editorFolder },
      });
      setSelectedRecord(record);
      setSelectedId(record.summary.id);
      setSelectedFolder(null);
      setIsEditingYaml(false);
      await loadFlows(record.summary.id);
    } catch (error) {
      setEditorStatus("invalid");
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (!selectedRecord) return;
    try {
      const record = await invoke<FlowRecord>("flow_set_enabled", {
        id: selectedRecord.summary.id,
        enabled,
      });
      setSelectedRecord(record);
      await loadFlows(record.summary.id);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteSelected = async () => {
    const id = selectedRecord?.summary.id;
    if (!id) return;
    try {
      await invoke("flow_delete", { id });
      setIsEditingYaml(false);
      await loadFlows(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteFlowById = async (id: string) => {
    try {
      await invoke("flow_delete", { id });
      setSelectedId(null);
      setSelectedRecord(null);
      setIsEditingYaml(false);
      await loadFlows(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const cancelEdit = () => {
    if (selectedRecord) {
      setEditorYaml(selectedRecord.raw_yaml);
    } else {
      setEditorYaml(SAMPLE_WORKFLOW);
    }
    setIsEditingYaml(false);
    setEditorStatus("idle");
    setEditorError(null);
  };

  const selectTreeItem = (selection: FlowTreeSelection) => {
    if (selection.type === "flow") {
      setSelectedId(selection.id);
      setSelectedFolder(null);
      setIsEditingYaml(false);
    } else {
      setSelectedId(null);
      setSelectedRecord(null);
      setSelectedFolder(selection.path);
      setEditorFolder(selection.path);
      setIsEditingYaml(false);
    }
  };

  const openContextMenu = (selection: FlowTreeSelection, point: FlowPoint) => {
    selectTreeItem(selection);
    setFolderCreateDraft(null);
    const menuHeight = flowActionMenuHeight(selection);
    setContextMenu({
      selection,
      left: Math.max(8, Math.min(point.x, window.innerWidth - FLOW_ACTION_MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(point.y, window.innerHeight - menuHeight - 8)),
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-flow-floating-actions]")) {
        return;
      }
      if (target?.closest("[data-flow-folder-create]")) {
        return;
      }
      closeContextMenu();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [contextMenu]);

  const persistFolder = async (path: string) => {
    const normalizedPath = normalizeFolder(path);
    try {
      const nextFolders = await invoke<string[]>("flow_create_folder", { path: normalizedPath });
      setFolders(nextFolders.length > 0 ? nextFolders : [DEFAULT_FLOW_FOLDER]);
      setSelectedId(null);
      setSelectedRecord(null);
      setSelectedFolder(normalizedPath);
      setEditorFolder(normalizedPath);
      setIsEditingYaml(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const beginCreateChildFolder = (parent: string, position: { left: number; top: number }) => {
    setContextMenu(null);
    setSelectedId(null);
    setSelectedRecord(null);
    setSelectedFolder(parent);
    setEditorFolder(parent);
    setFolderCreateDraft({
      parent,
      left: position.left,
      top: position.top,
      value: "新文件夹",
    });
  };

  const commitFolderCreateDraft = async () => {
    if (!folderCreateDraft) return;
    const input = folderCreateDraft.value.trim();
    if (!input) {
      setFolderCreateDraft(null);
      return;
    }
    const path = normalizeFolder(`${folderCreateDraft.parent}/${input}`);
    setFolderCreateDraft(null);
    await persistFolder(path);
  };

  const changeSection = (nextSection: FlowSection) => {
    setSection(nextSection);
    if (nextSection === "events") {
      setIsEditingYaml(false);
      setContextMenu(null);
      setFolderCreateDraft(null);
    }
  };

  const deleteFolderByPath = async (path: string) => {
    try {
      const nextFolders = await invoke<string[]>("flow_delete_folder", { path });
      setFolders(nextFolders.length > 0 ? nextFolders : [DEFAULT_FLOW_FOLDER]);
      setSelectedFolder(null);
      await loadFlows(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
        <IconNav
          items={flowNavItems}
          activeId={section}
          onSelect={(id) => changeSection(id as FlowSection)}
          size="sm"
          moreStateKey="flow.nav.more.open"
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Workflow className="size-4 text-muted-foreground" />
              <h3 className="gt-title-panel">Git 笔记库流系统</h3>
            </div>
            <p className="gt-caption mt-1 text-muted-foreground">
              以 Git 基座下的笔记库为核心 · {flows.length} 个流 · {enabledCount} 个启用
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (section === "events") {
                  void loadEvents();
                } else {
                  void loadFlows(selectedId);
                }
              }}
              title="刷新"
            >
              <RefreshCcw className="size-3.5" />
            </Button>
            {section === "flows" && <ModeToggle mode={mode} onChange={changeMode} />}
          </div>
        </div>

        {loadError && (
          <div className="shrink-0 border-b bg-red-50 px-4 py-2 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {section === "events" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <EventCatalogView events={events} isLoading={isEventsLoading} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <aside
              className="flex min-h-0 shrink-0 flex-col border-r"
              style={{ width: `${fileListWidth}px` }}
            >
              <FlowFileBrowser
                flows={flows}
                folders={folders}
                selectedId={selectedId}
                selectedFolder={selectedFolder}
                onSelect={selectTreeItem}
                onContextMenu={openContextMenu}
                canOperate={canOperate}
                listMode={listMode}
                onListModeChange={setListMode}
              />
            </aside>

            <ResizeHandle
              direction="horizontal"
              size={fileListWidth}
              onResize={setFileListWidth}
              minSize={240}
              snapTo={320}
            />

            <div className="min-h-0 flex-1 overflow-hidden">
              {isEditingYaml ? (
                <YamlEditor
                  yaml={editorYaml}
                  folder={editorFolder}
                  folders={folders}
                  status={editorStatus}
                  error={editorError}
                  isSaving={isSaving}
                  onChange={setEditorYaml}
                  onFolderChange={setEditorFolder}
                  onSave={saveWorkflow}
                  onCancel={cancelEdit}
                  onDelete={selectedRecord ? deleteSelected : undefined}
                />
              ) : isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载 Flow...</div>
              ) : selectedRecord ? (
                <ScrollArea className="h-full" orientation="both">
                  <SummaryView record={selectedRecord} canOperate={canOperate} onEdit={startEdit} onToggle={toggleEnabled} />
                </ScrollArea>
              ) : selectedFolder ? (
                <div className="flex h-full min-h-[420px] items-center justify-center p-6">
                  <div className="w-full max-w-md rounded-md border bg-background p-5 text-center">
                    <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-muted">
                      <FolderTree className="size-5 text-muted-foreground" />
                    </div>
                    <h3 className="gt-title-panel mt-3">{selectedFolder}</h3>
                    {canOperate && (
                      <>
                        <p className="gt-body mt-2 text-muted-foreground">选中文件夹后添加 Flow,会直接保存到这个目录。</p>
                        <Button className="mt-4" size="sm" onClick={startCreate}>
                          <Plus className="size-3.5" />
                          添加 Flow
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState canOperate={canOperate} onCreate={startCreate} />
              )}
            </div>
          </div>
        )}

        {section === "flows" && canOperate && contextMenu && (
          <FlowFloatingActions
            menu={contextMenu}
            onBeginCreateChildFolder={beginCreateChildFolder}
            onCreateFlow={(folder) => {
              closeContextMenu();
              startCreateInFolder(folder);
            }}
            onDeleteFolder={(folder) => {
              closeContextMenu();
              void deleteFolderByPath(folder);
            }}
            onEditFlow={(id) => {
              closeContextMenu();
              void startEditFlowById(id);
            }}
            onDeleteFlow={(id) => {
              closeContextMenu();
              void deleteFlowById(id);
            }}
          />
        )}
        {section === "flows" && canOperate && folderCreateDraft && (
          <FlowFolderCreateInput
            draft={folderCreateDraft}
            onChange={(value) => setFolderCreateDraft((draft) => draft ? { ...draft, value } : draft)}
            onCommit={() => {
              void commitFolderCreateDraft();
            }}
            onCancel={() => setFolderCreateDraft(null)}
          />
        )}
      </div>
    </div>
  );
}
