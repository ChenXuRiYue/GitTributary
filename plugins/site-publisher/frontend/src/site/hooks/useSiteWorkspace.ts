import { useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  buildCaptureTree,
  collectOpenNodePaths,
  filterKnownPaths,
  orderedCandidates,
} from "../capture";
import {
  buildPublishCandidates,
  defaultPublishDraft,
  isPublishCandidateUsable,
  makePublishTarget,
} from "../publish";
import {
  defaultTitleFromRepo,
  isRunRecordInProgress,
  parseSiteActiveRepoState,
  parseSiteBuildUiState,
  parseSiteWorkspaceConfigState,
  pathCollator,
  SITE_ACTIVE_REPO_KEY,
  SITE_STATE_NS,
  SITE_WORKSPACE_CONFIG_KEY,
  siteStateKey,
} from "../state";
import {
  isTauriRuntime,
  migrateLegacyPublishTargets,
  parseSiteViewUiState,
  SITE_VIEW_STATE_KEY,
  SITE_VIEW_STATE_NS,
  SITE_VIEW_STATE_TTL_MS,
  TAURI_UNAVAILABLE_MESSAGE,
  makeWorkspaceGroup,
} from "../sitePanelModel";
import type {
  CaptureViewMode,
  SiteActiveRepoState,
  SiteBuildConfig,
  SiteBuildUiState,
  SiteScanReport,
  SiteWorkspaceGroup,
  WorkspaceInfo,
} from "../types";
import { useSiteCoreState } from "./useSiteCoreState";

