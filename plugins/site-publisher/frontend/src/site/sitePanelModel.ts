import { CheckCircle2, FolderTree, Settings2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import type { NavItem } from "@/shared/components/IconNav";
import { isPluginHostRuntime } from "../bridge";
import {
  defaultTitleFromRepo,
  legacySitePublishKey,
  parseLegacySitePublishTarget,
  parseSiteBuildUiState,
  SITE_STATE_NS,
  siteStateKey,
} from "./state";
import type {
  CaptureFilterState,
  SitePublishTarget,
  SiteWorkspaceGroup,
} from "./types";

export type SiteViewId = "workspace" | "capture" | "result";

export interface SiteViewUiState {
  version: 1;
  activeViewId: SiteViewId;
  updatedAt: number;
}

export const SITE_VIEW_STATE_NS = "plugin.dev.noteaura.site-publisher.ui";
export const SITE_VIEW_STATE_KEY = "site.view.active";
export const SITE_MORE_STATE_KEY = "site.nav.more.open";
export const SITE_VIEW_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const siteNavItems: NavItem[] = [
  { id: "workspace", name: "任务", icon: Settings2 },
  { id: "capture", name: "范围", icon: FolderTree },
  { id: "result", name: "执行", icon: CheckCircle2 },
];

export const DEFAULT_CAPTURE_FILTERS: CaptureFilterState = {
  query: "",
  kind: "all",
  selection: "all",
  defaultState: "all",
  minMarkdownCount: 0,
  sort: "path",
};

export const TAURI_UNAVAILABLE_MESSAGE = "当前页面运行在普通浏览器预览中，无法读取 Tauri 本地数据。请在 Note Aura 应用窗口中查看发布任务。";

export function isTauriRuntime() {
  return isPluginHostRuntime() || (typeof window !== "undefined"
    && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__));
}

export function isSiteViewId(value: string): value is SiteViewId {
  return siteNavItems.some((item) => item.id === value);
}

export function parseSiteViewUiState(value: unknown): SiteViewUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as { version?: unknown; activeViewId?: unknown; updatedAt?: unknown };
  if (state.version !== 1 || typeof state.activeViewId !== "string") return null;
  const rawActiveViewId = state.activeViewId;
  const activeViewId = rawActiveViewId === "config" ? "workspace" : rawActiveViewId;
  if (!isSiteViewId(activeViewId)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return { version: 1, activeViewId, updatedAt: state.updatedAt };
}

export function makeWorkspaceGroup(
  sourceRepoPath: string,
  target: SitePublishTarget | null = null,
  name?: string,
  documentScope: string[] = [],
): SiteWorkspaceGroup {
  const cleanPath = sourceRepoPath.trim();
  const fallbackName = cleanPath ? defaultTitleFromRepo(cleanPath) : "新建任务";
  return {
    id: `workspace.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`,
    name: name ?? fallbackName,
    sourceRepoPath: cleanPath,
    documentScope,
    target,
    env: [],
    runHistory: [],
    updatedAt: Date.now(),
  };
}

export async function migrateLegacyPublishTargets(
  groups: SiteWorkspaceGroup[],
): Promise<SiteWorkspaceGroup[]> {
  let changed = false;
  const migrated = await Promise.all(groups.map(async (group) => {
    let next = group;
    const sourcePath = group.sourceRepoPath.trim();
    if (!next.target && sourcePath) {
      try {
        const key = legacySitePublishKey(sourcePath);
        const raw = await invoke<unknown>("store_get", { namespace: SITE_STATE_NS, key });
        const legacyTarget = parseLegacySitePublishTarget(raw);
        if (legacyTarget) {
          changed = true;
          next = { ...next, target: legacyTarget, updatedAt: Date.now() };
          void invoke("store_delete", { namespace: SITE_STATE_NS, key }).catch(() => undefined);
        }
      } catch {
        // Keep the current group when the legacy record is unavailable.
      }
    }
    if (next.documentScope.length === 0 && sourcePath) {
      try {
        const raw = await invoke<unknown>("store_get", {
          namespace: SITE_STATE_NS,
          key: siteStateKey(sourcePath),
        });
        const legacyBuildState = parseSiteBuildUiState(raw);
        if (legacyBuildState?.hasSelectionState && legacyBuildState.include.length > 0) {
          changed = true;
          next = { ...next, documentScope: legacyBuildState.include, updatedAt: Date.now() };
        }
      } catch {
        // Keep the current scope when the legacy record is unavailable.
      }
    }
    return next;
  }));
  return changed ? migrated : groups;
}
