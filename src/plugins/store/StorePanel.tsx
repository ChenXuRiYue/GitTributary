import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  List,
  ListTree,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** L0 绝对机密 key 列表:展示时完全掩码,不露任何字符 */
const L0_KEYS = new Set([
  "git.access_token",
  "git.ssh_passphrase",
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

type ViewMode = "compact" | "tree" | "json";

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

const DEFAULT_VIEW_MODE = VIEW_MODES[0].id;
const STORE_VIEW_STATE_NS = "ui-state";
const STORE_VIEW_STATE_KEY = "store.view.active";
const STORE_VIEW_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

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
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [selectedNs, setSelectedNs] = useState<string | null>(null);
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedNsRef = useRef<string | null>(null);
  const viewModeRef = useRef<ViewMode>(DEFAULT_VIEW_MODE);

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
      const [ns, profs, active, rawState] = await Promise.all([
        invoke<NamespaceInfo[]>("store_namespaces"),
        invoke<string[]>("store_list_profiles"),
        invoke<string | null>("store_active_profile"),
        invoke<unknown>("store_get", {
          namespace: STORE_VIEW_STATE_NS,
          key: STORE_VIEW_STATE_KEY,
        }),
      ]);
      setNamespaces(ns);
      setProfiles(profs);
      setActiveProfile(active);

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

  const handleSwitchProfile = async (name: string) => {
    try {
      await invoke("store_switch_profile", { name });
      setActiveProfile(name);
      if (selectedNs) await loadEntries(selectedNs);
    } catch (e) { setError(String(e)); }
  };

  useEffect(() => { refresh(); }, [refresh]);

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

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左:命名空间列表 */}
      <div className="flex w-52 shrink-0 flex-col border-r border-border/50">
        {/* Profile 切换 */}
        {profiles.length > 0 && (
          <div className="border-b border-border/30 px-3 py-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>配置档:</span>
              <select
                value={activeProfile ?? ""}
                onChange={(e) => e.target.value && handleSwitchProfile(e.target.value)}
                className="flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-medium text-foreground outline-none"
              >
                {profiles.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
        )}

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
                  <span className="flex-1 truncate">{ns.name}</span>
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

      {/* 右:KV 条目展示 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedNs ? (
          <>
            {/* 工具栏 */}
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
              <span className="text-xs font-medium">{selectedNs}</span>
              <span className="text-[10px] text-muted-foreground">{filteredEntries.length} 条</span>
              <span className="flex-1" />
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
                className="h-6 w-40 text-xs"
              />
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => handleCompact(selectedNs)} title="压缩">
                <Archive className="size-3" />
              </Button>
            </div>

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
  );
}
