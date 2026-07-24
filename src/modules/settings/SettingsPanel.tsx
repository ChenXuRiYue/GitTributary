import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  RotateCcw,
} from "lucide-react";

import { useSidebarPreferences } from "@/app/SidebarPreferencesContext";
import type { SidebarItemInfo } from "@/app/sidebarPreferences";
import { DomainTrail } from "@/shared/components/DomainTrail";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/utils";
import { GitSettings } from "./GitSettings";
import { GitRemoteSettings } from "./GitRemoteSettings";
import { SoftwareDataSettings } from "./SoftwareDataSettings";

const SETTINGS_NAV_GROUPS = [
  {
    id: "data-space",
    name: "数据空间",
    items: [
      { id: "software-data", name: "软件数据", description: "位置 · 远程仓库 · 同步策略" },
    ],
  },
  {
    id: "git",
    name: "Git",
    items: [
      { id: "git-config", name: "全局提交身份", description: "用户名 · 邮箱 · 默认访问" },
      { id: "git-repositories", name: "已打开仓库", description: "远端 · 仓库提交身份 · 凭据" },
    ],
  },
  {
    id: "interface",
    name: "界面",
    items: [
      { id: "sidebar", name: "侧边栏", description: "入口顺序与显示" },
    ],
  },
];

const SETTINGS_NAV_ITEMS = SETTINGS_NAV_GROUPS.flatMap((group) => group.items.map((item) => ({
  ...item,
  groupId: group.id,
  groupName: group.name,
})));

const KIND_LABELS: Record<SidebarItemInfo["kind"], string> = {
  core: "Core",
  plugin: "插件",
  function: "功能",
};

function SidebarItemRow({
  item,
  visible,
  first,
  last,
  dragging,
  onVisibilityChange,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  item: SidebarItemInfo;
  visible: boolean;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onVisibilityChange: (visible: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const Icon = item.icon;
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={cn(
        "flex min-h-14 items-center gap-2.5 px-3 py-2 transition-colors",
        !visible && "bg-muted/20 text-muted-foreground",
        dragging && "opacity-40",
      )}
      data-sidebar-item={item.id}
    >
      <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/55" aria-hidden="true" />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="na-body-strong truncate">{item.name}</span>
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            {KIND_LABELS[item.kind]}
          </Badge>
        </div>
        <p className="na-caption mt-0.5 hidden truncate text-muted-foreground md:block">
          {item.description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onMoveUp}
          disabled={first}
          title="上移"
          aria-label={`上移 ${item.name}`}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onMoveDown}
          disabled={last}
          title="下移"
          aria-label={`下移 ${item.name}`}
        >
          <ArrowDown className="size-3.5" />
        </Button>
      </div>
      <Switch
        checked={visible}
        onCheckedChange={onVisibilityChange}
        disabled={!item.canHide}
        aria-label={`${visible ? "隐藏" : "显示"} ${item.name}`}
        title={item.canHide ? (visible ? "隐藏" : "显示") : "设置入口始终显示"}
      />
    </div>
  );
}

