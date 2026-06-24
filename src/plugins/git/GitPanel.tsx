import { useState } from "react";

import { gitViews } from "./registry";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Git 面板 Shell:
 * 左侧二级侧边栏(小图标,固定操作) + 右侧内容展示区(灵活视图)
 */
export function GitPanel() {
  const [activeId, setActiveId] = useState(gitViews[0]?.id ?? "");
  const active = gitViews.find((v) => v.id === activeId) ?? gitViews[0];
  const ActiveView = active?.panel;

  return (
    <div className="flex h-full gap-0">
      {/* 二级侧边栏:窄,纯图标 */}
      <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border/50 py-2">
        {gitViews.map((view) => {
          const Icon = view.icon;
          const isActive = view.id === active?.id;
          return (
            <Tooltip key={view.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setActiveId(view.id)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-all",
                    isActive
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {view.name}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* 内容展示区 */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {ActiveView && <ActiveView />}
        </div>
      </ScrollArea>
    </div>
  );
}
