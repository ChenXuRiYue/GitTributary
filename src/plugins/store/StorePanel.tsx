import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  GitBranch,
  Layers,
  List,
  ListTree,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { DomainTrail, type DomainTrailItem } from "@/components/DomainTrail";
import { IconNav, type NavItem } from "@/components/IconNav";
import { ResizeHandle } from "@/components/ResizeHandle";
import { cn } from "@/lib/utils";

/** L0 绝对机密 key 列表:展示时完全掩码,不露任何字符 */
const L0_KEYS = new Set([
  "git.access_token",
  "git.ssh_passphrase",
  "data_center.config_repo.token",
]);

function isL0Key(key: string): boolean {
  // 精确匹配或项目级 token(project.*.token)
  if (L0_KEYS.has(key)) return true;
  if (key.startsWith("project.") && key.endsWith(".token")) return true;
  return false;
}

interface NamespaceInfo {
  name: string;
  count: number;
  visibility: "public" | "private";
}

interface KvEntry {
  key: string;
  value: unknown;
}

interface DataCenterConfigCredentialStatus {
  has_token: boolean;
  token_masked: string | null;
  credential_ref: string;
}

interface SyncConfigPayload {
  url: string;
  branch: string;
  active_environment_id?: string | null;
  local_database_path?: string | null;
  auto_sync: boolean;
  interval_seconds: number;
}

interface ConfigRepoCheckReport {
  ok: boolean;
  status: string;
  message: string;
  default_branch: string | null;
  refs_count: number;
}

function isConfigCenterUrl(url: string): boolean {
  return url.trim().startsWith("https://");
}

type ViewMode = "compact" | "tree" | "json";
type StoreViewId = "detail";

interface StorePanelUiState {
  version: 1;
  namespace: string;
  viewMode: ViewMode;
  updatedAt: number;
}

interface KeyTreeNode {
  name: string;
  path: string;
  children: Map<string, KeyTreeNode>;
  entry?: KvEntry;
}

interface JsonGroup {
  name: string;
  value: unknown;
  count: number;
}

const VIEW_MODES: Array<{
  id: ViewMode;
  label: string;
  title: string;
  icon: typeof List;
}> = [
  { id: "compact", label: "当前", title: "当前紧凑展示", icon: List },
  { id: "tree", label: "树形", title: "按点分 key 展开为 YAML 风格树", icon: ListTree },
  { id: "json", label: "JSON", title: "按 JSON 结构展开", icon: Braces },
];

const storeNavItems: NavItem[] = [
  { id: "detail", name: "配置", icon: Settings2 },
];

const DEFAULT_VIEW_MODE = VIEW_MODES[0].id;
const STORE_VIEW_STATE_NS = "ui-state";
const STORE_VIEW_STATE_KEY = "store.view.active";
const STORE_MORE_STATE_KEY = "store.nav.more.open";
const STORE_DOMAIN_WIDTH_KEY = "store.domain.width";
const STORE_VIEW_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const STORE_DOMAIN_MIN_WIDTH = 160;
const STORE_DOMAIN_DEFAULT_WIDTH = 208;

function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.some((mode) => mode.id === value);
}

function parseStorePanelUiState(value: unknown): StorePanelUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<StorePanelUiState>;
  if (state.version !== 1) return null;
  if (typeof state.namespace !== "string" || state.namespace.length === 0) return null;
  if (!isViewMode(state.viewMode)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    namespace: state.namespace,
    viewMode: state.viewMode,
    updatedAt: state.updatedAt,
  };
}

function parseStoredWidth(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(STORE_DOMAIN_MIN_WIDTH, value);
}

