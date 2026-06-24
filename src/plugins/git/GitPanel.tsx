import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { gitViews } from "./registry";
import { IconNav, type NavItem } from "@/components/IconNav";

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

/**
 * Git 面板 Shell:
 * 左侧二级侧边栏(IconNav 复用) + 右侧内容展示区
 */
export function GitPanel() {
  const [activeId, setActiveId] = useState(gitViews[0]?.id ?? "");
  const active = gitViews.find((v) => v.id === activeId) ?? gitViews[0];
  const ActiveView = active?.panel;

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

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
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
        {ActiveView && <ActiveView />}
      </div>
    </div>
  );
}
