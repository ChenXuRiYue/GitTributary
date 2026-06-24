import { useCallback, useRef, useState } from "react";
import { PanelLeftClose, PanelLeft, MoreHorizontal } from "lucide-react";

import { BrandIcon } from "@/components/BrandIcon";
import { IconNav, type NavItem } from "@/components/IconNav";

import { plugins } from "./plugins/registry";
import type { PluginDescriptor } from "./plugins/types";
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

/** 将 PluginDescriptor 转换为通用 NavItem(收起态使用 IconNav) */
const navItems: NavItem[] = plugins.map((p) => ({
  id: p.id,
  name: p.name,
  icon: p.icon,
  pinned: p.pinned,
  group: p.category === "system" ? "system" : "extension",
}));

function App() {
  const [activeId, setActiveId] = useState(plugins[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const active = plugins.find((p) => p.id === activeId) ?? plugins[0];
  const ActivePanel = active?.panel;

  // 分组(展开态用)
  const extensionPlugins = plugins.filter((p) => (p.category ?? "extension") === "extension");
  const systemPlugins = plugins.filter((p) => p.category === "system");
  const pinnedExtensions = extensionPlugins.filter((p) => p.pinned !== false);
  const overflowExtensions = extensionPlugins.filter((p) => p.pinned === false);

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
  function ExpandedButton({ plugin }: { plugin: PluginDescriptor }) {
    const Icon = plugin.icon;
    const isActive = plugin.id === active?.id;
    return (
      <button
        type="button"
        onClick={() => setActiveId(plugin.id)}
        className={cn(
          "flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="truncate">{plugin.name}</span>
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
          {/* 顶部：品牌 + 收缩按钮 */}
          <div
            className={cn(
              "flex h-9 items-center",
              collapsed ? "justify-center" : "justify-between px-1",
            )}
          >
            {!collapsed && (
              <div className="flex items-center gap-2 overflow-hidden">
                <BrandIcon className="text-primary size-[18px] shrink-0" />
                <span className="truncate text-sm font-semibold">GitTributary</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="text-muted-foreground hover:bg-sidebar-accent/60 flex size-9 shrink-0 items-center justify-center rounded-md transition-colors"
              title={collapsed ? "展开" : "收起"}
            >
              {collapsed ? <PanelLeft className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            </button>
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
            />
          ) : (
            /* 展开态:图标+文字,自行实现 pin/overflow */
            <>
              <ScrollArea className="flex-1">
                <nav className="flex flex-col gap-1">
                  {pinnedExtensions.map((p) => (
                    <ExpandedButton key={p.id} plugin={p} />
                  ))}
                  {/* 溢出折叠 */}
                  {overflowExtensions.length > 0 && (
                    <>
                      <Separator className="bg-sidebar-border my-1" />
                      <button
                        type="button"
                        onClick={() => setMoreOpen((v) => !v)}
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
                      {moreOpen && overflowExtensions.map((p) => (
                        <ExpandedButton key={p.id} plugin={p} />
                      ))}
                    </>
                  )}
                </nav>
              </ScrollArea>

              {/* 系统区(底部固定) */}
              {systemPlugins.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  <Separator className="bg-sidebar-border mb-1" />
                  {systemPlugins.map((p) => (
                    <ExpandedButton key={p.id} plugin={p} />
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
          {active && (
            <header className="border-border flex flex-col gap-1 border-b px-7 py-4">
              <h2 className="text-lg font-semibold">{active.name}</h2>
              <p className="text-muted-foreground text-xs">{active.description}</p>
            </header>
          )}
          {active?.id === "git" ? (
            <div className="flex-1 overflow-hidden">
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