function SidebarItemSection({
  title,
  items,
  draggedId,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  title: string;
  items: SidebarItemInfo[];
  draggedId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void;
}) {
  const { isVisible, setVisible, move } = useSidebarPreferences();
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="na-title-section">{title}</h2>
        <span className="na-caption text-muted-foreground">{items.length} 项</span>
      </div>
      <div className="divide-y overflow-hidden rounded-md border border-border/70 bg-background">
        {items.map((item, index) => (
          <SidebarItemRow
            key={item.id}
            item={item}
            visible={isVisible(item.id)}
            first={index === 0}
            last={index === items.length - 1}
            dragging={draggedId === item.id}
            onVisibilityChange={(visible) => setVisible(item.id, visible)}
            onMoveUp={() => move(item.id, "up")}
            onMoveDown={() => move(item.id, "down")}
            onDragStart={() => onDragStart(item.id)}
            onDragEnd={onDragEnd}
            onDrop={() => onDrop(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

export function SettingsPanel() {
  const [activeViewId, setActiveViewId] = useState("software-data");
  const [visitedViewIds, setVisitedViewIds] = useState<Set<string>>(() => new Set(["software-data"]));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const { items, isVisible, reorder, reset } = useSidebarPreferences();
  const mainItems = useMemo(() => items.filter((item) => item.group === "main"), [items]);
  const systemItems = useMemo(() => items.filter((item) => item.group === "system"), [items]);
  const visibleCount = items.filter((item) => isVisible(item.id)).length;
  const activeView = SETTINGS_NAV_ITEMS.find((item) => item.id === activeViewId) ?? SETTINGS_NAV_ITEMS[0];

  const selectView = (id: string) => {
    setActiveViewId(id);
    setVisitedViewIds((current) => {
      if (current.has(id)) return current;
      return new Set(current).add(id);
    });
  };

  const handleDrop = (targetId: string) => {
    if (draggedId) reorder(draggedId, targetId);
    setDraggedId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header
        aria-label="设置页标题"
        className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <DomainTrail items={[
          { id: "settings", label: "设置" },
          { id: activeView.groupId, label: activeView.groupName },
          { id: activeView.id, label: activeView.name },
        ]} />
        <p className="min-w-0 truncate na-caption text-muted-foreground" title={activeView.description}>
          {activeView.description}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-36 shrink-0 border-r border-border/50 px-2 py-3">
          <nav aria-label="设置分类" className="flex flex-col gap-4">
            {SETTINGS_NAV_GROUPS.map((group) => (
              <div
                key={group.id}
                role="group"
                aria-labelledby={`settings-group-${group.id}`}
              >
                <div
                  id={`settings-group-${group.id}`}
                  className="mb-1 flex h-5 items-center px-1.5 na-label text-muted-foreground/70"
                >
                  {group.name}
                </div>
                <div className="ml-2 flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const isActive = item.id === activeViewId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-label={item.name}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => selectView(item.id)}
                        className={cn(
                          "flex h-8 w-full items-center rounded-md px-2.5 text-left na-body-strong transition-colors",
                          isActive
                            ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                            : "text-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <span className="truncate">{item.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {visitedViewIds.has("software-data") && (
            <div className={cn("min-h-0 flex-1", activeViewId !== "software-data" && "hidden")} aria-hidden={activeViewId !== "software-data"}>
              <SoftwareDataSettings />
            </div>
          )}
          {visitedViewIds.has("git-repositories") && (
            <div className={cn("min-h-0 flex-1", activeViewId !== "git-repositories" && "hidden")} aria-hidden={activeViewId !== "git-repositories"}>
              <GitRemoteSettings />
            </div>
          )}
          {visitedViewIds.has("git-config") && (
            <div className={cn("min-h-0 flex-1", activeViewId !== "git-config" && "hidden")} aria-hidden={activeViewId !== "git-config"}>
              <GitSettings />
            </div>
          )}
          {visitedViewIds.has("sidebar") && (
            <div className={cn("min-h-0 flex-1 flex-col", activeViewId !== "sidebar" && "hidden")} aria-hidden={activeViewId !== "sidebar"}>
              <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4">
                <span className="na-caption text-muted-foreground">
                  显示:{visibleCount} / {items.length}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-3.5" />
                  恢复默认
                </Button>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
                  <SidebarItemSection
                    title="主导航"
                    items={mainItems}
                    draggedId={draggedId}
                    onDragStart={setDraggedId}
                    onDragEnd={() => setDraggedId(null)}
                    onDrop={handleDrop}
                  />
                  <SidebarItemSection
                    title="底部功能"
                    items={systemItems}
                    draggedId={draggedId}
                    onDragStart={setDraggedId}
                    onDragEnd={() => setDraggedId(null)}
                    onDrop={handleDrop}
                  />
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
