import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  FolderTree,
  Plus,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { IconNav, type NavItem } from "@/components/IconNav";
import { DomainTrail, type DomainTrailItem } from "@/components/DomainTrail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { isPluginHostRuntime } from "../bridge";

import {
  buildCaptureTree,
  collectOpenNodePaths,
  filterKnownPaths,
  orderedCandidates,
} from "./capture";
import { BuildResultPanel } from "./components/BuildResultPanel";
import { CapturePanel } from "./components/CapturePanel";
import { WorkspaceConfigPanel } from "./components/WorkspaceConfigPanel";
import {
  defaultTitleFromRepo,
  legacySitePublishKey,
  parseLegacySitePublishTarget,
  parseSiteActiveRepoState,
  parseSiteBuildUiState,
  parseSiteWorkspaceConfigState,
  isRunRecordInProgress,
  pathCollator,
  shortPath,
  SITE_ACTIVE_REPO_KEY,
  SITE_STATE_NS,
  SITE_WORKSPACE_CONFIG_KEY,
  siteStateKey,
  upsertRunRecord,
} from "./state";
import {
  buildPublishCandidates,
  defaultPublishDraft,
  isPublishCandidateUsable,
  makePublishTarget,
} from "./publish";
import type {
  CaptureFilterState,
  CaptureViewMode,
  RemoteConfigEntry,
  SiteActiveRepoState,
  SiteBuildConfig,
  SiteBuildReport,
  SiteBuildUiState,
  SitePhase,
  SitePublishReport,
  SitePublishRequest,
  SitePublishTarget,
  SiteRunRecord,
  SiteScanReport,
  SiteWorkspaceConfigState,
  SiteWorkspaceGroup,
  WorkspaceInfo,
} from "./types";

type SiteViewId = "workspace" | "capture" | "result";

interface SiteViewUiState {
  version: 1;
  activeViewId: SiteViewId;
  updatedAt: number;
}

const SITE_VIEW_STATE_NS = "plugin.dev.gittributary.site-publisher.ui";
const SITE_VIEW_STATE_KEY = "site.view.active";
const SITE_MORE_STATE_KEY = "site.nav.more.open";
const SITE_VIEW_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const siteNavItems: NavItem[] = [
  { id: "workspace", name: "任务", icon: Settings2 },
  { id: "capture", name: "范围", icon: FolderTree },
  { id: "result", name: "执行", icon: CheckCircle2 },
];

const DEFAULT_CAPTURE_FILTERS: CaptureFilterState = {
  query: "",
  kind: "all",
  selection: "all",
  defaultState: "all",
  minMarkdownCount: 0,
  sort: "path",
};

const TAURI_UNAVAILABLE_MESSAGE = "当前页面运行在普通浏览器预览中，无法读取 Tauri 本地数据。请在 GitTributary 应用窗口中查看发布任务。";

function isTauriRuntime() {
  return isPluginHostRuntime() || (typeof window !== "undefined"
    && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__));
}

function isSiteViewId(value: string): value is SiteViewId {
  return siteNavItems.some((item) => item.id === value);
}

function parseSiteViewUiState(value: unknown): SiteViewUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as {
    version?: unknown;
    activeViewId?: unknown;
    updatedAt?: unknown;
  };
  if (state.version !== 1) return null;
  if (typeof state.activeViewId !== "string") return null;
  const rawActiveViewId = state.activeViewId;
  const activeViewId = rawActiveViewId === "config" ? "workspace" : rawActiveViewId;
  if (!isSiteViewId(activeViewId)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    activeViewId,
    updatedAt: state.updatedAt,
  };
}

