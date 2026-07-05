import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

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
  /** "system" → 固定在底部系统区。默认 "main" */
  group?: "main" | "system";
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
  /** 数据中心缓存 key；传入后会持久化「更多」展开态 */
  moreStateKey?: string;
  /** 受控的「更多」展开态 */
  moreOpen?: boolean;
  /** 受控的「更多」展开态变化回调 */
  onMoreOpenChange?: (open: boolean) => void;
}

interface MoreUiState {
  version: 1;
  open: boolean;
  updatedAt: number;
}

const MORE_STATE_NS = "ui-state";
const MORE_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function parseMoreUiState(value: unknown): MoreUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<MoreUiState>;
  if (state.version !== 1) return null;
  if (typeof state.open !== "boolean") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    open: state.open,
    updatedAt: state.updatedAt,
  };
}

/**
 * 通用纵向图标导航条。
 *
 * 特性:
 * - 主导航区 + 溢出折叠区(...) + 系统区(底部固定)
 * - tooltip 悬浮名称
 * - 选中高亮
 * - 全局可复用:一级侧边栏、二级侧边栏
 */
export function IconNav({
  items,
  activeId,
  onSelect,
  size = "sm",
  className,
  moreStateKey,
  moreOpen: controlledMoreOpen,
  onMoreOpenChange,
}: IconNavProps) {
  const [uncontrolledMoreOpen, setUncontrolledMoreOpen] = useState(false);

  const mainItems = items.filter((i) => (i.group ?? "main") === "main");
  const systemItems = items.filter((i) => i.group === "system");

  const pinnedItems = mainItems.filter((i) => i.pinned !== false);
  const overflowItems = mainItems.filter((i) => i.pinned === false);

  const btnSize = size === "md" ? "size-9" : "size-8";
  const iconSize = size === "md" ? "size-[18px]" : "size-4";
  const moreOpen = controlledMoreOpen ?? uncontrolledMoreOpen;
  const setMoreOpenState = onMoreOpenChange ?? setUncontrolledMoreOpen;

  const persistMoreOpen = useCallback((open: boolean) => {
    if (!moreStateKey) return;
    void invoke("store_set", {
      namespace: MORE_STATE_NS,
      key: moreStateKey,
      value: {
        version: 1,
        open,
        updatedAt: Date.now(),
      } satisfies MoreUiState,
    }).catch(() => {
      // Navigation should stay responsive even if persistence is unavailable.
    });
  }, [moreStateKey]);

  useEffect(() => {
    if (!moreStateKey) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await invoke<unknown>("store_get", {
          namespace: MORE_STATE_NS,
          key: moreStateKey,
        });
        const cached = parseMoreUiState(raw);
        const fresh = cached && Date.now() - cached.updatedAt <= MORE_STATE_TTL_MS;
        if (!cancelled && cached && fresh) {
          setMoreOpenState(cached.open);
          return;
        }
        if (raw != null) {
          await invoke("store_delete", { namespace: MORE_STATE_NS, key: moreStateKey });
        }
      } catch {
        // First run, expired state, or running outside Tauri.
      }
    })();
    return () => { cancelled = true; };
  }, [moreStateKey, setMoreOpenState]);

  const toggleMoreOpen = useCallback(() => {
    const next = !moreOpen;
    setMoreOpenState(next);
    if (!onMoreOpenChange) {
      persistMoreOpen(next);
    }
  }, [moreOpen, onMoreOpenChange, persistMoreOpen, setMoreOpenState]);

  function NavButton({ item }: { item: NavItem }) {
    const Icon = item.icon;
    const isActive = item.id === activeId;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => { onSelect(item.id); }}
            aria-label={item.name}
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
                onClick={toggleMoreOpen}
                aria-label="更多"
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