export function useSiteWorkspace(core: ReturnType<typeof useSiteCoreState>) {
  const {
    phase, setPhase, repoPath, setRepoPath, outputDir, setOutputDir,
    siteTitle, setSiteTitle, withSearch, setWithSearch, copyAssets, setCopyAssets,
    activeViewId, setActiveViewId, scanReport, setScanReport, selectedPaths, setSelectedPaths,
    captureViewMode, setCaptureViewMode, captureFilters, openCapturePaths,
    setOpenCapturePaths, setBuildReport, setPublishReport, remoteConfigs,
    workspaceGroups, setWorkspaceGroups, activeWorkspaceGroupId,
    setActiveWorkspaceGroupId, workspaceMenuOpen, setWorkspaceMenuOpen,
    setMessage, setError,
    hydratedRepoRef, defaultWorkspaceCreatedRef, workspaceRestoredRef,
    restoredWorkspaceGroupCountRef, workspaceMenuRef, loadRemoteConfigs,
    persistWorkspaceConfig, applyWorkspaceGroups, updateWorkspaceGroup,
  } = core;
  const selectedCount = selectedPaths.size;

  const buildConfig = useMemo<SiteBuildConfig>(() => ({
    repoPath: repoPath.trim(),
    outputDir: outputDir.trim(),
    siteTitle: siteTitle.trim(),
    include: scanReport
      ? orderedCandidates(scanReport.candidates).filter((item) => selectedPaths.has(item.path)).map((item) => item.path)
      : Array.from(selectedPaths).sort((a, b) => pathCollator.compare(a, b)),
    exclude: [],
    theme: "typora-light",
    withSearch,
    copyAssets,
  }), [copyAssets, outputDir, repoPath, scanReport, selectedPaths, siteTitle, withSearch]);

  const rawCaptureList = useMemo(() => orderedCandidates(scanReport?.candidates ?? []), [scanReport]);
  const filteredCaptureList = useMemo(() => {
    const query = captureFilters.query.trim().toLowerCase();
    const result = rawCaptureList.filter((candidate) => {
      if (captureFilters.kind !== "all" && candidate.kind !== captureFilters.kind) return false;
      if (captureFilters.selection === "selected" && !selectedPaths.has(candidate.path)) return false;
      if (captureFilters.selection === "unselected" && selectedPaths.has(candidate.path)) return false;
      if (captureFilters.defaultState === "default" && !candidate.selectedByDefault) return false;
      if (captureFilters.defaultState === "custom" && candidate.selectedByDefault) return false;
      if (candidate.markdownCount < captureFilters.minMarkdownCount) return false;
      if (!query) return true;
      return [
        candidate.path,
        candidate.kind,
        String(candidate.markdownCount),
        String(candidate.score),
        ...candidate.reason,
      ].join(" ").toLowerCase().includes(query);
    });

    return result.sort((a, b) => {
      switch (captureFilters.sort) {
        case "score-desc":
          return b.score - a.score || pathCollator.compare(a.path, b.path);
        case "markdown-desc":
          return b.markdownCount - a.markdownCount || pathCollator.compare(a.path, b.path);
        default:
          return pathCollator.compare(a.path, b.path);
      }
    });
  }, [captureFilters, rawCaptureList, selectedPaths]);
  const captureTree = useMemo(() => buildCaptureTree(filteredCaptureList), [filteredCaptureList]);
  const captureList = filteredCaptureList;
  const selectedCaptureList = useMemo(
    () => rawCaptureList.filter((candidate) => selectedPaths.has(candidate.path)),
    [rawCaptureList, selectedPaths],
  );
  const selectedCaptureTree = useMemo(() => buildCaptureTree(selectedCaptureList), [selectedCaptureList]);
  const selectedMarkdownCount = useMemo(
    () => selectedCaptureList.reduce((sum, candidate) => sum + candidate.markdownCount, 0),
    [selectedCaptureList],
  );
  const knownOpenPaths = useMemo(() => collectOpenNodePaths(captureTree), [captureTree]);
  const allCapturedSelected = captureList.length > 0 && captureList.every((item) => selectedPaths.has(item.path));
  const activeWorkspaceGroup = useMemo(
    () => workspaceGroups.find((group) => group.id === activeWorkspaceGroupId) ?? workspaceGroups[0] ?? null,
    [activeWorkspaceGroupId, workspaceGroups],
  );
  const savedTarget = activeWorkspaceGroup?.target ?? null;
  // 唯一的发布仓库候选来源：发布任务 (工作区组) 与执行工作台共用同一份，
  // 不再各自维护一套选择状态；也不再靠 repoPath 字符串反查当前任务——
  // activeWorkspaceGroupId 才是唯一真源。
  const activeBuildRunning = Boolean(activeWorkspaceGroup?.runHistory.some((record) => (
    record.kind === "build" && isRunRecordInProgress(record)
  )));
  const activePublishRunning = Boolean(activeWorkspaceGroup?.runHistory.some((record) => (
    record.kind === "publish" && isRunRecordInProgress(record)
  )));
  const activeTaskRunning = activeBuildRunning || activePublishRunning;
  const canBuild = Boolean(repoPath.trim() && outputDir.trim() && siteTitle.trim() && selectedCount > 0)
    && phase !== "scanning"
    && !activeTaskRunning;
  const canPublish = canBuild && Boolean(savedTarget);
  const publishCandidates = useMemo(
    () => buildPublishCandidates(remoteConfigs, activeWorkspaceGroup?.sourceRepoPath || repoPath, savedTarget?.targetRepoId),
    [activeWorkspaceGroup?.sourceRepoPath, remoteConfigs, repoPath, savedTarget?.targetRepoId],
  );
  const workspaceLabel = activeWorkspaceGroup?.name.trim() || (repoPath ? defaultTitleFromRepo(repoPath) : "未选择任务");
  const currentWorkspaceGroupId = activeWorkspaceGroup?.id ?? null;
  const workspacePathLabel = activeWorkspaceGroup?.sourceRepoPath.trim() || repoPath.trim();

  const persistActiveRepo = useCallback(async (path: string) => {
    if (!path.trim()) return;
    try {
      await invoke("store_set", {
        namespace: SITE_STATE_NS,
        key: SITE_ACTIVE_REPO_KEY,
        value: {
          version: 1,
          repoPath: path,
          updatedAt: Date.now(),
        } satisfies SiteActiveRepoState,
      });
    } catch {
      // UI state writes should not block site work.
    }
  }, []);

  const persistConfig = useCallback(async (
    config: SiteBuildConfig,
    uiState: {
      captureViewMode: CaptureViewMode;
      openPaths: string[];
    },
  ) => {
    if (!config.repoPath) return;
    try {
      await invoke("store_set", {
        namespace: SITE_STATE_NS,
        key: siteStateKey(config.repoPath),
        value: {
          version: 2,
          repoPath: config.repoPath,
          outputDir: config.outputDir,
          siteTitle: config.siteTitle,
          include: config.include,
          hasSelectionState: true,
          captureViewMode: uiState.captureViewMode,
          openPaths: uiState.openPaths,
          theme: config.theme,
          withSearch: config.withSearch,
          copyAssets: config.copyAssets,
          updatedAt: Date.now(),
        } satisfies SiteBuildUiState,
      });
    } catch {
      // UI state persistence should never block the builder.
    }
  }, []);

  const restoreConfig = useCallback(async (path: string, report?: SiteScanReport) => {
    try {
      const raw = await invoke<unknown>("store_get", {
        namespace: SITE_STATE_NS,
        key: siteStateKey(path),
      });
      const cached = parseSiteBuildUiState(raw);
      if (!cached) {
        setOutputDir(report?.defaultOutputDir || "");
        setSiteTitle(report?.repoName || defaultTitleFromRepo(path));
        return false;
      }
      setOutputDir(cached.outputDir || report?.defaultOutputDir || "");
      setSiteTitle(cached.siteTitle || report?.repoName || defaultTitleFromRepo(path));
      setWithSearch(cached.withSearch);
      setCopyAssets(cached.copyAssets);
      setCaptureViewMode(cached.captureViewMode);
      if (report) {
        const knownPaths = collectOpenNodePaths(buildCaptureTree(report.candidates));
        setOpenCapturePaths(new Set(cached.openPaths ? filterKnownPaths(cached.openPaths, knownPaths) : []));
      } else if (cached.openPaths) {
        setOpenCapturePaths(new Set(cached.openPaths));
      }
      return true;
    } catch {
      setOutputDir(report?.defaultOutputDir || "");
      setSiteTitle(report?.repoName || defaultTitleFromRepo(path));
      return false;
    }
  }, []);

  // 文档范围现在是当前发布任务 (activeWorkspaceGroup) 自带的字段
  // (documentScope)，不再靠 repoPath 反查另一个 key 恢复。扫描完成后统一
  // 用此函数把选中路径同步为「当前任务的 documentScope ∩ 本次扫描到的候选」；
  // 若当前任务尚无 documentScope (新任务/未迁移)，回退到候选的默认选中集合。
  const applyDocumentScope = useCallback((scope: string[] | undefined, report: SiteScanReport) => {
    const knownPaths = new Set(report.candidates.map((item) => item.path));
    if (scope && scope.length > 0) {
      setSelectedPaths(new Set(filterKnownPaths(scope, knownPaths)));
    } else {
      setSelectedPaths(new Set(orderedCandidates(report.candidates).filter((item) => item.selectedByDefault).map((item) => item.path)));
    }
  }, []);

  const scanRepo = useCallback(async (path: string, documentScope?: string[]) => {
    const cleanPath = path.trim();
    if (!cleanPath) return;
    setPhase("scanning");
    setError(null);
    setMessage(null);
    setBuildReport(null);
    setPublishReport(null);
    try {
      const report = await invoke<SiteScanReport>("site_scan", { repoPath: cleanPath });
      setScanReport(report);
      setRepoPath(report.repoPath);
      await restoreConfig(report.repoPath, report);
      applyDocumentScope(documentScope, report);
      setOpenCapturePaths(new Set());
      hydratedRepoRef.current = report.repoPath;
      void persistActiveRepo(report.repoPath);
      void loadRemoteConfigs();
      setPhase("ready");
    } catch (err) {
      setPhase("failed");
      setError(String(err));
    }
  }, [applyDocumentScope, loadRemoteConfigs, persistActiveRepo, restoreConfig]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setError(TAURI_UNAVAILABLE_MESSAGE);
      workspaceRestoredRef.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ws = await invoke<WorkspaceInfo>("get_workspace_info");
        if (cancelled) return;
        await loadRemoteConfigs();
        const rawActiveRepo = await invoke<unknown>("store_get", {
          namespace: SITE_STATE_NS,
          key: SITE_ACTIVE_REPO_KEY,
        });
        if (cancelled) return;
        const cachedActiveRepo = parseSiteActiveRepoState(rawActiveRepo);
        const rawWorkspaceConfig = await invoke<unknown>("store_get", {
          namespace: SITE_STATE_NS,
          key: SITE_WORKSPACE_CONFIG_KEY,
        });
        if (cancelled) return;
        const workspaceConfig = parseSiteWorkspaceConfigState(rawWorkspaceConfig);
        let restoredGroup: SiteWorkspaceGroup | null = null;
        if (workspaceConfig) {
          const migratedGroups = await migrateLegacyPublishTargets(workspaceConfig.groups);
          restoredWorkspaceGroupCountRef.current = migratedGroups.length;
          setWorkspaceGroups(migratedGroups);
          setActiveWorkspaceGroupId(workspaceConfig.activeGroupId);
          if (migratedGroups !== workspaceConfig.groups) {
            persistWorkspaceConfig(migratedGroups, workspaceConfig.activeGroupId);
          }
          restoredGroup = migratedGroups.find((group) => group.id === workspaceConfig.activeGroupId)
            ?? migratedGroups[0]
            ?? null;
        }
        // 标记「初始恢复已完成」，放在 setWorkspaceGroups 之后、且在下面触发
        // scanRepo 之前——避免 site_scan 提前返回时，"自动建默认任务" 的
        // effect 看到 workspaceGroups 还是初始的 [] 而抢先创建并覆盖刚恢复
        // 出来的任务列表 (这是一次真实发生过的竞态: 扫描比 store 读取更快时，
        // 重启后保存的任务列表会被一个新建的空任务覆盖，表现为"每次重启都
        // 拉取失败、重新创建任务")。
        workspaceRestoredRef.current = true;
        const nextRepo = restoredGroup?.sourceRepoPath || cachedActiveRepo?.repoPath || ws.active_repo;
        if (nextRepo) {
          setRepoPath(nextRepo);
          setSiteTitle(defaultTitleFromRepo(nextRepo));
          const scopeForRepo = restoredGroup?.sourceRepoPath.trim() === nextRepo.trim() ? restoredGroup?.documentScope : undefined;
          void scanRepo(nextRepo, scopeForRepo);
        }
      } catch (err) {
        // 之前这里是完全静默的 catch (仅注释假设"运行在浏览器预览或 Tauri
        // 尚未就绪")，会把恢复链路里任何一步的真实异常都吞掉、不留痕迹，
        // 表现为"发布任务列表持续为空"却查不出原因。现在显式记录并提示，
        // 便于下次复现时定位真正的失败点 (例如某个 invoke 参数不匹配、
        // 后端 command 报错等)。
        console.error("[SitePanel] 初始化发布任务列表失败:", err);
        setError(`加载发布任务列表失败: ${String(err)}`);
        workspaceRestoredRef.current = true;
      }
    })();
    return () => { cancelled = true; };
    // Run once per mount. In React StrictMode dev builds this effect is
    // intentionally mounted, cleaned up, and mounted again; the cancelled flag
    // lets the second run complete instead of permanently blocking init.
  }, [loadRemoteConfigs, persistWorkspaceConfig, scanRepo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await invoke<unknown>("store_get", {
          namespace: SITE_VIEW_STATE_NS,
          key: SITE_VIEW_STATE_KEY,
        });
        const cached = parseSiteViewUiState(raw);
        const fresh = cached && Date.now() - cached.updatedAt <= SITE_VIEW_STATE_TTL_MS;
        if (!cancelled && cached && fresh) {
          setActiveViewId(cached.activeViewId);
          return;
        }
        if (raw != null) {
          await invoke("store_delete", {
            namespace: SITE_VIEW_STATE_NS,
            key: SITE_VIEW_STATE_KEY,
          });
        }
      } catch {
        // No stored view yet, or running outside the Tauri shell.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Keep publish-repo candidates fresh whenever the workspace (task) view is
  // active, regardless of whether it was opened by a click or restored on
  // mount. This removes the need to manually hit "刷新远程配置".
  useEffect(() => {
    if (activeViewId === "workspace") {
      void loadRemoteConfigs();
    }
  }, [activeViewId, loadRemoteConfigs]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [workspaceMenuOpen]);

  useEffect(() => {
    if (!workspaceRestoredRef.current) return;
    const sourcePath = (scanReport?.repoPath || repoPath).trim();
    if (
      !sourcePath
      || workspaceGroups.length > 0
      || restoredWorkspaceGroupCountRef.current > 0
      || defaultWorkspaceCreatedRef.current
    ) return;
    defaultWorkspaceCreatedRef.current = true;
    const firstUsableCandidate = buildPublishCandidates(remoteConfigs, sourcePath, null)
      .find((candidate) => isPublishCandidateUsable(candidate));
    const target = firstUsableCandidate
      ? makePublishTarget(firstUsableCandidate, defaultPublishDraft(firstUsableCandidate))
      : null;
    const nextGroup = makeWorkspaceGroup(sourcePath, target);
    applyWorkspaceGroups([nextGroup], nextGroup.id);
  }, [applyWorkspaceGroups, remoteConfigs, repoPath, scanReport?.repoPath, workspaceGroups.length]);

  useEffect(() => {
    if (!scanReport || hydratedRepoRef.current !== scanReport.repoPath) return;
    const timeout = window.setTimeout(() => {
      void persistConfig(buildConfig, {
        captureViewMode,
        openPaths: Array.from(openCapturePaths).filter((path) => knownOpenPaths.has(path)).sort((a, b) => pathCollator.compare(a, b)),
      });
      void persistActiveRepo(scanReport.repoPath);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [buildConfig, captureViewMode, knownOpenPaths, openCapturePaths, persistActiveRepo, persistConfig, scanReport]);

  // 文档范围现在是「本地草稿 + 手动保存」模式: selectedPaths 是正在编辑的
  // 草稿，不再去抖自动写回 activeWorkspaceGroup.documentScope；只有调用
  // saveDocumentScope() 才会落盘。documentScopeDirty 标记草稿是否与已保存
  // 的 documentScope 不一致。
  const documentScopeDirty = useMemo(() => {
    if (!activeWorkspaceGroup) return false;
    if (!scanReport || activeWorkspaceGroup.sourceRepoPath.trim() !== scanReport.repoPath.trim()) return false;
    const saved = activeWorkspaceGroup.documentScope;
    const draft = Array.from(selectedPaths).sort((a, b) => pathCollator.compare(a, b));
    const savedSorted = [...saved].sort((a, b) => pathCollator.compare(a, b));
    if (saved.length !== draft.length) return true;
    return savedSorted.some((path, index) => path !== draft[index]);
  }, [activeWorkspaceGroup, scanReport, selectedPaths]);

  const saveDocumentScope = useCallback(() => {
    if (!activeWorkspaceGroupId) return;
    const nextScope = Array.from(selectedPaths).sort((a, b) => pathCollator.compare(a, b));
    updateWorkspaceGroup(activeWorkspaceGroupId, (group) => ({ ...group, documentScope: nextScope }));
    setMessage("已保存文档范围");
    setError(null);
  }, [activeWorkspaceGroupId, selectedPaths, updateWorkspaceGroup]);

  return {
    selectedCount, buildConfig, rawCaptureList, captureTree, captureList,
    selectedCaptureTree, selectedMarkdownCount, knownOpenPaths, allCapturedSelected,
    activeWorkspaceGroup, savedTarget, activeBuildRunning, activePublishRunning,
    activeTaskRunning, canBuild, canPublish, publishCandidates, workspaceLabel,
    currentWorkspaceGroupId, workspacePathLabel, persistActiveRepo, persistConfig,
    restoreConfig, applyDocumentScope, scanRepo, documentScopeDirty, saveDocumentScope,
  };
}