function stringifyValue(value: unknown, space?: number): string {
  try {
    const json = JSON.stringify(value, null, space);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array:${value.length}`;
  if (typeof value === "object") return `object:${Object.keys(value as Record<string, unknown>).length}`;
  return typeof value;
}

function domainLabel(namespace: string): string {
  if (namespace.startsWith("private.")) return namespace.slice("private.".length);
  return namespace;
}

function repoNameFromUrl(url: string): string {
  const trimmed = url.trim();
  const withoutSuffix = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
  const sshMatch = withoutSuffix.match(/[:/]([^/:]+\/[^/]+)$/);
  if (sshMatch) return sshMatch[1];
  try {
    const parsed = new URL(withoutSuffix);
    return parsed.pathname.replace(/^\/+/, "") || trimmed;
  } catch {
    return withoutSuffix.split("/").slice(-2).join("/") || trimmed;
  }
}

function isExpandable(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0;
}

function sortedObjectEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

function primitiveClassName(value: unknown): string {
  if (value === null) return "text-muted-foreground";
  if (typeof value === "string") return "text-emerald-700 dark:text-emerald-300";
  if (typeof value === "number") return "text-sky-700 dark:text-sky-300";
  if (typeof value === "boolean") return "text-violet-700 dark:text-violet-300";
  return "text-foreground";
}

function formatPrimitive(value: unknown, mode: "json" | "yaml" = "json"): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (mode === "yaml" && /^[\w./:@-]+$/.test(value)) return value;
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return stringifyValue(value);
}

function createTreeNode(name: string, path: string): KeyTreeNode {
  return { name, path, children: new Map() };
}

function assignJsonPath(target: Record<string, unknown>, path: string[], value: unknown) {
  if (path.length === 0) {
    target.$value = value;
    return;
  }

  let cursor = target;
  path.forEach((part, index) => {
    const isLeaf = index === path.length - 1;
    if (isLeaf) {
      const existing = cursor[part];
      if (existing !== undefined && isExpandable(existing)) {
        (existing as Record<string, unknown>).$value = value;
      } else {
        cursor[part] = value;
      }
      return;
    }

    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  });
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, childValue]) => [key, sortJsonValue(childValue)]),
  );
}

function buildJsonGroups(entries: KvEntry[]): JsonGroup[] {
  const groups = new Map<string, { value: Record<string, unknown>; count: number }>();

  for (const entry of entries) {
    const parts = entry.key.split(".").filter(Boolean);
    const name = parts[0] || entry.key;
    const path = parts.length > 1 ? parts.slice(1) : [];
    const safeValue = isL0Key(entry.key) ? "••••••••" : entry.value;
    let group = groups.get(name);

    if (!group) {
      group = { value: {}, count: 0 };
      groups.set(name, group);
    }

    assignJsonPath(group.value, path, safeValue);
    group.count += 1;
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, group]) => {
      const value = Object.keys(group.value).length === 1 && "$value" in group.value
        ? group.value.$value
        : group.value;

      return {
        name,
        value: sortJsonValue(value),
        count: group.count,
      };
    });
}

function buildKeyTree(entries: KvEntry[]): KeyTreeNode {
  const root = createTreeNode("", "");

  for (const entry of entries) {
    const parts = entry.key.split(".").filter(Boolean);
    const safeParts = parts.length > 0 ? parts : [entry.key];
    let cursor = root;

    safeParts.forEach((part, index) => {
      const path = safeParts.slice(0, index + 1).join(".");
      let next = cursor.children.get(part);
      if (!next) {
        next = createTreeNode(part, path);
        cursor.children.set(part, next);
      }
      cursor = next;
    });

    cursor.entry = entry;
  }

  return root;
}

function sortedChildren(node: KeyTreeNode): KeyTreeNode[] {
  return Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function TreeToggle({
  expanded,
  visible,
}: {
  expanded: boolean;
  visible: boolean;
}) {
  if (!visible) return <span className="size-4 shrink-0" />;
  const Icon = expanded ? ChevronDown : ChevronRight;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

function ValueBadge({ value }: { value: unknown }) {
  return (
    <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] text-muted-foreground">
      {valueKind(value)}
    </Badge>
  );
}

function ConfigRepoCheckMessage({ report }: { report: ConfigRepoCheckReport }) {
  return (
    <div className={cn(
      "rounded-md border px-2 py-1.5 text-[11px]",
      report.ok
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-destructive/30 bg-destructive/10 text-destructive",
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{report.ok ? "连接成功" : "连接失败"}</span>
        {report.default_branch && <span>默认分支 {report.default_branch}</span>}
        {report.ok && <span>{report.refs_count} refs</span>}
      </div>
      <div className="mt-0.5 text-muted-foreground">{report.message}</div>
    </div>
  );
}

function YamlValue({
  value,
  depth,
  masked = false,
}: {
  value: unknown;
  depth: number;
  masked?: boolean;
}) {
  if (masked) {
    return (
      <div className="font-mono text-xs text-muted-foreground" style={{ paddingLeft: depth * 16 }}>
        value: ••••••••
      </div>
    );
  }

  if (!isExpandable(value)) {
    return (
      <span className={cn("font-mono text-xs", primitiveClassName(value))}>
        {formatPrimitive(value, "yaml")}
      </span>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div className="flex flex-col gap-0.5 pt-1">
        {value.map((item, index) => (
          <div key={index} className="font-mono text-xs" style={{ paddingLeft: depth * 16 }}>
            {!isExpandable(item) ? (
              <span>
                <span className="text-muted-foreground">- </span>
                <span className={primitiveClassName(item)}>{formatPrimitive(item, "yaml")}</span>
              </span>
            ) : (
              <>
                <span className="text-muted-foreground">-</span>
                <YamlValue value={item} depth={depth + 1} />
              </>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {sortedObjectEntries(value as Record<string, unknown>).map(([key, childValue]) => (
        <div key={key} className="font-mono text-xs" style={{ paddingLeft: depth * 16 }}>
          <span className="text-muted-foreground">{key}:</span>{" "}
          {!isExpandable(childValue) ? (
            <span className={primitiveClassName(childValue)}>{formatPrimitive(childValue, "yaml")}</span>
          ) : (
            <YamlValue value={childValue} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

function KeyTreeItem({
  node,
  depth = 0,
}: {
  node: KeyTreeNode;
  depth?: number;
}) {
  const hasChildren = node.children.size > 0;
  const hasEntry = Boolean(node.entry);
  const value = node.entry?.value;
  const masked = node.entry ? isL0Key(node.entry.key) : false;
  const expandableValue = hasEntry && !masked && isExpandable(value);
  const expandable = hasChildren || expandableValue;
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => expandable && setExpanded((v) => !v)}
        className={cn(
          "flex w-full min-w-0 items-start gap-1 rounded px-2 py-1 text-left text-xs hover:bg-accent/50",
          !expandable && "cursor-default hover:bg-transparent",
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        <TreeToggle expanded={expanded} visible={expandable} />
        <span className="min-w-0 flex-1 break-words font-mono">
          <span className="text-foreground">{node.name}</span>
          {hasEntry && <span className="text-muted-foreground">:</span>}
          {hasEntry && !expandableValue && !masked && (
            <>
              {" "}
              <span className={primitiveClassName(value)}>{formatPrimitive(value, "yaml")}</span>
            </>
          )}
          {masked && <span className="text-muted-foreground"> ••••••••</span>}
        </span>
        {hasEntry && value !== undefined && <ValueBadge value={masked ? "masked" : value} />}
      </button>
      {expanded && (
        <div className="min-w-0">
          {expandableValue && <YamlValue value={value} depth={depth + 2} />}
          {sortedChildren(node).map((child) => (
            <KeyTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StorePanel() {
  const [activeViewId, setActiveViewId] = useState<StoreViewId>("detail");
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [selectedNs, setSelectedNs] = useState<string | null>(null);
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);
  const [namespaceMenuOpen, setNamespaceMenuOpen] = useState(false);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [activeEnvironment, setActiveEnvironment] = useState<string | null>(null);
  const [configCredential, setConfigCredential] = useState<DataCenterConfigCredentialStatus | null>(null);
  const [syncConfig, setSyncConfig] = useState<SyncConfigPayload | null>(null);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [syncBranch, setSyncBranch] = useState("main");
  const [domainWidth, setDomainWidth] = useState(STORE_DOMAIN_DEFAULT_WIDTH);
  const [configRemoteUrl, setConfigRemoteUrl] = useState("");
  const [configToken, setConfigToken] = useState("");
  const [newEnvironmentName, setNewEnvironmentName] = useState("");
  const [checkStatus, setCheckStatus] = useState<ConfigRepoCheckReport | null>(null);
  const [checkingRepo, setCheckingRepo] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedNsRef = useRef<string | null>(null);
  const viewModeRef = useRef<ViewMode>(DEFAULT_VIEW_MODE);
  const namespaceMenuRef = useRef<HTMLDivElement | null>(null);

  const selectStoreView = useCallback((id: string) => {
    if (id === "detail") setActiveViewId(id);
  }, []);

  const persistDomainWidth = useCallback((width: number) => {
    void invoke("store_set", {
      namespace: STORE_VIEW_STATE_NS,
      key: STORE_DOMAIN_WIDTH_KEY,
      value: width,
    }).catch(() => {
      // Layout preference writes should not block data browsing.
    });
  }, []);

  const applyDomainWidth = useCallback((width: number) => {
    const next = Math.max(STORE_DOMAIN_MIN_WIDTH, width);
    setDomainWidth(next);
    persistDomainWidth(next);
  }, [persistDomainWidth]);

  const persistOpenState = useCallback((namespace: string, mode: ViewMode) => {
    void invoke("store_set", {
      namespace: STORE_VIEW_STATE_NS,
      key: STORE_VIEW_STATE_KEY,
      value: {
        version: 1,
        namespace,
        viewMode: mode,
        updatedAt: Date.now(),
      } satisfies StorePanelUiState,
    }).catch(() => {
      // UI cache writes should never block data browsing.
    });
  }, []);

  const applyViewMode = useCallback((mode: ViewMode, shouldPersist = true) => {
    viewModeRef.current = mode;
    setViewMode(mode);
    if (shouldPersist && selectedNsRef.current) {
      persistOpenState(selectedNsRef.current, mode);
    }
  }, [persistOpenState]);

  const loadEntries = useCallback(async (
    ns: string,
    options: { mode?: ViewMode; persist?: boolean } = {},
  ) => {
    try {
      const items = await invoke<KvEntry[]>("store_entries", { namespace: ns });
      const mode = options.mode ?? viewModeRef.current;
      setEntries(items);
      setSelectedNs(ns);
      selectedNsRef.current = ns;
      if (options.persist ?? true) persistOpenState(ns, mode);
      setError(null);
    } catch (e) { setError(String(e)); }
  }, [persistOpenState]);

  const refresh = useCallback(async () => {
    try {
      const [ns, envs, activeEnv, rawState, rawDomainWidth, configCred, currentSyncConfig] = await Promise.all([
        invoke<NamespaceInfo[]>("store_namespaces"),
        invoke<string[]>("store_list_environments"),
        invoke<string | null>("store_active_environment"),
        invoke<unknown>("store_get", {
          namespace: STORE_VIEW_STATE_NS,
          key: STORE_VIEW_STATE_KEY,
        }),
        invoke<unknown>("store_get", {
          namespace: STORE_VIEW_STATE_NS,
          key: STORE_DOMAIN_WIDTH_KEY,
        }),
        invoke<DataCenterConfigCredentialStatus>("get_data_center_config_credential_status"),
        invoke<SyncConfigPayload | null>("sync_get_config"),
      ]);
      setNamespaces(ns);
      setEnvironments(envs);
      setActiveEnvironment(activeEnv);
      setDomainWidth(parseStoredWidth(rawDomainWidth) ?? STORE_DOMAIN_DEFAULT_WIDTH);
      setConfigCredential(configCred);
      setSyncConfig(currentSyncConfig);
      setSyncBranch(currentSyncConfig?.branch ?? "main");
      setConfigRemoteUrl(currentSyncConfig?.url ?? "");

      const cached = parseStorePanelUiState(rawState);
      const fresh = cached && Date.now() - cached.updatedAt <= STORE_VIEW_STATE_TTL_MS;
      const cachedNsExists = cached && ns.some((item) => item.name === cached.namespace);
      const fallbackNs = selectedNsRef.current && ns.some((item) => item.name === selectedNsRef.current)
        ? selectedNsRef.current
        : ns[0]?.name ?? null;
      const nextNs = fresh && cachedNsExists ? cached.namespace : fallbackNs;
      const nextMode = fresh && cached ? cached.viewMode : DEFAULT_VIEW_MODE;

      applyViewMode(nextMode, false);

      if (rawState != null && (!cached || !fresh || !cachedNsExists)) {
        void invoke("store_delete", {
          namespace: STORE_VIEW_STATE_NS,
          key: STORE_VIEW_STATE_KEY,
        }).catch(() => {
          // Expired UI cache cleanup is best-effort.
        });
      }

      if (nextNs) {
        await loadEntries(nextNs, { mode: nextMode, persist: true });
      } else {
        setEntries([]);
        setSelectedNs(null);
        selectedNsRef.current = null;
      }

      setError(null);
    } catch (e) { setError(String(e)); }
  }, [applyViewMode, loadEntries]);

  const handleCompact = async (ns: string) => {
    try {
      await invoke("store_compact", { namespace: ns });
      await loadEntries(ns);
    } catch (e) { setError(String(e)); }
  };

  const handleSwitchEnvironment = async (name: string) => {
    try {
      await invoke("store_switch_environment", { name });
      setActiveEnvironment(name);
      if (selectedNs) await loadEntries(selectedNs);
    } catch (e) { setError(String(e)); }
  };

  const handleCreateEnvironment = async () => {
    const name = newEnvironmentName.trim();
    if (!name) return;
    try {
      await invoke("store_create_environment", { name });
      await invoke("store_switch_environment", { name });
      setNewEnvironmentName("");
      setActiveEnvironment(name);
      await refresh();
      setSyncStatus(`已切换到环境 ${name}`);
      setTimeout(() => setSyncStatus(null), 2200);
    } catch (e) { setError(String(e)); }
  };

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!namespaceMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!namespaceMenuRef.current?.contains(event.target as Node)) {
        setNamespaceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNamespaceMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [namespaceMenuOpen]);

  const activeEnvironmentValue = activeEnvironment ?? environments[0] ?? "";
  const activeEnvironmentLabel = activeEnvironmentValue || "默认";

  const saveSyncConfig = useCallback(async (url: string, branch = syncBranch) => {
    const normalizedUrl = url.trim();
    const normalizedBranch = branch.trim() || "main";
    if (!normalizedUrl) return;
    const nextConfig: SyncConfigPayload = {
      url: normalizedUrl,
      branch: normalizedBranch,
      active_environment_id: activeEnvironmentValue || null,
      local_database_path: syncConfig?.local_database_path ?? null,
      auto_sync: syncConfig?.auto_sync ?? true,
      interval_seconds: syncConfig?.interval_seconds ?? 300,
    };
    await invoke("sync_set_config", { config: nextConfig });
    setSyncConfig(nextConfig);
    setSyncBranch(normalizedBranch);
    setSyncStatus("远程配置中心已绑定并拉取到本地工作副本");
    setTimeout(() => setSyncStatus(null), 2200);
  }, [activeEnvironmentValue, syncBranch, syncConfig]);

  const handleSaveEquivalentGitConfig = async () => {
    const url = configRemoteUrl.trim();
    const token = configToken.trim();
    if (!isConfigCenterUrl(url) || (!token && !configCredential?.has_token)) return;
    try {
      if (token) {
        await invoke("set_data_center_config_token", { token });
      }
      setConfigToken("");
      await saveSyncConfig(url);
      await refresh();
      setSyncPanelOpen(false);
    } catch (e) { setError(String(e)); }
  };

  const handleSyncNow = async () => {
    if (!syncConfig || !isConfigCenterUrl(syncConfig.url) || !configCredential?.has_token) return;
    try {
      setSyncingNow(true);
      setSyncStatus("正在同步…");
      const msg = await invoke<string>("sync_now");
      await refresh();
      setSyncStatus(msg || "同步完成");
    } catch (e) {
      setSyncStatus(`同步失败: ${String(e)}`);
    } finally {
      setSyncingNow(false);
      setTimeout(() => setSyncStatus(null), 3500);
    }
  };

  const handleCheckConfigRepo = async (url = configRemoteUrl, token = configToken) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) return;
    try {
      setCheckingRepo(true);
      const report = await invoke<ConfigRepoCheckReport>("check_data_center_config_repo", {
        url: normalizedUrl,
        token: token.trim() || null,
      });
      setCheckStatus(report);
      if (report.ok && report.default_branch && !syncBranch.trim()) {
        setSyncBranch(report.default_branch);
      }
    } catch (e) {
      setCheckStatus({
        ok: false,
        status: "error",
        message: String(e),
        default_branch: null,
        refs_count: 0,
      });
    } finally {
      setCheckingRepo(false);
    }
  };

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => {
      const keyMatches = entry.key.toLowerCase().includes(query);
      if (keyMatches || isL0Key(entry.key)) return keyMatches;
      return stringifyValue(entry.value).toLowerCase().includes(query);
    });
  }, [entries, searchQuery]);

  const keyTree = useMemo(() => buildKeyTree(filteredEntries), [filteredEntries]);
  const jsonGroups = useMemo(() => buildJsonGroups(filteredEntries), [filteredEntries]);

  const syncSummary = syncConfig ? repoNameFromUrl(syncConfig.url) : "未配置";
  const selectedNamespaceInfo = selectedNs ? namespaces.find((ns) => ns.name === selectedNs) ?? null : null;
  const selectedNamespaceLabel = selectedNs ? domainLabel(selectedNs) : "选择命名空间";
  const selectedNamespaceTitle = selectedNs ?? selectedNamespaceLabel;
  const activeStoreView = storeNavItems.find((item) => item.id === activeViewId) ?? storeNavItems[0];
  const domainTrailItems: DomainTrailItem[] = [
    { id: "store", label: "数据" },
    { id: activeStoreView.id, label: activeStoreView.name },
  ];
  const secondaryDomainStats = `key:${filteredEntries.length} 命名空间:${namespaces.length}`;
  const primaryDomainStats = `环境:${environments.length || 1} 当前:${activeEnvironmentLabel}`;
  const selectNamespaceFromMenu = (namespace: string) => {
    setNamespaceMenuOpen(false);
    void loadEntries(namespace);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DomainTrail items={domainTrailItems} />
          <span className="shrink-0 text-muted-foreground/60 gt-body">/</span>
          <div ref={namespaceMenuRef} className="relative min-w-0 shrink">
            <button
              type="button"
              className="flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label={`切换命名空间: ${selectedNamespaceLabel}`}
              aria-haspopup="menu"
              aria-expanded={namespaceMenuOpen}
              onClick={() => setNamespaceMenuOpen((open) => !open)}
              title={selectedNamespaceTitle}
            >
              <span className="min-w-0 truncate gt-body">{selectedNamespaceLabel}</span>
              <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", namespaceMenuOpen && "rotate-180")} />
            </button>

            {namespaceMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg sm:w-80"
              >
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="gt-body-strong truncate">{selectedNamespaceLabel}</div>
                    <div className="gt-caption truncate text-muted-foreground">
                      {selectedNamespaceInfo ? `${selectedNamespaceInfo.count} keys / ${selectedNamespaceInfo.visibility}` : "未选择命名空间"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => {
                      setNamespaceMenuOpen(false);
                      void refresh();
                    }}
                  >
                    <RefreshCw className="size-3.5" />
                    刷新
                  </Button>
                </div>

                <div className="max-h-72 overflow-y-auto p-1">
                  {namespaces.length === 0 ? (
                    <div className="px-3 py-6 text-center">
                      <Database className="mx-auto size-6 text-muted-foreground" />
                      <div className="gt-body-strong mt-2">暂无命名空间</div>
                      <p className="gt-caption mt-1 text-muted-foreground">写入配置后会出现在这里。</p>
                    </div>
                  ) : (
                    namespaces.map((ns) => {
                      const isCurrent = selectedNs === ns.name;
                      return (
                        <button
                          key={ns.name}
                          type="button"
                          role="menuitem"
                          className={cn(
                            "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                            isCurrent ? "bg-primary/8 text-foreground" : "hover:bg-accent hover:text-accent-foreground",
                          )}
                          onClick={() => selectNamespaceFromMenu(ns.name)}
                        >
                          <span className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md border",
                            isCurrent ? "border-primary/30 bg-primary/10 text-primary" : "bg-background text-muted-foreground",
                          )}>
                            {isCurrent ? <Check className="size-3.5" /> : <Database className="size-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="gt-body-strong block truncate">{domainLabel(ns.name)}</span>
                            <span className="gt-caption block truncate text-muted-foreground" title={ns.name}>
                              {ns.count} keys / {ns.visibility}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 text-right md:flex">
          {[secondaryDomainStats, primaryDomainStats].map((stat, index) => (
            <div key={`${index}.${stat}`} className="flex items-center gap-2">
              {index > 0 && <span className="text-muted-foreground/40 gt-caption">/</span>}
              <span className="text-foreground gt-caption font-medium">{stat}</span>
            </div>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
          <IconNav
            items={storeNavItems}
            activeId={activeViewId}
            onSelect={selectStoreView}
            size="sm"
            moreStateKey={STORE_MORE_STATE_KEY}
          />
        </div>

      {/* 左:命名空间列表 */}
      <div
        className="flex shrink-0 flex-col border-r border-border/50"
        style={{ width: `${domainWidth}px` }}
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
          <Database className="size-3.5 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground">命名空间</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={refresh}>
            <RefreshCw className="size-3" />
          </Button>
        </div>

        {error && <p className="px-3 py-1 text-[11px] text-destructive">{error}</p>}

        {/* 命名空间列表 */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col py-1">
            {namespaces.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">无数据</p>
            ) : (
              namespaces.map((ns) => (
                <div
                  key={ns.name}
                  onClick={() => loadEntries(ns.name)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                    selectedNs === ns.name ? "bg-accent" : "hover:bg-accent/40",
                  )}
                >
                  <Database className="size-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate" title={ns.name}>{domainLabel(ns.name)}</span>
                  {ns.visibility === "private" && (
                    <Badge variant="outline" className="h-4 px-1 text-[8px] text-destructive/70">本地</Badge>
                  )}
                  <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">{ns.count}</Badge>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
      <ResizeHandle
        direction="horizontal"
        size={domainWidth}
        onResize={applyDomainWidth}
        minSize={STORE_DOMAIN_MIN_WIDTH}
        snapTo={STORE_DOMAIN_DEFAULT_WIDTH}
      />

      {/* 右:KV 条目展示 */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedNs ? (
          <>
            {/* 工具栏 */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2">
              <div className="flex shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/30 p-0.5">
                {VIEW_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const active = viewMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => applyViewMode(mode.id)}
                      title={mode.title}
                      className={cn(
                        "flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3" />
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 key…"
                className="h-7 max-w-72 flex-1 text-xs"
              />
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
                  <Layers className="size-3 shrink-0" />
                  {environments.length > 0 ? (
                    <select
                      value={activeEnvironmentValue}
                      onChange={(e) => e.target.value && handleSwitchEnvironment(e.target.value)}
                      className="h-7 max-w-36 rounded-md border border-border/60 bg-background px-2 text-[11px] text-foreground outline-none"
                      title="切换环境配置"
                    >
                      {environments.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-md border bg-background px-2 py-1 text-foreground">{activeEnvironmentLabel}</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 px-0"
                  onClick={() => setSyncPanelOpen((open) => !open)}
                  title={`配置远程 Git 数据配置中心仓库: ${syncSummary}`}
                >
                  {syncConfig ? (
                    <ShieldCheck className="size-3.5 text-emerald-600" />
                  ) : (
                    <Cloud className="size-3.5 text-muted-foreground" />
                  )}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={() => handleCompact(selectedNs)} title="压缩">
                  <Archive className="size-3.5" />
                </Button>
              </div>
            </div>
            {syncStatus && <div className="shrink-0 border-b border-primary/15 bg-primary/5 px-4 py-1.5 text-[10px] text-primary">{syncStatus}</div>}

            {syncPanelOpen && (
              <div className="absolute right-4 top-12 z-20 w-[480px] max-w-[calc(100%-32px)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                <div className="mb-3 flex items-center gap-2">
                  <Cloud className="size-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold">远程 Git 数据配置中心</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      仓库承载多套环境配置,同步必须使用专用 Token
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setSyncPanelOpen(false)}>
                    <X className="size-3.5" />
                  </Button>
                </div>

                <div className="mb-3 rounded-md border border-border/70 bg-muted/20 px-2 py-2">
                  <div className="mb-2 flex items-center gap-2">
                    <GitBranch className="size-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-medium">数据中心配置仓库</span>
                    {syncConfig?.url && (
                      <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[9px]">
                        已绑定
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      <div className="text-[11px] text-muted-foreground">
                        配置中心仓库必须使用 HTTPS URL 和明确的 Access Token。系统凭据、SSH Agent 或 SSH Key 不用于数据中心同步。
                      </div>
                    </div>
                    <div className="grid grid-cols-[88px_1fr] items-center gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground">仓库 URL</span>
                      <Input
                        value={configRemoteUrl}
                        onChange={(e) => {
                          setConfigRemoteUrl(e.target.value);
                          setCheckStatus(null);
                        }}
                        placeholder="https://github.com/user/gt-config.git"
                        className="h-7 text-xs"
                      />
                      <span className="text-[11px] font-medium text-muted-foreground">Access Token</span>
                      <Input
                        type="password"
                        value={configToken}
                        onChange={(e) => {
                          setConfigToken(e.target.value);
                          setCheckStatus(null);
                        }}
                        placeholder={configCredential?.has_token ? "留空则沿用已保存 Token" : "必填: 配置中心专用 Token"}
                        className="h-7 text-xs"
                      />
                      <span className="text-[11px] text-muted-foreground">分支</span>
                      <Input value={syncBranch} onChange={(e) => setSyncBranch(e.target.value)} className="h-7 text-xs" />
                      <span className="text-[11px] text-muted-foreground">本地工作副本</span>
                      <div className="truncate rounded-md border bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                        {syncConfig?.local_database_path ?? "保存后由数据中心分配"}
                      </div>
                    </div>
                    {checkStatus && <ConfigRepoCheckMessage report={checkStatus} />}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleCheckConfigRepo()}
                        disabled={!isConfigCenterUrl(configRemoteUrl) || (!configToken.trim() && !configCredential?.has_token) || checkingRepo}
                      >
                        <Unplug className="size-3.5" /> {checkingRepo ? "验证中" : "验证"}
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleSaveEquivalentGitConfig}
                        disabled={!isConfigCenterUrl(configRemoteUrl) || (!configToken.trim() && !configCredential?.has_token)}
                      >
                        <Save className="size-3.5" /> 保存并绑定
                      </Button>
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleSyncNow}
                        disabled={!syncConfig || !isConfigCenterUrl(syncConfig.url) || !configCredential?.has_token || syncingNow}
                        title="pull → import → export → commit → push"
                      >
                        <RefreshCw className={cn("size-3.5", syncingNow && "animate-spin")} /> {syncingNow ? "同步中" : "立即同步"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border/70 bg-muted/20 px-2 py-2">
                  <div className="mb-2 flex items-center gap-2">
                    <Layers className="size-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-medium">环境配置</span>
                    <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[9px]">
                      {activeEnvironmentLabel}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-[76px_1fr_auto] items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">当前环境</span>
                    {environments.length > 0 ? (
                      <select
                        value={activeEnvironmentValue}
                        onChange={(e) => e.target.value && handleSwitchEnvironment(e.target.value)}
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none"
                      >
                        {environments.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex h-7 items-center rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
                        默认
                      </div>
                    )}
                    <span />
                    <span className="text-[11px] text-muted-foreground">新增环境</span>
                    <Input
                      value={newEnvironmentName}
                      onChange={(e) => setNewEnvironmentName(e.target.value)}
                      placeholder="test / staging / prod"
                      className="h-7 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleCreateEnvironment}
                      disabled={!newEnvironmentName.trim()}
                      title="基于当前 public 数据创建环境(Phase 1 仅同步 data 命名空间)"
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* KV 表格 */}
            <ScrollArea className="flex-1">
              <div className="flex flex-col">
                {filteredEntries.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {searchQuery ? "无匹配结果" : "命名空间为空"}
                  </p>
                ) : viewMode === "compact" ? (
                  filteredEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="flex items-start gap-3 border-b border-border/20 px-3 py-2 text-xs"
                    >
                      <span className="w-40 shrink-0 truncate font-mono text-muted-foreground" title={entry.key}>
                        {entry.key}
                      </span>
                      <span className="min-w-0 flex-1 break-words font-mono">
                        {isL0Key(entry.key) ? "••••••••" : stringifyValue(entry.value)}
                      </span>
                    </div>
                  ))
                ) : viewMode === "tree" ? (
                  <div className="flex flex-col px-1 py-2">
                    {sortedChildren(keyTree).map((node) => (
                      <KeyTreeItem key={node.path} node={node} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {jsonGroups.map((group) => (
                      <div key={group.name} className="border-b border-border/20 px-3 py-2">
                        <div className="mb-2 flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={group.name}>
                            {group.name}
                          </span>
                          <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] text-muted-foreground">
                            {group.count} keys
                          </Badge>
                          <ValueBadge value={group.value} />
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/35 px-2 py-1.5 font-mono text-xs leading-5">
                          {stringifyValue(group.value, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            选择一个命名空间查看配置
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
