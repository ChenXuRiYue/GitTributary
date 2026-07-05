import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, PanelLeftClose, PanelLeft, MoreHorizontal } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

import { IconNav, type NavItem } from "@/components/IconNav";

import { modules } from "./plugins/registry";
import type { ModuleDescriptor } from "./plugins/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 侧边栏宽度边界（px） */
const COLLAPSED_WIDTH = 56;
const MIN_WIDTH = 180;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 208;
const COLLAPSE_THRESHOLD = 140;
const PROJECT_REPO_URL = "https://github.com/ChenXuRiYue/GitTributary";
const NAV_MORE_STATE_NS = "ui-state";
const NAV_MORE_STATE_KEY = "app.nav.more.open";
const NAV_MORE_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

interface NavMoreUiState {
  version: 1;
  open: boolean;
  updatedAt: number;
}

function parseNavMoreUiState(value: unknown): NavMoreUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<NavMoreUiState>;
  if (state.version !== 1) return null;
  if (typeof state.open !== "boolean") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    open: state.open,
    updatedAt: state.updatedAt,
  };
}

/** 将模块描述转换为通用 NavItem(收起态使用 IconNav) */
const navItems: NavItem[] = modules.map((module) => ({
  id: module.id,
  name: module.name,
  icon: module.icon,
  pinned: module.pinned,
  group: module.group === "system" ? "system" : "main",
}));

function App() {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const active = modules.find((module) => module.id === activeId) ?? modules[0];
  const ActivePanel = active?.panel;
  const isFullHeightPanel = active?.fullHeight === true;

  // 分组(展开态用)
  const mainModules = modules.filter((module) => (module.group ?? "main") === "main");
  const systemModules = modules.filter((module) => module.group === "system");
  const pinnedModules = mainModules.filter((module) => module.pinned !== false);
  const overflowModules = mainModules.filter((module) => module.pinned === false);

  const openProjectRepo = useCallback(() => {
    void openUrl(PROJECT_REPO_URL);
  }, []);

  const persistMoreOpen = useCallback((open: boolean) => {
    void invoke("store_set", {
      namespace: NAV_MORE_STATE_NS,
      key: NAV_MORE_STATE_KEY,
      value: {
        version: 1,
        open,
        updatedAt: Date.now(),
      } satisfies NavMoreUiState,
    }).catch(() => {
      // Sidebar interaction should not depend on store availability.
    });
  }, []);

  const toggleMoreOpen = useCallback(() => {
    setMoreOpen((open) => {
      const next = !open;
      persistMoreOpen(next);
      return next;
    });
  }, [persistMoreOpen]);

  const setMoreOpenAndPersist = useCallback((open: boolean) => {
    setMoreOpen(open);
    persistMoreOpen(open);
  }, [persistMoreOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await invoke<unknown>("store_get", {
          namespace: NAV_MORE_STATE_NS,
          key: NAV_MORE_STATE_KEY,
        });
        const cached = parseNavMoreUiState(raw);
        const fresh = cached && Date.now() - cached.updatedAt <= NAV_MORE_STATE_TTL_MS;
        if (!cancelled && cached && fresh) {
          setMoreOpen(cached.open);
          return;
        }
        if (raw != null) {
          await invoke("store_delete", { namespace: NAV_MORE_STATE_NS, key: NAV_MORE_STATE_KEY });
        }
      } catch {
        // First run, expired state, or running outside Tauri.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      const raw = ev.clientX - left;
      if (raw < COLLAPSE_THRESHOLD) {
        setCollapsed(true);
      } else {
        setCollapsed(false);
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw)));
      }
    };

    const onUp = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  /** 展开态按钮(带文字) */
  function ExpandedButton({ module }: { module: ModuleDescriptor }) {
    const Icon = module.icon;
    const isActive = module.id === active?.id;
    return (
      <button
        type="button"
        onClick={() => setActiveId(module.id)}
        aria-label={module.name}
        className={cn(
          "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="truncate">{module.name}</span>
      </button>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden">
        {/* 左侧侧边栏 */}
        <aside
          ref={asideRef}
          style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
          className={cn(
            "glass border-sidebar-border relative flex shrink-0 flex-col border-r p-2",
            !dragging && "transition-[width] duration-200",
          )}
        >
          {/* 顶部：收缩按钮 + 展开态品牌入口 */}
          <div
            className={cn(
              "flex h-9 items-center gap-1",
              collapsed ? "justify-center" : "px-1",
            )}
          >
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="text-muted-foreground hover:bg-sidebar-accent/60 flex size-9 shrink-0 items-center justify-center rounded-md transition-colors"
              title={collapsed ? "展开" : "收起"}
            >
              {collapsed ? <PanelLeft className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            </button>
            {!collapsed && (
              <button
                type="button"
                onClick={openProjectRepo}
                className="text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1 text-left transition-colors"
                title="打开项目仓库"
              >
                <span className="block min-w-0 truncate text-sm font-semibold leading-4">Git Tributary</span>
                <ExternalLink className="text-muted-foreground size-4 shrink-0" />
              </button>
            )}
          </div>

          <Separator className="bg-sidebar-border my-2" />

          {/* 收起态:用 IconNav(通用组件,含 pin/overflow/system) */}
          {collapsed ? (
            <IconNav
              items={navItems}
              activeId={activeId}
              onSelect={setActiveId}
              size="md"
              className="flex-1"
              moreStateKey={NAV_MORE_STATE_KEY}
              moreOpen={moreOpen}
              onMoreOpenChange={setMoreOpenAndPersist}
            />
          ) : (
            /* 展开态:图标+文字,自行实现 pin/overflow */
            <>
              <ScrollArea className="flex-1">
                <nav className="flex flex-col gap-1">
                  {pinnedModules.map((module) => (
                    <ExpandedButton key={module.id} module={module} />
                  ))}
                  {/* 溢出折叠 */}
                  {overflowModules.length > 0 && (
                    <>
                      <Separator className="bg-sidebar-border my-1" />
                      <button
                        type="button"
                        onClick={toggleMoreOpen}
                        className={cn(
                          "flex h-8 w-full items-center gap-3 rounded-md px-3 text-xs transition-colors",
                          moreOpen
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/60",
                        )}
                      >
                        <MoreHorizontal className="size-[16px] shrink-0" />
                        <span>更多</span>
                      </button>
                      {moreOpen && overflowModules.map((module) => (
                        <ExpandedButton key={module.id} module={module} />
                      ))}
                    </>
                  )}
                </nav>
              </ScrollArea>

              {/* 系统区(底部固定) */}
              {systemModules.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  <Separator className="bg-sidebar-border mb-1" />
                  {systemModules.map((module) => (
                    <ExpandedButton key={module.id} module={module} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* 拖拽把手 */}
          {!collapsed && (
            <div
              onMouseDown={startResize}
              onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
              className="hover:bg-primary/30 absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent transition-colors"
              title="拖拽调整宽度，双击重置"
            />
          )}
        </aside>

        {/* 右侧操作面板 */}
        <main className="bg-background flex flex-1 flex-col overflow-hidden">
          {active && !isFullHeightPanel && (
            <header className="border-border flex flex-col gap-1 border-b px-7 py-4">
              <h2 className="gt-title-app">{active.name}</h2>
              <p className="gt-caption text-muted-foreground">{active.description}</p>
            </header>
          )}
          {isFullHeightPanel ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              {ActivePanel && <ActivePanel />}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-7 py-6">
                {ActivePanel && <ActivePanel />}
              </div>
            </ScrollArea>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

export default App;
