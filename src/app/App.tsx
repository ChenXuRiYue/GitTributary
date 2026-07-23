import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, PanelLeftClose, PanelLeft, MoreHorizontal, type LucideIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

import { IconNav, type NavItem } from "@/shared/components/IconNav";

import { coreModules } from "./registry";
import {
  ExtensionFrame,
  useExtensionContributions,
} from "@/platform/extensions";
import { resolveExtensionIcon } from "@/platform/extensions/icons";
import type { ExtensionModalBackdrop } from "@/platform/extensions/types";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Separator } from "@/shared/ui/separator";
import {
  TooltipProvider,
} from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { SidebarPreferencesProvider } from "./SidebarPreferencesContext";
import type { SidebarItemKind } from "./sidebarPreferences";
import { useSidebarPreferencesController } from "./useSidebarPreferencesController";

/** 侧边栏宽度边界（px） */
const COLLAPSED_WIDTH = 56;
const MIN_WIDTH = 180;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 208;
const COLLAPSE_THRESHOLD = 140;
const PROJECT_REPO_URL = "https://github.com/ChenXuRiYue/NoteAura";
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

interface WorkbenchItem {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  group: "main" | "system";
  fullHeight: boolean;
  pinned: boolean;
  kind: SidebarItemKind;
  canHide: boolean;
  content: ReactNode;
}

const registeredCoreItems: WorkbenchItem[] = coreModules.map(({ panel: Panel, ...module }) => ({
  ...module,
  group: module.group ?? "main",
  fullHeight: module.fullHeight ?? false,
  pinned: module.pinned ?? true,
  kind: module.navigationKind ?? "core",
  canHide: module.canHide ?? true,
  content: <Panel />,
}));

