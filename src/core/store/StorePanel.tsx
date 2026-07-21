import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Cloud,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconNav } from "@/components/IconNav";
import { cn } from "@/lib/utils";
import { EntryViewer } from "./components/EntryViewer";
import { NamespaceSidebar } from "./components/NamespaceSidebar";
import { StoreHeader } from "./components/StoreHeader";
import { SyncConfigPanel } from "./components/SyncConfigPanel";
import {
  DEFAULT_VIEW_MODE,
  STORE_DOMAIN_DEFAULT_WIDTH,
  STORE_DOMAIN_MIN_WIDTH,
  STORE_DOMAIN_WIDTH_KEY,
  STORE_MORE_STATE_KEY,
  STORE_NAV_ITEMS,
  STORE_VIEW_STATE_KEY,
  STORE_VIEW_STATE_NS,
  STORE_VIEW_STATE_TTL_MS,
  VIEW_MODES,
} from "./constants";
import type {
  ConfigRepoCheckReport,
  DataCenterConfigCredentialStatus,
  KvEntry,
  NamespaceInfo,
  StorePanelUiState,
  StoreViewId,
  SyncConfigPayload,
  ViewMode,
} from "./types";
import {
  isConfigCenterUrl,
  isL0Key,
  parseStoredWidth,
  parseStorePanelUiState,
  repoNameFromUrl,
  stringifyValue,
} from "./utils";

export function StorePanel() {
  const [activeViewId, setActiveViewId] = useState<StoreViewId>("detail");
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [selectedNs, setSelectedNs] = useState<string | null>(null);
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);
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
  const initializedRef = useRef(false);

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

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void refresh();
  }, [refresh]);

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

  const syncSummary = syncConfig ? repoNameFromUrl(syncConfig.url) : "未配置";
  const activeStoreView = STORE_NAV_ITEMS.find((item) => item.id === activeViewId) ?? STORE_NAV_ITEMS[0];
  const domainTrailItems = [
    { id: "store", label: "数据" },
    { id: activeStoreView.id, label: activeStoreView.name },
  ];
  const secondaryDomainStats = `key:${filteredEntries.length} 命名空间:${namespaces.length}`;
  const primaryDomainStats = `环境:${environments.length || 1} 当前:${activeEnvironmentLabel}`;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <StoreHeader
        trailItems={domainTrailItems}
        namespaces={namespaces}
        selectedNamespace={selectedNs}
        stats={[secondaryDomainStats, primaryDomainStats]}
        onSelectNamespace={(namespace) => void loadEntries(namespace)}
        onRefresh={() => void refresh()}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
          <IconNav
            items={STORE_NAV_ITEMS}
            activeId={activeViewId}
            onSelect={selectStoreView}
            size="sm"
            moreStateKey={STORE_MORE_STATE_KEY}
          />
        </div>

      <NamespaceSidebar
        namespaces={namespaces}
        selectedNamespace={selectedNs}
        width={domainWidth}
        error={error}
        onSelect={(namespace) => void loadEntries(namespace)}
        onRefresh={() => void refresh()}
        onResize={applyDomainWidth}
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
              <SyncConfigPanel
                syncConfig={syncConfig}
                credential={configCredential}
                remoteUrl={configRemoteUrl}
                token={configToken}
                branch={syncBranch}
                checkStatus={checkStatus}
                checkingRepo={checkingRepo}
                syncingNow={syncingNow}
                environments={environments}
                activeEnvironmentValue={activeEnvironmentValue}
                activeEnvironmentLabel={activeEnvironmentLabel}
                newEnvironmentName={newEnvironmentName}
                onClose={() => setSyncPanelOpen(false)}
                onRemoteUrlChange={(value) => { setConfigRemoteUrl(value); setCheckStatus(null); }}
                onTokenChange={(value) => { setConfigToken(value); setCheckStatus(null); }}
                onBranchChange={setSyncBranch}
                onCheck={() => void handleCheckConfigRepo()}
                onSave={() => void handleSaveEquivalentGitConfig()}
                onSync={() => void handleSyncNow()}
                onSwitchEnvironment={(name) => void handleSwitchEnvironment(name)}
                onNewEnvironmentNameChange={setNewEnvironmentName}
                onCreateEnvironment={() => void handleCreateEnvironment()}
              />
            )}

            <EntryViewer entries={filteredEntries} searchQuery={searchQuery} viewMode={viewMode} />
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
