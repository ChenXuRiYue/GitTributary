import { useCallback, useRef, useState } from "react";
import { PanelLeftClose, PanelLeft } from "lucide-react";

import { BrandIcon } from "@/components/BrandIcon";

import {
  plugins,
  extensionPlugins,
  systemPlugins,
} from "./plugins/registry";
import type { PluginDescriptor } from "./plugins/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 侧边栏宽度边界（px） */
const COLLAPSED_WIDTH = 56;
const MIN_WIDTH = 180; // 展开态下限
const MAX_WIDTH = 360; // 展开态上限
const DEFAULT_WIDTH = 208;
/** 拖拽到此阈值以下则自动收起 */
const COLLAPSE_THRESHOLD = 140;

function App() {
  const [activeId, setActiveId] = useState(plugins[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const active = plugins.find((p) => p.id === activeId) ?? plugins[0];
  const ActivePanel = active?.panel;

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      const raw = ev.clientX - left;
      if (raw < COLLAPSE_THRESHOLD) {
        // 拖得过窄：自动收起
        setCollapsed(true);
      } else {
        setCollapsed(false);
        // 钳制在下限与上限之间
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

  function SidebarButton({ plugin }: { plugin: PluginDescriptor }) {
    const Icon = plugin.icon;
    const isActive = plugin.id === active?.id;

    const button = (
      <button
        type="button"
        onClick={() => setActiveId(plugin.id)}
        className={cn(
          "flex h-9 items-center rounded-md text-sm transition-colors",
          collapsed ? "w-9 justify-center" : "w-full gap-3 px-3",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        {!collapsed && <span className="truncate">{plugin.name}</span>}
      </button>
    );

    // 收起时用 tooltip 补充名称；展开时文字已可见，无需 tooltip
    if (!collapsed) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{plugin.name}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden">
        {/* 左侧可收缩 + 可拖拽调宽的侧边栏 */}
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
                <span className="truncate text-sm font-semibold">
                  GitTributary
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="text-muted-foreground hover:bg-sidebar-accent/60 flex size-9 shrink-0 items-center justify-center rounded-md transition-colors"
              title={collapsed ? "展开" : "收起"}
            >
              {collapsed ? (
                <PanelLeft className="size-[18px]" />
              ) : (
                <PanelLeftClose className="size-[18px]" />
              )}
            </button>
          </div>

          <Separator className="bg-sidebar-border my-2" />

          {/* 上部：扩展插件区（后续可选安装） */}
          <ScrollArea className="flex-1">
            <nav className="flex flex-col gap-1">
              {extensionPlugins.map((p) => (
                <SidebarButton key={p.id} plugin={p} />
              ))}
            </nav>
          </ScrollArea>

          {/* 底部固定：系统按钮区 */}
          {systemPlugins.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              <Separator className="bg-sidebar-border mb-1" />
              {systemPlugins.map((p) => (
                <SidebarButton key={p.id} plugin={p} />
              ))}
            </div>
          )}

          {/* 右边缘拖拽把手（仅展开态可拖） */}
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
            <header className="border-border flex flex-col gap-1 border-b px-7 py-5">
              <h2 className="text-xl font-semibold">{active.name}</h2>
              <p className="text-muted-foreground text-sm">
                {active.description}
              </p>
            </header>
          )}
          <ScrollArea className="flex-1">
            <div className="mx-auto flex max-w-3xl flex-col gap-4 px-7 py-6">
              {ActivePanel && <ActivePanel />}
            </div>
          </ScrollArea>
        </main>
      </div>
    </TooltipProvider>
  );
}

export default App;
