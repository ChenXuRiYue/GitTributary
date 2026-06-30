import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileCode,
  Loader2,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import {
  buildCaptureTree,
  collectOpenNodePaths,
  filterKnownPaths,
  flattenCaptureTree,
  orderedCandidates,
} from "./capture";
import { BuildResultPanel } from "./components/BuildResultPanel";
import { CapturePanel } from "./components/CapturePanel";
import { PublishTargetPanel } from "./components/PublishTargetPanel";
import { SiteConfigSidebar } from "./components/SiteConfigSidebar";
import {
  defaultTitleFromRepo,
  parseSiteActiveRepoState,
  parseSiteBuildUiState,
  parseSitePublishTargetState,
  pathCollator,
  SITE_ACTIVE_REPO_KEY,
  SITE_STATE_NS,
  sitePublishKey,
  siteStateKey,
} from "./state";
import {
  buildPublishCandidates,
  defaultPublishDraft,
  draftFromTarget,
  inferPagesUrl,
  makePublishTarget,
} from "./publish";
import type {
  CaptureViewMode,
  PublishRepoCandidate,
  RemoteConfigEntry,
  SiteActiveRepoState,
  SiteBuildConfig,
  SiteBuildReport,
  SiteBuildUiState,
  SitePhase,
  SitePublishDraft,
  SitePublishTargetState,
  SiteScanReport,
  WorkspaceInfo,
} from "./types";

function phaseText(phase: SitePhase) {
  switch (phase) {
    case "scanning": return "扫描中";
    case "ready": return "待构建";
    case "building": return "构建中";
    case "succeeded": return "已完成";
    case "failed": return "失败";
    default: return "待开始";
  }
}

