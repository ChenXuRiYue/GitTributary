import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, GitBranch, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { gitViews } from "./registry";
import type { RepoOverview } from "./types";
import { IconNav, type NavItem } from "@/shared/components/IconNav";
import { Button } from "@/shared/ui/button";
import { DomainTrail, type DomainTrailItem } from "@/shared/components/DomainTrail";
import { cn } from "@/shared/lib/utils";

/** 将 GitViewDescriptor 转换为通用 NavItem */
const navItems: NavItem[] = gitViews.map((v) => ({
  id: v.id,
  name: v.name,
  icon: v.icon,
  pinned: v.pinned,
}));

interface GitViewUiState {
  version: 1;
  activeViewId: string;
  updatedAt: number;
}

interface WorkspaceInfo {
  active_repo: string | null;
  recent_repos: string[];
  device_id: string | null;
  device_name: string | null;
}

const GIT_VIEW_STATE_NS = "ui-state";
const GIT_VIEW_STATE_KEY = "git.view.active";
const GIT_MORE_STATE_KEY = "git.nav.more.open";
const GIT_VIEW_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function parseGitViewUiState(value: unknown): GitViewUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<GitViewUiState>;
  if (state.version !== 1) return null;
  if (typeof state.activeViewId !== "string" || state.activeViewId.length === 0) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    activeViewId: state.activeViewId,
    updatedAt: state.updatedAt,
  };
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}