function makeWorkspaceGroup(
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

/**
 * 一次性迁移: 发布参数曾以 `sites/publish.<sourceRepoHash>` 的独立记录存在,
 * 现已合并为 `SiteWorkspaceGroup.target`。为每个尚无 `target` 的发布任务,
 * 按其 `sourceRepoPath` 查找旧记录并合并进去，随后清理旧 key。
 * 已有 `target` 的发布任务保持不变，不会被旧记录覆盖。
 *
 * 同时迁移: 文档范围 (选中路径) 曾散落在按仓库路径 hash 命名的
 * `sites/build.<hash>` 记录里的 `include` 字段，现已合并为
 * `SiteWorkspaceGroup.documentScope`。为每个尚无 `documentScope` 的任务,
 * 按其 `sourceRepoPath` 查找旧记录的 `include` 并合并进去；旧 key 本身继续保留
 * (它还承载 outputDir/siteTitle 等尚未迁移的字段)，不做删除。
 */
async function migrateLegacyPublishTargets(
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
          void invoke("store_delete", { namespace: SITE_STATE_NS, key }).catch(() => {
            // Best-effort cleanup; a stale legacy key is harmless once migrated.
          });
        }
      } catch {
        // Leave the group untouched if the legacy record can't be read.
      }
    }

    if (next.documentScope.length === 0 && sourcePath) {
      try {
        const raw = await invoke<unknown>("store_get", { namespace: SITE_STATE_NS, key: siteStateKey(sourcePath) });
        const legacyBuildState = parseSiteBuildUiState(raw);
        if (legacyBuildState && legacyBuildState.hasSelectionState && legacyBuildState.include.length > 0) {
          changed = true;
          next = { ...next, documentScope: legacyBuildState.include, updatedAt: Date.now() };
        }
      } catch {
        // Leave documentScope empty if the legacy build-state record can't be read.
      }
    }

    return next;
  }));
  return changed ? migrated : groups;
}

