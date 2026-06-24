import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 导航项描述 */
export interface NavItem {
  id: string;
  name: string;
  icon: LucideIcon;
  /** false → 归入 ... 折叠区。默认 true */
  pinned?: boolean;
  /** "system" → 固定在底部系统区。默认 "extension" */
  group?: "extension" | "system";
}

interface IconNavProps {
  /** 导航项列表 */
  items: NavItem[];
  /** 当前选中的 id */
  activeId: string;
  /** 选中回调 */
  onSelect: (id: string) => void;
  /** 按钮尺寸,默认 "sm"(size-8),"md"(size-9) */
  size?: "sm" | "md";
  /** 额外 className */
  className?: string;
}

/**
 * 通用纵向图标导航条。
 *
 * 特性:
 * - 固定区(pinned) + 溢出折叠区(...) + 系统区(底部固定)
 * - tooltip 悬浮名称
 * - 选中高亮
 * - 全局可复用:一级侧边栏、二级侧边栏
 */
export function IconNav({ items, activeId, onSelect, size = "sm", className }: IconNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const extensionItems = items.filter((i) => (i.group ?? "extension") === "extension");
  const systemItems = items.filter((i) => i.group === "system");

  const pinnedItems = extensionItems.filter((i) => i.pinned !== false);
  const overflowItems = extensionItems.filter((i) => i.pinned === false);

  const btnSize = size === "md" ? "size-9" : "size-8";
  const iconSize = size === "md" ? "size-[18px]" : "size-4";

  function NavButton({ item }: { item: NavItem }) {
    const Icon = item.icon;
    const isActive = item.id === activeId;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => { onSelect(item.id); }}
            className={cn(
              "flex items-center justify-center rounded-lg transition-all",
              btnSize,
              isActive
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className={iconSize} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {item.name}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <nav className={cn("flex flex-col items-center gap-1", className)}>
      {/* 固定展示区 */}
      {pinnedItems.map((item) => (
        <NavButton key={item.id} item={item} />
      ))}

      {/* 溢出折叠区 */}
      {overflowItems.length > 0 && (
        <>
          <div className="my-1 h-px w-5 bg-border/50" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className={cn(
                  "flex items-center justify-center rounded-lg transition-all",
                  btnSize,
                  moreOpen
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <MoreHorizontal className={iconSize} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              更多
            </TooltipContent>
          </Tooltip>
          {moreOpen && overflowItems.map((item) => (
            <NavButton key={item.id} item={item} />
          ))}
        </>
      )}

      {/* 系统区(底部固定) */}
      {systemItems.length > 0 && (
        <>
          <div className="mt-auto" />
          <div className="my-1 h-px w-5 bg-border/50" />
          {systemItems.map((item) => (
            <NavButton key={item.id} item={item} />
          ))}
        </>
      )}
    </nav>
  );
}
