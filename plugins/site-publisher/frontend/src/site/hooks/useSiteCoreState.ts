import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  SITE_STATE_NS,
  SITE_WORKSPACE_CONFIG_KEY,
} from "../state";
import {
  DEFAULT_CAPTURE_FILTERS,
  SITE_VIEW_STATE_KEY,
  SITE_VIEW_STATE_NS,
  type SiteViewId,
  type SiteViewUiState,
} from "../sitePanelModel";
import type {
  CaptureFilterState,
  CaptureViewMode,
  RemoteConfigEntry,
  SiteBuildReport,
  SitePhase,
  SitePublishReport,
  SiteScanReport,
  SiteWorkspaceConfigState,
  SiteWorkspaceGroup,
} from "../types";

export function useSiteCoreState() {
  const [activeViewId, setActiveViewId] = useState<SiteViewId>("workspace");
  const [phase, setPhase] = useState<SitePhase>("idle");
  const [repoPath, setRepoPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [siteTitle, setSiteTitle] = useState("");
  const [withSearch, setWithSearch] = useState(true);
  const [copyAssets, setCopyAssets] = useState(true);
  const [scanReport, setScanReport] = useState<SiteScanReport | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [captureViewMode, setCaptureViewMode] = useState<CaptureViewMode>("tree");
  const [captureFilters, setCaptureFilters] = useState<CaptureFilterState>(DEFAULT_CAPTURE_FILTERS);
  const [openCapturePaths, setOpenCapturePaths] = useState<Set<string>>(new Set());
  const [buildReport, setBuildReport] = useState<SiteBuildReport | null>(null);
  const [remoteConfigs, setRemoteConfigs] = useState<RemoteConfigEntry[]>([]);
  const [publishReport, setPublishReport] = useState<SitePublishReport | null>(null);
  const [workspaceGroups, setWorkspaceGroups] = useState<SiteWorkspaceGroup[]>([]);
  const [activeWorkspaceGroupId, setActiveWorkspaceGroupId] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeWorkspaceGroupIdRef = useRef<string | null>(null);
  const runningWorkspaceGroupIdsRef = useRef<Set<string>>(new Set());
  const hydratedRepoRef = useRef<string | null>(null);
  const defaultWorkspaceCreatedRef = useRef(false);
  const workspaceRestoredRef = useRef(false);
  const restoredWorkspaceGroupCountRef = useRef(0);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeWorkspaceGroupIdRef.current = activeWorkspaceGroupId;
  }, [activeWorkspaceGroupId]);

  const loadRemoteConfigs = useCallback(async () => {
    try {
      const configs = await invoke<RemoteConfigEntry[]>("get_remote_configs");
      setRemoteConfigs(configs);
    } catch {
      setRemoteConfigs([]);
    }
  }, []);

  const selectSiteView = useCallback((id: SiteViewId) => {
    setActiveViewId(id);
    void invoke("store_set", {
      namespace: SITE_VIEW_STATE_NS,
      key: SITE_VIEW_STATE_KEY,
      value: {
        version: 1,
        activeViewId: id,
        updatedAt: Date.now(),
      } satisfies SiteViewUiState,
    }).catch(() => {
      // View switching should remain local if the store is unavailable.
    });
  }, []);

  const persistWorkspaceConfig = useCallback((
    groups: SiteWorkspaceGroup[],
    activeGroupId: string | null,
  ) => {
    const normalizedActiveId = activeGroupId && groups.some((group) => group.id === activeGroupId)
      ? activeGroupId
      : groups[0]?.id ?? null;
    void invoke("store_set", {
      namespace: SITE_STATE_NS,
      key: SITE_WORKSPACE_CONFIG_KEY,
      value: {
        version: 1,
        groups,
        activeGroupId: normalizedActiveId,
        updatedAt: Date.now(),
      } satisfies SiteWorkspaceConfigState,
    }).catch(() => {
      // Workspace configuration stays editable even before persistence is ready.
    });
  }, []);

  const applyWorkspaceGroups = useCallback((
    groups: SiteWorkspaceGroup[],
    activeGroupId: string | null,
  ) => {
    const normalizedActiveId = activeGroupId && groups.some((group) => group.id === activeGroupId)
      ? activeGroupId
      : groups[0]?.id ?? null;
    restoredWorkspaceGroupCountRef.current = groups.length;
    setWorkspaceGroups(groups);
    setActiveWorkspaceGroupId(normalizedActiveId);
    persistWorkspaceConfig(groups, normalizedActiveId);
  }, [persistWorkspaceConfig]);

  const updateWorkspaceGroup = useCallback((
    id: string,
    updater: (group: SiteWorkspaceGroup) => SiteWorkspaceGroup,
  ) => {
    setWorkspaceGroups((current) => {
      const next = current.map((group) => {
        if (group.id !== id) return group;
        return {
          ...updater(group),
          updatedAt: Date.now(),
        };
      });
      const currentActiveId = activeWorkspaceGroupIdRef.current;
      const nextActiveId = currentActiveId && next.some((group) => group.id === currentActiveId)
        ? currentActiveId
        : next[0]?.id ?? null;
      persistWorkspaceConfig(next, nextActiveId);
      return next;
    });
  }, [persistWorkspaceConfig]);

  return {
    activeViewId, setActiveViewId, phase, setPhase, repoPath, setRepoPath,
    outputDir, setOutputDir, siteTitle, setSiteTitle, withSearch, setWithSearch,
    copyAssets, setCopyAssets, scanReport, setScanReport, selectedPaths, setSelectedPaths,
    captureViewMode, setCaptureViewMode, captureFilters, setCaptureFilters,
    openCapturePaths, setOpenCapturePaths, buildReport, setBuildReport,
    remoteConfigs, setRemoteConfigs, publishReport, setPublishReport,
    workspaceGroups, setWorkspaceGroups, activeWorkspaceGroupId, setActiveWorkspaceGroupId,
    workspaceMenuOpen, setWorkspaceMenuOpen, message, setMessage, error, setError,
    activeWorkspaceGroupIdRef, runningWorkspaceGroupIdsRef, hydratedRepoRef,
    defaultWorkspaceCreatedRef, workspaceRestoredRef, restoredWorkspaceGroupCountRef,
    workspaceMenuRef, loadRemoteConfigs, selectSiteView, persistWorkspaceConfig,
    applyWorkspaceGroups, updateWorkspaceGroup,
  };
}