export function SitePanel() {
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

  const scanRepo = useCallback(async (path = repoPath, documentScope?: string[]) => {
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
  }, [applyDocumentScope, loadRemoteConfigs, persistActiveRepo, repoPath, restoreConfig]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const toggleCandidate = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAllSelection = () => {
    if (!scanReport) return;
    const visiblePaths = captureList.map((item) => item.path);
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (allCapturedSelected) {
        visiblePaths.forEach((path) => next.delete(path));
      } else {
        visiblePaths.forEach((path) => next.add(path));
      }
      return next;
    });
  };

  const selectDefaults = () => {
    if (!scanReport) return;
    setSelectedPaths(new Set(orderedCandidates(scanReport.candidates).filter((item) => item.selectedByDefault).map((item) => item.path)));
  };

  const toggleCapturePathOpen = useCallback((path: string) => {
    setOpenCapturePaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const currentCaptureUiState = useCallback(() => ({
    captureViewMode,
    openPaths: Array.from(openCapturePaths)
      .filter((path) => knownOpenPaths.has(path))
      .sort((a, b) => pathCollator.compare(a, b)),
  }), [captureViewMode, knownOpenPaths, openCapturePaths]);

  const upsertWorkspaceRunRecord = useCallback((groupId: string, record: SiteRunRecord) => {
    updateWorkspaceGroup(groupId, (group) => ({
      ...group,
      runHistory: upsertRunRecord(group.runHistory, record),
    }));
  }, [updateWorkspaceGroup]);

  const makeRunRecord = (
    kind: SiteRunRecord["kind"],
    message: string,
  ): SiteRunRecord => {
    const startedAt = Date.now();
    return {
      id: `run.${startedAt.toString(36)}.${Math.random().toString(36).slice(2, 8)}`,
      kind,
      status: "running",
      message,
      startedAt,
      durationMs: 0,
    };
  };

  const runBuild = () => {
    if (!canBuild || !activeWorkspaceGroupId) return;
    const groupId = activeWorkspaceGroupId;
    if (runningWorkspaceGroupIdsRef.current.has(groupId)) return;
    runningWorkspaceGroupIdsRef.current.add(groupId);
    const configSnapshot = buildConfig;
    const uiStateSnapshot = currentCaptureUiState();
    const runningRecord = makeRunRecord("build", "构建已进入执行历史，后台运行中");
    setPhase("building");
    setError(null);
    setMessage("构建已进入执行历史，后台运行中");
    setBuildReport(null);
    setPublishReport(null);
    selectSiteView("result");
    upsertWorkspaceRunRecord(groupId, runningRecord);
    void persistConfig(configSnapshot, uiStateSnapshot);

    void (async () => {
      try {
        const report = await invoke<SiteBuildReport>("site_build", { config: configSnapshot });
        const summary = `生成 ${report.pageCount} 个页面,复制 ${report.assetCount} 个资源`;
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "succeeded",
          message: summary,
          finishedAt: Date.now(),
          durationMs: report.durationMs,
          pageCount: report.pageCount,
          assetCount: report.assetCount,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setBuildReport(report);
          setPublishReport(null);
          setPhase("succeeded");
          setMessage(summary);
        } else {
          setPhase((current) => current === "building" ? "ready" : current);
        }
      } catch (err) {
        const errorMessage = String(err);
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "failed",
          message: errorMessage,
          finishedAt: Date.now(),
          durationMs: Date.now() - runningRecord.startedAt,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setPhase("failed");
          setError(errorMessage);
        } else {
          setPhase((current) => current === "building" ? "ready" : current);
        }
      } finally {
        runningWorkspaceGroupIdsRef.current.delete(groupId);
      }
    })();
  };

  const runPublish = () => {
    if (!canPublish || !savedTarget || !activeWorkspaceGroupId) return;
    const groupId = activeWorkspaceGroupId;
    if (runningWorkspaceGroupIdsRef.current.has(groupId)) return;
    runningWorkspaceGroupIdsRef.current.add(groupId);
    const configSnapshot = buildConfig;
    const targetSnapshot = savedTarget;
    const uiStateSnapshot = currentCaptureUiState();
    const request: SitePublishRequest = {
      buildConfig: configSnapshot,
      target: {
        targetLocalPath: targetSnapshot.targetLocalPath,
        targetBranch: targetSnapshot.targetBranch,
        publishDir: targetSnapshot.publishDir,
        remoteName: targetSnapshot.remoteName || "origin",
        credentialRef: targetSnapshot.credentialRef ?? null,
        pagesUrl: targetSnapshot.pagesUrl,
        autoCommitMessage: targetSnapshot.autoCommitMessage,
      },
    };
    const runningRecord = makeRunRecord("publish", "发布已进入执行历史，后台执行构建、同步、提交和推送");
    setPhase("publishing");
    setError(null);
    setMessage("发布已进入执行历史，后台运行中");
    setBuildReport(null);
    setPublishReport(null);
    selectSiteView("result");
    upsertWorkspaceRunRecord(groupId, runningRecord);
    void persistConfig(configSnapshot, uiStateSnapshot);

    void (async () => {
      try {
        const report = await invoke<SitePublishReport>("site_publish_pages", { request });
        const summary = report.commit
          ? `已发布 ${report.build.pageCount} 个页面到 ${report.remoteName}/${report.branch}`
          : `站点无变更,已确认 ${report.remoteName}/${report.branch}`;
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "succeeded",
          message: summary,
          finishedAt: Date.now(),
          durationMs: report.durationMs,
          pageCount: report.build.pageCount,
          assetCount: report.build.assetCount,
          commit: report.commit,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setBuildReport(report.build);
          setPublishReport(report);
          setPhase("succeeded");
          setMessage(summary);
        } else {
          setPhase((current) => current === "publishing" ? "ready" : current);
        }
      } catch (err) {
        const errorMessage = String(err);
        upsertWorkspaceRunRecord(groupId, {
          ...runningRecord,
          status: "failed",
          message: errorMessage,
          finishedAt: Date.now(),
          durationMs: Date.now() - runningRecord.startedAt,
        });
        if (activeWorkspaceGroupIdRef.current === groupId) {
          setPhase("failed");
          setError(errorMessage);
        } else {
          setPhase((current) => current === "publishing" ? "ready" : current);
        }
      } finally {
        runningWorkspaceGroupIdsRef.current.delete(groupId);
      }
    })();
  };

  const selectWorkspaceGroup = (id: string) => {
    if (id !== activeWorkspaceGroupId && documentScopeDirty) {
      const confirmed = window.confirm("当前任务的文档范围还有未保存的改动，切换任务会丢弃这些改动。确定要切换吗？");
      if (!confirmed) return;
    }
    setActiveWorkspaceGroupId(id);
    persistWorkspaceConfig(workspaceGroups, id);
    const group = workspaceGroups.find((item) => item.id === id);
    const sourcePath = group?.sourceRepoPath.trim();
    if (sourcePath && sourcePath !== repoPath.trim()) {
      setRepoPath(sourcePath);
      setSiteTitle(defaultTitleFromRepo(sourcePath));
      void persistActiveRepo(sourcePath);
      void scanRepo(sourcePath, group?.documentScope);
    }
  };

  const createWorkspaceGroup = (activate = false) => {
    const firstConfiguredRepo = remoteConfigs.find((remote) => remote.repo_path?.trim())?.repo_path?.trim() ?? "";
    const sourcePath = repoPath.trim() && (
      remoteConfigs.some((remote) => remote.repo_path === repoPath)
        || remoteConfigs.length === 0
        || !firstConfiguredRepo
    )
      ? repoPath
      : firstConfiguredRepo;
    const firstReadyCandidate = buildPublishCandidates(remoteConfigs, sourcePath, null)
      .find((candidate) => isPublishCandidateUsable(candidate));
    const target = firstReadyCandidate
      ? makePublishTarget(firstReadyCandidate, defaultPublishDraft(firstReadyCandidate))
      : null;
    // 新任务复用当前已扫描的仓库时,把当前的文档范围一并带过去,避免用户
    // 明明已经勾选好范围、新建任务后却要重新勾选一遍。
    const cleanSourcePath = sourcePath.trim();
    const initialScope = cleanSourcePath && cleanSourcePath === repoPath.trim()
      ? Array.from(selectedPaths)
      : [];
    const nextGroup = makeWorkspaceGroup(sourcePath, target, undefined, initialScope);
    const nextActiveId = activate || !activeWorkspaceGroupId ? nextGroup.id : activeWorkspaceGroupId;
    applyWorkspaceGroups([...workspaceGroups, nextGroup], nextActiveId);
    if (nextActiveId === nextGroup.id && cleanSourcePath && cleanSourcePath !== repoPath.trim()) {
      setRepoPath(cleanSourcePath);
      setSiteTitle(defaultTitleFromRepo(cleanSourcePath));
      void persistActiveRepo(cleanSourcePath);
      void scanRepo(cleanSourcePath, nextGroup.documentScope);
    }
    setMessage(`已新建发布任务: ${nextGroup.name}`);
    setError(null);
    return nextGroup.id;
  };

  const deleteWorkspaceGroup = (id: string) => {
    const group = workspaceGroups.find((item) => item.id === id);
    const nextGroups = workspaceGroups.filter((item) => item.id !== id);
    const nextActiveId = activeWorkspaceGroupId === id
      ? nextGroups[0]?.id ?? null
      : activeWorkspaceGroupId;
    if (nextGroups.length === 0) {
      defaultWorkspaceCreatedRef.current = false;
    }
    applyWorkspaceGroups(nextGroups, nextActiveId);
    if (activeWorkspaceGroupId === id) {
      const nextActiveGroup = nextGroups.find((item) => item.id === nextActiveId) ?? null;
      const sourcePath = nextActiveGroup?.sourceRepoPath.trim();
      if (sourcePath && sourcePath !== repoPath.trim()) {
        setRepoPath(sourcePath);
        setSiteTitle(defaultTitleFromRepo(sourcePath));
        void persistActiveRepo(sourcePath);
        void scanRepo(sourcePath, nextActiveGroup?.documentScope);
      } else if (!nextActiveGroup) {
        setRepoPath("");
        setScanReport(null);
        setSelectedPaths(new Set());
      }
    }
    if (group) {
      setMessage(`已删除发布任务: ${group.name || "未命名任务"}`);
      setError(null);
    }
  };

  const applyWorkspaceGroup = async (group: SiteWorkspaceGroup) => {
    const sourcePath = group.sourceRepoPath.trim();
    if (!sourcePath) {
      setError("请先为发布任务选择源仓库。");
      return;
    }
    if (group.id !== activeWorkspaceGroupId && documentScopeDirty) {
      const confirmed = window.confirm("当前任务的文档范围还有未保存的改动，切换任务会丢弃这些改动。确定要切换吗？");
      if (!confirmed) return;
    }
    setActiveWorkspaceGroupId(group.id);
    persistWorkspaceConfig(workspaceGroups, group.id);
    setRepoPath(sourcePath);
    setSiteTitle(defaultTitleFromRepo(sourcePath));
    void persistActiveRepo(sourcePath);
    void scanRepo(sourcePath, group.documentScope);
    setMessage(`已应用发布任务: ${group.name || defaultTitleFromRepo(sourcePath)}`);
    setError(null);
  };

  const selectWorkspaceFromMenu = (group: SiteWorkspaceGroup) => {
    setWorkspaceMenuOpen(false);
    const sourcePath = group.sourceRepoPath.trim();
    if (!sourcePath) {
      selectWorkspaceGroup(group.id);
      selectSiteView("workspace");
      setError("请先为发布任务选择源仓库。");
      return;
    }
    void applyWorkspaceGroup(group);
  };

  const openIndex = async () => {
    if (!buildReport?.indexHtml) return;
    try {
      await openPath(buildReport.indexHtml);
    } catch {
      await invoke("site_open_output", { path: buildReport.indexHtml });
    }
  };

  const revealOutput = async () => {
    const path = buildReport?.indexHtml || outputDir;
    if (!path) return;
    try {
      await revealItemInDir(path);
    } catch {
      await openPath(buildReport?.outputDir || outputDir);
    }
  };

  const workspacePanel = (
    <WorkspaceConfigPanel
      groups={workspaceGroups}
      activeGroupId={activeWorkspaceGroupId}
      remoteConfigs={remoteConfigs}
      publishCandidates={publishCandidates}
      onCreateGroup={createWorkspaceGroup}
      onSelectGroup={selectWorkspaceGroup}
      onUpdateGroup={updateWorkspaceGroup}
      onDeleteGroup={deleteWorkspaceGroup}
      onRefreshRemoteConfigs={loadRemoteConfigs}
    />
  );

  const capturePanel = (
    <CapturePanel
      scanReport={scanReport}
      captureTree={captureTree}
      selectedCaptureTree={selectedCaptureTree}
      captureList={captureList}
      captureViewMode={captureViewMode}
      filters={captureFilters}
      totalCount={rawCaptureList.length}
      filteredCount={captureList.length}
      selectedPaths={selectedPaths}
      openCapturePaths={openCapturePaths}
      selectedCount={selectedCount}
      selectedMarkdownCount={selectedMarkdownCount}
      allCapturedSelected={allCapturedSelected}
      dirty={documentScopeDirty}
      onSave={saveDocumentScope}
      onViewModeChange={setCaptureViewMode}
      onFiltersChange={setCaptureFilters}
      onSelectDefaults={selectDefaults}
      onToggleAll={toggleAllSelection}
      onToggleOpen={toggleCapturePathOpen}
      onToggleCandidate={toggleCandidate}
      onToggleGroup={(paths) => {
        setSelectedPaths((current) => {
          const next = new Set(current);
          const allSelected = paths.every((path) => next.has(path));
          paths.forEach((path) => {
            if (allSelected) next.delete(path);
            else next.add(path);
          });
          return next;
        });
      }}
    />
  );

  const resultPanel = (
    <BuildResultPanel
      task={activeWorkspaceGroup}
      hasSourceRepo={Boolean(activeWorkspaceGroup?.sourceRepoPath.trim())}
      hasDocumentScope={selectedCount > 0}
      canBuild={canBuild}
      isBuilding={activeBuildRunning}
      canPublish={canPublish}
      isPublishing={activePublishRunning}
      buildReport={buildReport}
      publishReport={publishReport}
      onBuild={runBuild}
      onPublish={runPublish}
      onOpenIndex={openIndex}
      onRevealOutput={revealOutput}
      onEditTask={() => selectSiteView("workspace")}
      onEditScope={() => selectSiteView("capture")}
    />
  );

  const activePanel = (() => {
    switch (activeViewId) {
      case "workspace": return workspacePanel;
      case "capture": return capturePanel;
      case "result": return resultPanel;
      default: return workspacePanel;
    }
  })();

  const useFullCanvas = activeViewId === "workspace" || activeViewId === "capture" || activeViewId === "result";
  const activeDomainView = siteNavItems.find((item) => item.id === activeViewId) ?? siteNavItems[0];
  const domainTrailItems: DomainTrailItem[] = [
    { id: "site", label: "发布" },
    {
      id: activeDomainView.id,
      label: activeDomainView.name,
    },
  ];
  const configuredWorkspaceCount = workspaceGroups.filter((group) => (
    Boolean(group.sourceRepoPath.trim()) && Boolean(group.target)
  )).length;
  const primaryDomainStats = `任务:${workspaceGroups.length} 已配:${configuredWorkspaceCount}`;
  const secondaryDomainStats = (() => {
    switch (activeViewId) {
      case "workspace":
        return `已配:${configuredWorkspaceCount}/${workspaceGroups.length}`;
      case "capture":
        return `候选:${rawCaptureList.length} 已选:${selectedCount} md:${selectedMarkdownCount}`;
      case "result":
        if (activeTaskRunning) {
          const runningCount = activeWorkspaceGroup?.runHistory.filter(isRunRecordInProgress).length ?? 0;
          return `运行中:${runningCount} 记录:${activeWorkspaceGroup?.runHistory.length ?? 0}`;
        }
        if (publishReport) return `页面:${publishReport.build.pageCount} 变更:${publishReport.changedCount}`;
        if (buildReport) return `页面:${buildReport.pageCount} 资源:${buildReport.assetCount}`;
        return `记录:${activeWorkspaceGroup?.runHistory.length ?? 0}`;
      default:
        return "-";
    }
  })();
  const headerStats = [secondaryDomainStats, primaryDomainStats];

  const statusBanner = (message || error) ? (
    <div className={cn(
      "flex items-start gap-3 border-b px-5 py-3",
      error ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-primary/15 bg-primary/5",
    )}>
      {error ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" />}
      <div className="gt-body">{error || message}</div>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DomainTrail items={domainTrailItems} />
          <span className="shrink-0 text-muted-foreground/60 gt-body">/</span>
          <div ref={workspaceMenuRef} className="relative min-w-0 shrink">
            <button
              type="button"
              className="flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label={`切换发布任务: ${workspaceLabel}`}
              aria-haspopup="menu"
              aria-expanded={workspaceMenuOpen}
              onClick={() => setWorkspaceMenuOpen((open) => !open)}
              title={workspaceLabel}
            >
              <span className="min-w-0 truncate gt-body">{workspaceLabel}</span>
              <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", workspaceMenuOpen && "rotate-180")} />
            </button>

            {workspaceMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg sm:w-80"
              >
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="gt-body-strong truncate">{workspaceLabel}</div>
                    <div className="gt-caption truncate text-muted-foreground">
                      {workspacePathLabel ? shortPath(workspacePathLabel) : "未绑定源仓库"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      selectSiteView("workspace");
                    }}
                  >
                    <Settings2 className="size-3.5" />
                    设置
                  </Button>
                </div>

                <div className="max-h-72 overflow-y-auto p-1">
                  {workspaceGroups.length === 0 ? (
                    <div className="px-3 py-6 text-center">
                      <Settings2 className="mx-auto size-6 text-muted-foreground" />
                      <div className="gt-body-strong mt-2">暂无发布任务</div>
                      <p className="gt-caption mt-1 text-muted-foreground">先新建一个发布任务。</p>
                    </div>
                  ) : (
                    workspaceGroups.map((group) => {
                      const isCurrent = group.id === currentWorkspaceGroupId;
                      const sourcePath = group.sourceRepoPath.trim();
                      return (
                        <button
                          key={group.id}
                          type="button"
                          role="menuitem"
                          className={cn(
                            "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                            isCurrent ? "bg-primary/8 text-foreground" : "hover:bg-accent hover:text-accent-foreground",
                          )}
                          onClick={() => selectWorkspaceFromMenu(group)}
                        >
                          <span className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md border",
                            isCurrent ? "border-primary/30 bg-primary/10 text-primary" : "bg-background text-muted-foreground",
                          )}>
                            {isCurrent ? <Check className="size-3.5" /> : <FolderTree className="size-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="gt-body-strong block truncate">{group.name || "未命名任务"}</span>
                            <span className="gt-caption block truncate text-muted-foreground">
                              {sourcePath ? shortPath(sourcePath) : "未绑定源仓库"}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-2 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      createWorkspaceGroup(true);
                      selectSiteView("workspace");
                    }}
                  >
                    <Plus className="size-3.5" />
                    新建任务
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={activeViewId === "workspace" ? "secondary" : "outline"}
                    className="h-8 px-2"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      selectSiteView("workspace");
                    }}
                  >
                    <Settings2 className="size-3.5" />
                    任务设置
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 text-right md:flex">
          {headerStats.map((stat, index) => (
            <div key={`${index}.${stat}`} className="flex items-center gap-2">
              {index > 0 && <span className="text-muted-foreground/40 gt-caption">/</span>}
              <span className="text-foreground gt-caption font-medium">{stat}</span>
            </div>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
          <IconNav
            items={siteNavItems}
            activeId={activeViewId}
            onSelect={(id) => {
              if (isSiteViewId(id)) selectSiteView(id);
            }}
            size="sm"
            moreStateKey={SITE_MORE_STATE_KEY}
          />
        </div>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {useFullCanvas ? (
            <>
              {statusBanner}
              <div className="min-h-0 flex-1 overflow-hidden">
                {activePanel}
              </div>
            </>
          ) : (
            <ScrollArea className="w-full flex-1">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-7 py-6">
                {statusBanner}
                {activePanel}
              </div>
            </ScrollArea>
          )}
        </main>
      </div>
    </div>
  );
}
