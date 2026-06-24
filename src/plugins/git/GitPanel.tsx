import { useState } from "react";

import { gitViews } from "./registry";
import { IconNav, type NavItem } from "@/components/IconNav";

/** 将 GitViewDescriptor 转换为通用 NavItem */
const navItems: NavItem[] = gitViews.map((v) => ({
  id: v.id,
  name: v.name,
  icon: v.icon,
  pinned: v.pinned,
}));

/**
 * Git 面板 Shell:
 * 左侧二级侧边栏(IconNav 复用) + 右侧内容展示区
 */
export function GitPanel() {
  const [activeId, setActiveId] = useState(gitViews[0]?.id ?? "");
  const active = gitViews.find((v) => v.id === activeId) ?? gitViews[0];
  const ActiveView = active?.panel;

  return (
    <div className="flex h-full overflow-hidden">
      {/* 二级侧边栏 */}
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
        <IconNav items={navItems} activeId={activeId} onSelect={setActiveId} size="sm" />
      </div>

      {/* 内容展示区 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {ActiveView && <ActiveView />}
      </div>
    </div>
  );
}