function App() {
  const { contributions } = useExtensionContributions();
  const [extensionModalBackdrop, setExtensionModalBackdrop] = useState<ExtensionModalBackdrop | null>(null);
  const handleExtensionModalBackdropChange = useCallback((backdrop: ExtensionModalBackdrop | null) => {
    setExtensionModalBackdrop(backdrop);
  }, []);
  const workbenchItems = useMemo<WorkbenchItem[]>(() => [
    ...registeredCoreItems,
    ...contributions.map((contribution) => ({
      id: `plugin:${contribution.pluginId}:${contribution.viewId}`,
      name: contribution.title,
      description: contribution.description,
      icon: resolveExtensionIcon(contribution.iconUrl, contribution.pluginId),
      group: "main" as const,
      fullHeight: true,
      pinned: true,
      kind: "plugin" as const,
      canHide: true,
      content: (
        <ExtensionFrame
          contribution={contribution}
          onModalBackdropChange={handleExtensionModalBackdropChange}
        />
      ),
    })),
  ], [contributions, handleExtensionModalBackdropChange]);
  const {
    controller: sidebarPreferencesController,
    orderedItems: orderedWorkbenchItems,
    visibleItems: visibleWorkbenchItems,
  } = useSidebarPreferencesController(workbenchItems);
  const navItems = useMemo<NavItem[]>(() => visibleWorkbenchItems.map((item) => ({
    id: item.id,
    name: item.name,
    icon: item.icon,
    pinned: item.pinned,
    group: item.group,
  })), [visibleWorkbenchItems]);

  const [activeId, setActiveId] = useState(registeredCoreItems[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  // 折叠态 IconNav 和展开态侧边栏共用这一份“更多”展开状态。
  const [moreOpen, setMoreOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const active = orderedWorkbenchItems.find((item) => item.id === activeId) ?? visibleWorkbenchItems[0];
  const isFullHeightPanel = active?.fullHeight === true;

  // 分组(展开态用)
  const mainItems = visibleWorkbenchItems.filter((item) => item.group === "main");
  const systemItems = visibleWorkbenchItems.filter((item) => item.group === "system");
  const pinnedItems = mainItems.filter((item) => item.pinned);
  const overflowItems = mainItems.filter((item) => !item.pinned);

  useEffect(() => {
    if (!visibleWorkbenchItems.some((item) => item.id === activeId)) {
      setActiveId(visibleWorkbenchItems[0]?.id ?? "");
    }
  }, [activeId, visibleWorkbenchItems]);

  const openProjectRepo = useCallback(() => {
    void openUrl(PROJECT_REPO_URL);
  }, []);

  // 只负责把“更多”展开状态写入 Tauri 存储，不直接修改 React 页面状态。
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
      // 即使存储暂时不可用，也不能阻止用户展开或收起菜单。
    });
  }, []);

  // App 外壳的一级侧边栏展开为“图标 + 文字”时，点击其“更多”按钮会切换并保存状态。
  // 当前没有 pinned: false 的工作台项，因此这个按钮暂时不会渲染出来。
  const toggleMoreOpen = useCallback(() => {
    setMoreOpen((open) => {
      const next = !open;
      persistMoreOpen(next);
      return next;
    });
  }, [persistMoreOpen]);

  // IconNav 是受控组件：它给出明确的新状态，App 负责更新并持久化。
  const setMoreOpenAndPersist = useCallback((open: boolean) => {
    setMoreOpen(open);
    persistMoreOpen(open);
  }, [persistMoreOpen]);

  // App 首次挂载时读取三天内保存的状态，让菜单恢复到上次的展开或收起状态。
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
        // 首次运行、缓存失效或不在 Tauri 环境中时，沿用默认关闭状态。
      }
    })();
    // 组件卸载后忽略异步读取结果，避免再修改已经卸载的组件状态。
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
  function ExpandedButton({ item }: { item: WorkbenchItem }) {
    const Icon = item.icon;
    const isActive = item.id === active?.id;
    return (
      <button
        type="button"
        onClick={() => setActiveId(item.id)}
        aria-label={item.name}
        className={cn(
          "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="truncate">{item.name}</span>
      </button>
    );
  }

  return (
    <SidebarPreferencesProvider value={sidebarPreferencesController}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-screen overflow-hidden">
        {/* 左侧侧边栏 */}
        <aside
          ref={asideRef}
          data-testid="primary-sidebar"
          style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
          inert={extensionModalBackdrop !== null}
          aria-hidden={extensionModalBackdrop !== null || undefined}
          className={cn(
            "glass relative flex shrink-0 flex-col border-r p-2",
            extensionModalBackdrop === "immersive"
              ? "border-black/60"
              : extensionModalBackdrop === "standard"
                ? "border-black/55"
                : "border-sidebar-border",
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
                <span className="block min-w-0 truncate text-sm font-semibold leading-4">NoteAura</span>
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
                  {pinnedItems.map((item) => (
                    <ExpandedButton key={item.id} item={item} />
                  ))}
                  {/* 溢出折叠 */}
                  {overflowItems.length > 0 && (
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
                      {moreOpen && overflowItems.map((item) => (
                        <ExpandedButton key={item.id} item={item} />
                      ))}
                    </>
                  )}
                </nav>
              </ScrollArea>

              {/* 系统区(底部固定) */}
              {systemItems.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  <Separator className="bg-sidebar-border mb-1" />
                  {systemItems.map((item) => (
                    <ExpandedButton key={item.id} item={item} />
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

          {extensionModalBackdrop && (
            <div
              aria-hidden="true"
              data-plugin-modal-backdrop={extensionModalBackdrop}
              className={cn(
                "absolute inset-y-0 left-0 -right-px z-[100] cursor-default",
                extensionModalBackdrop === "immersive" ? "bg-black/60" : "bg-black/55",
              )}
            />
          )}
        </aside>

        {/* 右侧操作面板 */}
        <main className="bg-background flex flex-1 flex-col overflow-hidden">
          {active && !isFullHeightPanel && (
            <header className="border-border flex flex-col gap-1 border-b px-7 py-4">
              <h2 className="na-title-app">{active.name}</h2>
              <p className="na-caption text-muted-foreground">{active.description}</p>
            </header>
          )}
          {isFullHeightPanel ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              {active?.content}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-7 py-6">
                {active?.content}
              </div>
            </ScrollArea>
          )}
        </main>
        </div>
      </TooltipProvider>
    </SidebarPreferencesProvider>
  );
}

export default App;