function repoNameFromPath(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

/**
 * Git 面板 Shell:
 * 顶栏资源坐标 + 左侧二级侧边栏(IconNav 复用) + 右侧内容展示区
 */
export function GitPanel() {
  const [activeId, setActiveId] = useState(gitViews[0]?.id ?? "");
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [statusCount, setStatusCount] = useState(0);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const repoMenuRef = useRef<HTMLDivElement | null>(null);
  const requestGenerationRef = useRef(0);
  const initializedRef = useRef(false);
  const active = gitViews.find((v) => v.id === activeId) ?? gitViews[0];
  const ActiveView = active?.panel;

  const refreshGitContext = useCallback(async (repoPath?: string | null) => {
    const requestGeneration = ++requestGenerationRef.current;
    let nextRecentRepos: string[] = [];
    let pathToOpen = repoPath?.trim() || "";

    try {
      const workspace = await invoke<WorkspaceInfo>("get_workspace_info");
      nextRecentRepos = workspace.recent_repos ?? [];
      if (!pathToOpen) pathToOpen = workspace.active_repo ?? "";
      if (requestGeneration === requestGenerationRef.current) setRecentRepos(nextRecentRepos);
    } catch {
      // Browser preview or first-run shells may not have workspace state yet.
    }

    try {
      const nextOverview = pathToOpen
        ? await invoke<RepoOverview>("open_repo", { path: pathToOpen })
        : await invoke<RepoOverview>("get_overview");
      if (requestGeneration !== requestGenerationRef.current) return;
      setOverview(nextOverview);
      setStatusCount(0);
      setSessionGeneration((generation) => generation + 1);
      setRecentRepos((current) => {
        const merged = [nextOverview.path, ...nextRecentRepos, ...current];
        return Array.from(new Set(merged.filter(Boolean))).slice(0, 10);
      });
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setOverview(null);
      setStatusCount(0);
      setSessionGeneration((generation) => generation + 1);
    }
  }, []);

  const refreshRepository = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    try {
      const nextOverview = await invoke<RepoOverview>("get_overview");
      if (requestGeneration !== requestGenerationRef.current) return;
      setOverview(nextOverview);
      setSessionGeneration((generation) => generation + 1);
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setOverview(null);
      setStatusCount(0);
    }
  }, []);

  const selectView = useCallback((id: string) => {
    setActiveId(id);
    void invoke("store_set", {
      namespace: GIT_VIEW_STATE_NS,
      key: GIT_VIEW_STATE_KEY,
      value: {
        version: 1,
        activeViewId: id,
        updatedAt: Date.now(),
      } satisfies GitViewUiState,
    }).catch(() => {
      // The Git panel remains usable even when the store is unavailable.
    });
  }, []);

  const openRepoFromShell = useCallback(async (path: string) => {
    setRepoMenuOpen(false);
    await refreshGitContext(path);
  }, [refreshGitContext]);

  const openRepoFromDialog = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    await openRepoFromShell(selected as string);
  }, [openRepoFromShell]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void refreshGitContext();
  }, [refreshGitContext]);

  useEffect(() => {
    if (!repoMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!repoMenuRef.current?.contains(event.target as Node)) {
        setRepoMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRepoMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [repoMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await invoke<unknown>("store_get", {
          namespace: GIT_VIEW_STATE_NS,
          key: GIT_VIEW_STATE_KEY,
        });
        const cached = parseGitViewUiState(raw);
        const fresh = cached && Date.now() - cached.updatedAt <= GIT_VIEW_STATE_TTL_MS;
        const exists = cached && gitViews.some((view) => view.id === cached.activeViewId);

        if (!cancelled && cached && fresh && exists) {
          setActiveId(cached.activeViewId);
          return;
        }
        if (raw != null) {
          await invoke("store_delete", {
            namespace: GIT_VIEW_STATE_NS,
            key: GIT_VIEW_STATE_KEY,
          });
        }
      } catch {
        // No stored view yet, or running outside the Tauri shell.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const domainTrailItems: DomainTrailItem[] = useMemo(() => [
    { id: "git", label: "Git" },
    { id: active?.id ?? "unknown", label: active?.name ?? "变更" },
  ], [active?.id, active?.name]);

  const repoLabel = overview?.path ? repoNameFromPath(overview.path) : "选择仓库";
  const repoSubLabel = overview?.path
    ? `${overview.current_branch} / ${shortPath(overview.path)}`
    : "未打开仓库";
  const secondaryDomainStats = (() => {
    switch (activeId) {
      case "remote": return `远程:${overview?.remote_url ? 1 : 0}`;
      case "safety": return `仓库:${overview ? 1 : 0}`;
      case "branches": return "按需加载分支";
      case "history": return "按需加载历史";
      case "changes":
      default:
        return `变更:${statusCount}`;
    }
  })();
  const primaryDomainStats = `仓库:${recentRepos.length}`;
  const headerStats = [secondaryDomainStats, primaryDomainStats];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DomainTrail items={domainTrailItems} />
          <span className="shrink-0 text-muted-foreground/60 gt-body">/</span>
          <div ref={repoMenuRef} className="relative min-w-0 shrink">
            <button
              type="button"
              className="flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label={`切换 Git 仓库: ${repoLabel}`}
              aria-haspopup="menu"
              aria-expanded={repoMenuOpen}
              onClick={() => setRepoMenuOpen((open) => !open)}
              title={overview?.path ?? repoLabel}
            >
              <span className="min-w-0 truncate gt-body">{repoLabel}</span>
              <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", repoMenuOpen && "rotate-180")} />
            </button>

            {repoMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg sm:w-80"
              >
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="gt-body-strong truncate">{repoLabel}</div>
                    <div className="gt-caption truncate text-muted-foreground" title={overview?.path ?? undefined}>
                      {repoSubLabel}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => {
                      setRepoMenuOpen(false);
                      void refreshRepository();
                    }}
                  >
                    <RefreshCw className="size-3.5" />
                    刷新
                  </Button>
                </div>

                <div className="max-h-72 overflow-y-auto p-1">
                  {recentRepos.length === 0 ? (
                    <div className="px-3 py-6 text-center">
                      <GitBranch className="mx-auto size-6 text-muted-foreground" />
                      <div className="gt-body-strong mt-2">暂无最近仓库</div>
                      <p className="gt-caption mt-1 text-muted-foreground">打开一个仓库后会出现在这里。</p>
                    </div>
                  ) : (
                    recentRepos.map((repo) => {
                      const isCurrent = overview?.path === repo;
                      return (
                        <button
                          key={repo}
                          type="button"
                          role="menuitem"
                          className={cn(
                            "flex min-h-12 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                            isCurrent ? "bg-primary/8 text-foreground" : "hover:bg-accent hover:text-accent-foreground",
                          )}
                          onClick={() => openRepoFromShell(repo)}
                        >
                          <span className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md border",
                            isCurrent ? "border-primary/30 bg-primary/10 text-primary" : "bg-background text-muted-foreground",
                          )}>
                            {isCurrent ? <Check className="size-3.5" /> : <GitBranch className="size-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="gt-body-strong block truncate">{repoNameFromPath(repo)}</span>
                            <span className="gt-caption block truncate text-muted-foreground" title={repo}>
                              {shortPath(repo)}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-2 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => {
                      void openRepoFromDialog();
                    }}
                  >
                    <FolderOpen className="size-3.5" />
                    打开仓库
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 text-right md:flex">
          {headerStats.map((stat, index) => (
            <div key={`${index}.${stat}`} className="flex items-center gap-2">
              {index > 0 && <span className="text-muted-foreground/40 gt-caption">/</span>}
              <span className="text-foreground gt-caption font-medium">{stat}</span>
            </div>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 二级侧边栏 */}
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
          <IconNav
            items={navItems}
            activeId={activeId}
            onSelect={selectView}
            size="sm"
            moreStateKey={GIT_MORE_STATE_KEY}
          />
        </div>

        {/* 内容展示区 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {ActiveView && (
            <ActiveView
              overview={overview}
              recentRepos={recentRepos}
              sessionGeneration={sessionGeneration}
              openRepository={openRepoFromShell}
              refreshRepository={refreshRepository}
              onStatusCountChange={setStatusCount}
            />
          )}
        </div>
      </div>
    </div>
  );
}