export function SitePanel() {
  const [phase, setPhase] = useState<SitePhase>("idle");
  const [repoPath, setRepoPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [siteTitle, setSiteTitle] = useState("");
  const [withSearch, setWithSearch] = useState(true);
  const [copyAssets, setCopyAssets] = useState(true);
  const [scanReport, setScanReport] = useState<SiteScanReport | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [captureViewMode, setCaptureViewMode] = useState<CaptureViewMode>("tree");
  const [openCapturePaths, setOpenCapturePaths] = useState<Set<string>>(new Set());
  const [buildReport, setBuildReport] = useState<SiteBuildReport | null>(null);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [remoteConfigs, setRemoteConfigs] = useState<RemoteConfigEntry[]>([]);
  const [publishTarget, setPublishTarget] = useState<SitePublishTargetState | null>(null);
  const [selectedPublishCandidateId, setSelectedPublishCandidateId] = useState("");
  const [publishDraft, setPublishDraft] = useState<SitePublishDraft>(() => defaultPublishDraft(null));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialScanRef = useRef(false);
  const hydratedRepoRef = useRef<string | null>(null);

  const selectedCount = selectedPaths.size;
  const canScan = Boolean(repoPath.trim()) && phase !== "scanning" && phase !== "building";
  const canBuild = Boolean(repoPath.trim() && outputDir.trim() && siteTitle.trim() && selectedCount > 0) && phase !== "building" && phase !== "scanning";

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

  const captureTree = useMemo(() => buildCaptureTree(scanReport?.candidates ?? []), [scanReport]);
  const captureList = useMemo(() => flattenCaptureTree(captureTree), [captureTree]);
  const knownOpenPaths = useMemo(() => collectOpenNodePaths(captureTree), [captureTree]);
  const allCapturedSelected = captureList.length > 0 && captureList.every((item) => selectedPaths.has(item.path));
  const publishCandidates = useMemo(
    () => buildPublishCandidates(remoteConfigs, repoPath, publishTarget?.targetRepoId),
    [publishTarget?.targetRepoId, remoteConfigs, repoPath],
  );

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

  const loadRemoteConfigs = useCallback(async () => {
    try {
      const configs = await invoke<RemoteConfigEntry[]>("get_remote_configs");
      setRemoteConfigs(configs);
    } catch {
      setRemoteConfigs([]);
    }
  }, []);

  const restorePublishTarget = useCallback(async (path: string) => {
    try {
      const raw = await invoke<unknown>("store_get", {
        namespace: SITE_STATE_NS,
        key: sitePublishKey(path),
      });
      const cached = parseSitePublishTargetState(raw);
      setPublishTarget(cached);
      setSelectedPublishCandidateId(cached?.targetRepoId ?? "");
      setPublishDraft(draftFromTarget(cached));
      return cached;
    } catch {
      setPublishTarget(null);
      setSelectedPublishCandidateId("");
      setPublishDraft(defaultPublishDraft(null));
      return null;
    }
  }, []);

  const restoreConfig = useCallback(async (path: string, report?: SiteScanReport) => {
    try {
      const raw = await invoke<unknown>("store_get", {
        namespace: SITE_STATE_NS,
        key: siteStateKey(path),
      });
      const cached = parseSiteBuildUiState(raw);
      if (!cached) return false;
      setOutputDir(cached.outputDir || report?.defaultOutputDir || "");
      setSiteTitle(cached.siteTitle || report?.repoName || defaultTitleFromRepo(path));
      setWithSearch(cached.withSearch);
      setCopyAssets(cached.copyAssets);
      setCaptureViewMode(cached.captureViewMode);
      if (cached.hasSelectionState) {
        const knownPaths = report ? new Set(report.candidates.map((item) => item.path)) : null;
        setSelectedPaths(new Set(knownPaths ? filterKnownPaths(cached.include, knownPaths) : cached.include));
      }
      if (report) {
        const knownPaths = collectOpenNodePaths(buildCaptureTree(report.candidates));
        setOpenCapturePaths(new Set(cached.openPaths ? filterKnownPaths(cached.openPaths, knownPaths) : []));
      } else if (cached.openPaths) {
        setOpenCapturePaths(new Set(cached.openPaths));
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const scanRepo = useCallback(async (path = repoPath) => {
    const cleanPath = path.trim();
    if (!cleanPath) return;
    setPhase("scanning");
    setError(null);
    setMessage(null);
    setBuildReport(null);
    try {
      const report = await invoke<SiteScanReport>("site_scan", { repoPath: cleanPath });
      setScanReport(report);
      setRepoPath(report.repoPath);
      const restored = await restoreConfig(report.repoPath, report);
      if (!restored) {
        setOutputDir(report.defaultOutputDir);
        setSiteTitle(report.repoName || defaultTitleFromRepo(report.repoPath));
        setSelectedPaths(new Set(orderedCandidates(report.candidates).filter((item) => item.selectedByDefault).map((item) => item.path)));
        setOpenCapturePaths(new Set());
      }
      await restorePublishTarget(report.repoPath);
      hydratedRepoRef.current = report.repoPath;
      void persistActiveRepo(report.repoPath);
      void loadRemoteConfigs();
      setPhase("ready");
      setMessage(`捕捉到 ${report.markdownCount} 个 Markdown 文件`);
    } catch (err) {
      setPhase("failed");
      setError(String(err));
    }
  }, [loadRemoteConfigs, persistActiveRepo, repoPath, restoreConfig, restorePublishTarget]);

  useEffect(() => {
    if (initialScanRef.current) return;
    initialScanRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const ws = await invoke<WorkspaceInfo>("get_workspace_info");
        if (cancelled) return;
        setRecentRepos(ws.recent_repos ?? []);
        await loadRemoteConfigs();
        const rawActiveRepo = await invoke<unknown>("store_get", {
          namespace: SITE_STATE_NS,
          key: SITE_ACTIVE_REPO_KEY,
        });
        if (cancelled) return;
        const cachedActiveRepo = parseSiteActiveRepoState(rawActiveRepo);
        const nextRepo = cachedActiveRepo?.repoPath || ws.active_repo;
        if (nextRepo) {
          setRepoPath(nextRepo);
          setSiteTitle(defaultTitleFromRepo(nextRepo));
          void scanRepo(nextRepo);
        }
      } catch {
        // Running in browser preview or before Tauri is ready.
      }
    })();
    return () => { cancelled = true; };
  }, [loadRemoteConfigs, scanRepo]);

  useEffect(() => {
    if (selectedPublishCandidateId) return;
    const firstReady = publishCandidates.find((candidate) => candidate.status === "ready");
    if (firstReady) {
      setSelectedPublishCandidateId(firstReady.id);
      setPublishDraft(defaultPublishDraft(firstReady));
    }
  }, [publishCandidates, selectedPublishCandidateId]);

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

  const chooseRepo = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    setRepoPath(selected);
    setSiteTitle(defaultTitleFromRepo(selected));
    void persistActiveRepo(selected);
    void scanRepo(selected);
  };

  const chooseOutput = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setOutputDir(selected);
  };

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
    if (allCapturedSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(captureList.map((item) => item.path)));
    }
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

  const runBuild = async () => {
    if (!canBuild) return;
    setPhase("building");
    setError(null);
    setMessage(null);
    setBuildReport(null);
    try {
      const report = await invoke<SiteBuildReport>("site_build", { config: buildConfig });
      setBuildReport(report);
      setPhase("succeeded");
      setMessage(`生成 ${report.pageCount} 个页面,复制 ${report.assetCount} 个资源`);
      await persistConfig(buildConfig, {
        captureViewMode,
        openPaths: Array.from(openCapturePaths).filter((path) => knownOpenPaths.has(path)).sort((a, b) => pathCollator.compare(a, b)),
      });
    } catch (err) {
      setPhase("failed");
      setError(String(err));
    }
  };

  const savePublishTarget = async () => {
    const candidate = publishCandidates.find((item) => item.id === selectedPublishCandidateId);
    if (!candidate || candidate.status !== "ready" || !repoPath.trim()) return;
    const target = makePublishTarget(repoPath.trim(), candidate, publishDraft);
    try {
      await invoke("store_set", {
        namespace: SITE_STATE_NS,
        key: sitePublishKey(repoPath.trim()),
        value: target,
      });
      setPublishTarget(target);
      setMessage(`已保存 Pages 发布目标: ${candidate.name}`);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const selectPublishCandidate = (candidate: PublishRepoCandidate) => {
    setSelectedPublishCandidateId(candidate.id);
    setPublishDraft((current) => ({
      ...current,
      pagesUrl: inferPagesUrl(candidate.url),
    }));
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center justify-between gap-4 border-b px-7 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileCode className="text-primary size-[18px]" />
            <h2 className="gt-title-app">静态站点</h2>
            <Badge variant={phase === "succeeded" ? "secondary" : "outline"}>{phaseText(phase)}</Badge>
          </div>
          <p className="gt-caption mt-1 truncate text-muted-foreground">
            从本地仓库文档构建离线 HTML 阅读站点。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => scanRepo()} disabled={!canScan}>
            {phase === "scanning" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            扫描
          </Button>
          <Button onClick={runBuild} disabled={!canBuild}>
            {phase === "building" ? <Loader2 className="animate-spin" /> : <Play />}
            构建
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] overflow-hidden">
        <SiteConfigSidebar
          repoPath={repoPath}
          siteTitle={siteTitle}
          outputDir={outputDir}
          withSearch={withSearch}
          copyAssets={copyAssets}
          recentRepos={recentRepos}
          onRepoPathChange={setRepoPath}
          onSiteTitleChange={setSiteTitle}
          onOutputDirChange={setOutputDir}
          onWithSearchChange={setWithSearch}
          onCopyAssetsChange={setCopyAssets}
          onChooseRepo={chooseRepo}
          onChooseOutput={chooseOutput}
          onSelectRecentRepo={(path) => {
            setRepoPath(path);
            setSiteTitle(defaultTitleFromRepo(path));
            void persistActiveRepo(path);
            void scanRepo(path);
          }}
        />

        <main className="flex min-h-0 min-w-0 flex-col">
          <ScrollArea className="flex-1">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
              {(message || error) && (
                <div className={cn(
                  "flex items-start gap-3 rounded-lg border p-4",
                  error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/20 bg-primary/5",
                )}>
                  {error ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" />}
                  <div className="gt-body">{error || message}</div>
                </div>
              )}

              <CapturePanel
                scanReport={scanReport}
                captureTree={captureTree}
                captureList={captureList}
                captureViewMode={captureViewMode}
                selectedPaths={selectedPaths}
                openCapturePaths={openCapturePaths}
                selectedCount={selectedCount}
                allCapturedSelected={allCapturedSelected}
                onViewModeChange={setCaptureViewMode}
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

              <PublishTargetPanel
                candidates={publishCandidates}
                selectedCandidateId={selectedPublishCandidateId}
                draft={publishDraft}
                savedTarget={publishTarget}
                sourceRepoReady={Boolean(repoPath.trim())}
                onSelectCandidate={selectPublishCandidate}
                onDraftChange={setPublishDraft}
                onSave={savePublishTarget}
              />

              {buildReport && (
                <BuildResultPanel
                  buildReport={buildReport}
                  onOpenIndex={openIndex}
                  onRevealOutput={revealOutput}
                />
              )}
            </div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}
