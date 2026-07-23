import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  Check,
  ChevronLeft,
  Code2,
  Download,
  LoaderCircle,
  PackageCheck,
  PanelsTopLeft,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Workflow,
} from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { DomainTrail, type DomainTrailItem } from "@/shared/components/DomainTrail";
import { resolveExtensionIcon } from "@/platform/extensions/icons";
import { cn } from "@/shared/lib/utils";

import {
  installPlugin,
  listMarketPlugins,
  marketErrorMessage,
  notifyExtensionsChanged,
  uninstallPlugin,
} from "./api";
import type { MarketFilter, MarketPlugin } from "./types";
import { isReinstallAvailable, isUpdateAvailable, permissionLabel } from "./utils";

export function PluginManagerPanel() {
  const [plugins, setPlugins] = useState<MarketPlugin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"install" | "uninstall" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listMarketPlugins();
      setPlugins(next);
      setSelectedId((current) => (
        current && next.some((plugin) => plugin.id === current)
          ? current
          : next[0]?.id ?? null
      ));
    } catch (nextError) {
      setError(marketErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const filteredPlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return plugins.filter((plugin) => {
      if (filter === "installed" && plugin.installedVersion === null) return false;
      if (!normalizedQuery) return true;
      return [plugin.name, plugin.description, plugin.publisher, plugin.id]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [filter, plugins, query]);

  const selected = filteredPlugins.find((plugin) => plugin.id === selectedId)
    ?? filteredPlugins[0]
    ?? null;
  const SelectedIcon = resolveExtensionIcon(selected?.icon, selected?.id);
  const installedCount = plugins.filter((plugin) => plugin.installedVersion !== null).length;
  const trailItems: DomainTrailItem[] = [{ id: "plugins", label: "插件" }];

  const handleInstall = useCallback(async (plugin: MarketPlugin) => {
    const updating = isUpdateAvailable(plugin);
    const reinstalling = isReinstallAvailable(plugin);
    if (plugin.installedVersion !== null && !updating && !reinstalling) {
      setError("内置插件版本低于已安装版本，不能通过重新安装执行降级。");
      return;
    }
    const permissions = plugin.permissions.length > 0
      ? `NoteAura API 权限：\n${plugin.permissions.map((permission) => `- ${permissionLabel(permission)}`).join("\n")}\n\n`
      : "该插件未申请 NoteAura API 权限。\n\n";
    const storeNamespaces = plugin.storeNamespaces.length > 0
      ? `Store 命名空间：\n${plugin.storeNamespaces.map((namespace) => `- ${namespace}`).join("\n")}\n\n`
      : "";
    const warning = plugin.nativeCode
      ? "该插件包含随应用构建的本机 Rust 后端。\n\n"
      : "";
    const action = updating
      ? `确定将“${plugin.name}”从 ${plugin.installedVersion} 更新到 ${plugin.version} 吗？`
      : reinstalling
        ? `确定重新安装“${plugin.name}” ${plugin.version} 吗？插件数据会保留。`
        : `确定安装“${plugin.name}”吗？`;
    if (!window.confirm(`${warning}${permissions}${storeNamespaces}${action}`)) return;

    setBusyId(plugin.id);
    setBusyAction("install");
    setError(null);
    try {
      await installPlugin(plugin.id);
      notifyExtensionsChanged();
      await loadPlugins();
    } catch (nextError) {
      setError(marketErrorMessage(nextError));
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }, [loadPlugins]);

  const handleUninstall = useCallback(async (plugin: MarketPlugin) => {
    if (!window.confirm(`确定卸载“${plugin.name}”吗？插件贡献的页面将立即从工作台移除。`)) return;

    setBusyId(plugin.id);
    setBusyAction("uninstall");
    setError(null);
    try {
      await uninstallPlugin(plugin.id);
      notifyExtensionsChanged();
      await loadPlugins();
    } catch (nextError) {
      setError(marketErrorMessage(nextError));
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }, [loadPlugins]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DomainTrail items={trailItems} />
          <span className="shrink-0 text-muted-foreground/60 na-body">/</span>
          <span className="min-w-0 truncate text-muted-foreground na-body">
            {selected?.name ?? "目录"}
          </span>
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 text-right md:flex">
          <span className="text-foreground na-caption font-medium">可用:{plugins.length}</span>
          <span className="text-muted-foreground/40 na-caption">/</span>
          <span className="text-foreground na-caption font-medium">已安装:{installedCount}</span>
        </div>
      </header>

      {error && (
        <div className="bg-destructive/8 text-destructive flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="na-body min-w-0 flex-1 truncate">{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void loadPlugins()}>重试</Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={cn(
          "min-h-0 flex-col border-r border-border/50 bg-sidebar/70",
          detailOpen ? "hidden md:flex" : "flex",
        )}>
          <div className="space-y-2 border-b border-border/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索插件"
                  className="h-8 pl-8"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => void loadPlugins()}
                disabled={loading}
                title="刷新插件列表"
                aria-label="刷新插件列表"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
            </div>
            <div className="grid grid-cols-2 rounded-md border border-border/70 bg-muted/30 p-0.5" aria-label="插件状态筛选">
              {(["all", "installed"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "na-caption h-7 rounded-sm font-medium transition-colors",
                    filter === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "all" ? `全部 ${plugins.length}` : `已安装 ${installedCount}`}
                </button>
              ))}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {loading && plugins.length === 0 ? (
              <p className="na-body px-4 py-5 text-muted-foreground">正在加载插件...</p>
            ) : filteredPlugins.length === 0 ? (
              <p className="na-body px-4 py-5 text-muted-foreground">没有符合条件的插件。</p>
            ) : filteredPlugins.map((plugin) => {
              const current = selected?.id === plugin.id;
              const updateAvailable = isUpdateAvailable(plugin);
              const PluginIcon = resolveExtensionIcon(plugin.icon, plugin.id);
              return (
                <button
                  key={plugin.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(plugin.id);
                    setDetailOpen(true);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-border/30 px-3 py-2.5 text-left transition-colors",
                    current ? "bg-primary/8 text-foreground" : "hover:bg-accent/45",
                  )}
                >
                  <div className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md border",
                    current
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "bg-background text-muted-foreground",
                  )}>
                    <PluginIcon className="size-4" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="na-body-strong truncate">{plugin.name}</span>
                      {updateAvailable ? (
                        <Badge variant="secondary" className="shrink-0">可更新</Badge>
                      ) : plugin.installedVersion !== null ? (
                        <Check className="size-3.5 shrink-0 text-primary" />
                      ) : null}
                    </span>
                    <span className="na-caption mt-0.5 block truncate text-muted-foreground">
                      {plugin.publisher} · {plugin.version}
                    </span>
                    <span className="na-caption mt-1 line-clamp-2 text-muted-foreground">{plugin.description}</span>
                  </span>
                </button>
              );
            })}
          </ScrollArea>
        </aside>

        <main className={cn("min-h-0 min-w-0 overflow-hidden", detailOpen ? "block" : "hidden md:block")}>
          {selected ? (
            <ScrollArea className="h-full" orientation="vertical">
              <div className="p-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mb-3 -ml-2 md:hidden"
                  onClick={() => setDetailOpen(false)}
                >
                  <ChevronLeft className="size-4" />
                  返回插件
                </Button>
                <section className="rounded-md border border-border/70">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/35">
                        <SelectedIcon className="size-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="na-title-panel truncate">{selected.name}</h3>
                          {isUpdateAvailable(selected) ? (
                            <Badge variant="secondary"><RefreshCw />可更新</Badge>
                          ) : selected.installedVersion !== null ? (
                            <Badge variant="secondary"><PackageCheck />已安装</Badge>
                          ) : null}
                          {selected.nativeCode && <Badge variant="outline"><Code2 />原生代码</Badge>}
                        </div>
                        <p className="na-caption mt-1 text-muted-foreground">{selected.id}</p>
                      </div>
                    </div>
                    {selected.installedVersion !== null && !isUpdateAvailable(selected) ? (
                      <div className="flex items-center gap-2">
                        {isReinstallAvailable(selected) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleInstall(selected)}
                            disabled={!selected.available || busyId !== null}
                          >
                            {busyId === selected.id && busyAction === "install"
                              ? <LoaderCircle className="animate-spin" />
                              : <RefreshCw />}
                            {busyId === selected.id && busyAction === "install" ? "重新安装中" : "重新安装"}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleUninstall(selected)}
                          disabled={busyId !== null}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          {busyId === selected.id && busyAction === "uninstall"
                            ? <LoaderCircle className="animate-spin" />
                            : <Trash2 />}
                          {busyId === selected.id && busyAction === "uninstall" ? "卸载中" : "卸载"}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleInstall(selected)}
                        disabled={!selected.available || busyId !== null}
                      >
                        {busyId === selected.id ? (
                          <LoaderCircle className="animate-spin" />
                        ) : isUpdateAvailable(selected) ? (
                          <RefreshCw />
                        ) : (
                          <Download />
                        )}
                        {busyId === selected.id
                          ? isUpdateAvailable(selected) ? "更新中" : "安装中"
                          : !selected.available ? "暂不可用"
                          : isUpdateAvailable(selected) ? "更新" : "安装"}
                      </Button>
                    )}
                  </div>

                  <div className="px-4 py-4">
                    <p className="na-body text-muted-foreground">{selected.description}</p>
                    <div className="mt-4 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
                      <div className="flex items-center gap-2 bg-background px-3 py-2.5">
                        <UserRound className="size-4 text-muted-foreground" />
                        <div className="min-w-0"><p className="na-label text-muted-foreground">维护者</p><p className="na-body-strong truncate">{selected.publisher}</p></div>
                      </div>
                      <div className="flex items-center gap-2 bg-background px-3 py-2.5">
                        <PackageCheck className="size-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="na-label text-muted-foreground">版本</p>
                          <p className="na-body-strong truncate">
                            {isUpdateAvailable(selected)
                              ? `${selected.installedVersion} -> ${selected.version}`
                              : selected.installedVersion ?? selected.version}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 bg-background px-3 py-2.5">
                        <Box className="size-4 text-muted-foreground" />
                        <div className="min-w-0"><p className="na-label text-muted-foreground">来源</p><p className="na-body-strong truncate">{selected.sourceLabel}</p></div>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <section className="rounded-md border border-border/70">
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                      <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /><h4 className="na-title-section">申请权限</h4></div>
                      <span className="na-caption text-muted-foreground">{selected.permissions.length}</span>
                    </div>
                    {selected.permissions.length === 0 ? (
                      <p className="na-body px-4 py-3 text-muted-foreground">该插件未申请基础设施权限。</p>
                    ) : (
                      <div className="divide-y">
                        {selected.permissions.map((permission) => (
                          <div key={permission} className="px-4 py-2.5">
                            <p className="na-body-strong">{permissionLabel(permission)}</p>
                            <p className="na-code mt-0.5 text-muted-foreground">{permission}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="rounded-md border border-border/70">
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                      <div className="flex items-center gap-2"><PanelsTopLeft className="size-4 text-muted-foreground" /><h4 className="na-title-section">工作台视图</h4></div>
                      <span className="na-caption text-muted-foreground">{selected.views.length}</span>
                    </div>
                    {selected.views.length === 0 ? (
                      <p className="na-body px-4 py-3 text-muted-foreground">该插件没有贡献页面。</p>
                    ) : (
                      <div className="divide-y">
                        {selected.views.map((view) => (
                          <div key={view.id} className="px-4 py-2.5">
                            <p className="na-body-strong">{view.title}</p>
                            <p className="na-code mt-0.5 text-muted-foreground">{view.id}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="border-t px-4 py-2.5">
                      <p className="na-label text-muted-foreground">后端运行时</p>
                      <p className="na-code mt-0.5">{selected.backendRuntime ?? "无后端"}</p>
                    </div>
                    <div className="border-t px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Workflow className="size-4 text-muted-foreground" />
                          <p className="na-label text-muted-foreground">Flow 节点</p>
                        </div>
                        <span className="na-caption text-muted-foreground">{selected.flowNodes.length}</span>
                      </div>
                      {selected.flowNodes.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {selected.flowNodes.map((node) => (
                            <div key={node.uses}>
                              <p className="na-body-strong">{node.name}</p>
                              <p className="na-code mt-0.5 break-all text-muted-foreground">{node.uses}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              选择一个插件查看详情
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
