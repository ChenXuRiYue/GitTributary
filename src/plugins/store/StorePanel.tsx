import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw, Trash2, Archive } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NamespaceInfo {
  name: string;
  count: number;
}

interface KvEntry {
  key: string;
  value: unknown;
}

export function StorePanel() {
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [selectedNs, setSelectedNs] = useState<string | null>(null);
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const ns = await invoke<NamespaceInfo[]>("store_namespaces");
      setNamespaces(ns);
      const profs = await invoke<string[]>("store_list_profiles");
      setProfiles(profs);
      const active = await invoke<string | null>("store_active_profile");
      setActiveProfile(active);
      setError(null);
    } catch (e) { setError(String(e)); }
  }, []);

  const loadEntries = useCallback(async (ns: string) => {
    try {
      const items = await invoke<KvEntry[]>("store_entries", { namespace: ns });
      setEntries(items);
      setSelectedNs(ns);
    } catch (e) { setError(String(e)); }
  }, []);

  const handleCompact = async (ns: string) => {
    try {
      await invoke("store_compact", { namespace: ns });
      await loadEntries(ns);
    } catch (e) { setError(String(e)); }
  };

  const handleDeleteKey = async (ns: string, key: string) => {
    try {
      await invoke("store_delete", { namespace: ns, key });
      await loadEntries(ns);
      await refresh();
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

  const filteredEntries = searchQuery
    ? entries.filter((e) => e.key.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries;

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
                ) : (
                  filteredEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="group flex items-start gap-3 border-b border-border/20 px-3 py-2 text-xs"
                    >
                      <span className="w-40 shrink-0 truncate font-mono text-muted-foreground" title={entry.key}>
                        {entry.key}
                      </span>
                      <span className="min-w-0 flex-1 break-words font-mono">
                        {JSON.stringify(entry.value)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteKey(selectedNs, entry.key)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        title="删除"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))
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
