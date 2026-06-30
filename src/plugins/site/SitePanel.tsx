import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ExternalLink,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  List,
  Loader2,
  Play,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SitePhase = "idle" | "scanning" | "ready" | "building" | "succeeded" | "failed";
type SitePathKind = "file" | "dir";
type CaptureViewMode = "tree" | "list";

interface WorkspaceInfo {
  active_repo: string | null;
  recent_repos: string[];
  device_id: string | null;
  device_name: string | null;
}

interface SitePathCandidate {
  path: string;
  kind: SitePathKind;
  score: number;
  reason: string[];
  markdownCount: number;
  selectedByDefault: boolean;
}

interface SiteScanReport {
  repoPath: string;
  repoName: string;
  candidates: SitePathCandidate[];
  ignored: { path: string; reason: string }[];
  markdownCount: number;
  assetCount: number;
  defaultOutputDir: string;
}

interface SiteBuildConfig {
  repoPath: string;
  outputDir: string;
  siteTitle: string;
  include: string[];
  exclude: string[];
  theme: "typora-light" | "typora-dark";
  withSearch: boolean;
  copyAssets: boolean;
}

interface SiteBuildReport {
  outputDir: string;
  indexHtml: string;
  pageCount: number;
  assetCount: number;
  brokenLinks: { source: string; target: string; kind: string }[];
  warnings: { path: string; message: string }[];
  durationMs: number;
}

interface SiteBuildUiState {
  version: 1 | 2;
  repoPath: string;
  outputDir: string;
  siteTitle: string;
  include: string[];
  hasSelectionState: boolean;
  captureViewMode: CaptureViewMode;
  openPaths: string[] | null;
  theme: "typora-light" | "typora-dark";
  withSearch: boolean;
  copyAssets: boolean;
  updatedAt: number;
}

interface SiteActiveRepoState {
  version: 1;
  repoPath: string;
  updatedAt: number;
}

interface CaptureTreeNode {
  name: string;
  path: string;
  children: CaptureTreeNode[];
  candidate?: SitePathCandidate;
}

const pathCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const SITE_STATE_NS = "sites";
const SITE_STATE_KEY_PREFIX = "build.";
const SITE_ACTIVE_REPO_KEY = "repo.active";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function siteStateKey(repoPath: string) {
  return `${SITE_STATE_KEY_PREFIX}${stableHash(repoPath)}`;
}

function isCaptureViewMode(value: unknown): value is CaptureViewMode {
  return value === "tree" || value === "list";
}

function parseSiteActiveRepoState(value: unknown): SiteActiveRepoState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SiteActiveRepoState>;
  if (state.version !== 1) return null;
  if (typeof state.repoPath !== "string" || state.repoPath.trim().length === 0) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    repoPath: state.repoPath,
    updatedAt: state.updatedAt,
  };
}

function parseSiteBuildUiState(value: unknown): SiteBuildUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SiteBuildUiState>;
  if (state.version !== 1 && state.version !== 2) return null;
  if (typeof state.repoPath !== "string") return null;
  if (typeof state.outputDir !== "string") return null;
  if (typeof state.siteTitle !== "string") return null;
  if (!Array.isArray(state.include) || state.include.some((item) => typeof item !== "string")) return null;
  if (state.theme !== "typora-light" && state.theme !== "typora-dark") return null;
  if (typeof state.withSearch !== "boolean") return null;
  if (typeof state.copyAssets !== "boolean") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  const openPaths = Array.isArray(state.openPaths) && state.openPaths.every((item) => typeof item === "string")
    ? state.openPaths
    : null;
  return {
    version: state.version,
    repoPath: state.repoPath,
    outputDir: state.outputDir,
    siteTitle: state.siteTitle,
    include: state.include,
    hasSelectionState: state.version >= 2 ? state.hasSelectionState !== false : state.include.length > 0,
    captureViewMode: isCaptureViewMode(state.captureViewMode) ? state.captureViewMode : "tree",
    openPaths,
    theme: state.theme,
    withSearch: state.withSearch,
    copyAssets: state.copyAssets,
    updatedAt: state.updatedAt,
  };
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path;
}

function defaultTitleFromRepo(repoPath: string, fallback = "Git Tributary Site") {
  const parts = repoPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : fallback;
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

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

function splitPath(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function pathName(path: string): string {
  const parts = splitPath(path);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function isDirectoryNode(node: CaptureTreeNode): boolean {
  return node.children.length > 0 || node.candidate?.kind === "dir";
}

function compareCaptureNodes(a: CaptureTreeNode, b: CaptureTreeNode): number {
  const aDir = isDirectoryNode(a);
  const bDir = isDirectoryNode(b);
  if (aDir !== bDir) return aDir ? -1 : 1;
  return pathCollator.compare(a.name, b.name);
}

function buildCaptureTree(candidates: SitePathCandidate[]): CaptureTreeNode[] {
  const root: CaptureTreeNode = { name: "", path: "", children: [] };

  for (const candidate of candidates) {
    const parts = splitPath(candidate.path);
    let cursor = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = cursor.children.find((node) => node.name === part);
      if (!child) {
        child = { name: part, path, children: [] };
        cursor.children.push(child);
      }
      cursor = child;
      if (index === parts.length - 1) {
        cursor.candidate = candidate;
      }
    });
  }

  function sortNode(node: CaptureTreeNode) {
    node.children.sort(compareCaptureNodes);
    node.children.forEach(sortNode);
  }
  sortNode(root);
  return root.children;
}

function flattenCaptureTree(nodes: CaptureTreeNode[]): SitePathCandidate[] {
  const result: SitePathCandidate[] = [];
  function walk(node: CaptureTreeNode) {
    if (node.candidate) result.push(node.candidate);
    node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

function orderedCandidates(candidates: SitePathCandidate[]): SitePathCandidate[] {
  return flattenCaptureTree(buildCaptureTree(candidates));
}

function collectNodeCandidates(node: CaptureTreeNode): SitePathCandidate[] {
  const result: SitePathCandidate[] = [];
  function walk(current: CaptureTreeNode) {
    if (current.candidate) result.push(current.candidate);
    current.children.forEach(walk);
  }
  walk(node);
  return result;
}

function collectOpenNodePaths(nodes: CaptureTreeNode[]): Set<string> {
  const paths = new Set<string>();
  function walk(node: CaptureTreeNode) {
    if (node.children.length > 0) {
      paths.add(node.path);
      node.children.forEach(walk);
    }
  }
  nodes.forEach(walk);
  return paths;
}

function filterKnownPaths(paths: string[], knownPaths: Set<string>): string[] {
  return paths.filter((path) => knownPaths.has(path));
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
        setOpenCapturePaths(new Set(cached.openPaths ? filterKnownPaths(cached.openPaths, knownPaths) : Array.from(knownPaths)));
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
        setOpenCapturePaths(collectOpenNodePaths(buildCaptureTree(report.candidates)));
      }
      hydratedRepoRef.current = report.repoPath;
      void persistActiveRepo(report.repoPath);
      setPhase("ready");
      setMessage(`捕捉到 ${report.markdownCount} 个 Markdown 文件`);
    } catch (err) {
      setPhase("failed");
      setError(String(err));
    }
  }, [persistActiveRepo, repoPath, restoreConfig]);

  useEffect(() => {
    if (initialScanRef.current) return;
    initialScanRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const ws = await invoke<WorkspaceInfo>("get_workspace_info");
        if (cancelled) return;
        setRecentRepos(ws.recent_repos ?? []);
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
  }, [scanRepo]);

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
        <aside className="border-border flex min-h-0 flex-col border-r bg-sidebar/30">
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-5 p-5">
              <section className="space-y-3">
                <div>
                  <div className="gt-body-strong">仓库</div>
                  <p className="gt-caption text-muted-foreground">选择要捕捉文档的本地仓库。</p>
                </div>
                <div className="flex gap-2">
                  <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="仓库路径" />
                  <Button variant="outline" size="icon" onClick={chooseRepo} title="选择仓库">
                    <FolderOpen />
                  </Button>
                </div>
                {recentRepos.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {recentRepos.slice(0, 4).map((path) => (
                      <button
                        type="button"
                        key={path}
                        onClick={() => {
                          setRepoPath(path);
                          setSiteTitle(defaultTitleFromRepo(path));
                          void persistActiveRepo(path);
                          void scanRepo(path);
                        }}
                        className="rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        {shortPath(path)}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              <section className="space-y-3">
                <div>
                  <div className="gt-body-strong">输出</div>
                  <p className="gt-caption text-muted-foreground">默认写入仓库内 `.gittributary/site`。</p>
                </div>
                <Input value={siteTitle} onChange={(event) => setSiteTitle(event.target.value)} placeholder="站点标题" />
                <div className="flex gap-2">
                  <Input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} placeholder="输出目录" />
                  <Button variant="outline" size="icon" onClick={chooseOutput} title="选择输出目录">
                    <FolderOpen />
                  </Button>
                </div>
              </section>

              <Separator />

              <section className="space-y-3">
                <div className="gt-body-strong">构建选项</div>
                <div className="rounded-md border bg-background px-3 py-2">
                  <div className="text-sm">阅读主题</div>
                  <p className="gt-caption mt-1 text-muted-foreground">生成后在网页右上角切换亮色/暗色。</p>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                  <span className="text-sm">生成搜索索引</span>
                  <Switch checked={withSearch} onCheckedChange={setWithSearch} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                  <span className="text-sm">复制图片与资源</span>
                  <Switch checked={copyAssets} onCheckedChange={setCopyAssets} />
                </label>
              </section>
            </div>
          </ScrollArea>
        </aside>

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

              <section className="rounded-lg border bg-card">
                <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
                  <div>
                    <div className="gt-title-panel">捕捉到的文档入口</div>
                    <div className="gt-caption mt-1 flex min-w-0 items-center gap-2 text-muted-foreground">
                      <span className="truncate">
                        {scanReport ? `${scanReport.markdownCount} 个 Markdown,${scanReport.assetCount} 个资源候选` : "先选择仓库并扫描。"}
                      </span>
                      {scanReport && (
                        <span className="min-w-14 shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-center font-mono tabular-nums text-foreground">
                          {selectedCount} 项
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/30 p-0.5">
                      <button
                        type="button"
                        onClick={() => setCaptureViewMode("tree")}
                        title="树形"
                        className={cn(
                          "flex h-7 items-center gap-1 rounded px-2 gt-caption transition-colors",
                          captureViewMode === "tree"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                        )}
                      >
                        <FolderTree className="size-3.5" />
                        树形
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptureViewMode("list")}
                        title="列表"
                        className={cn(
                          "flex h-7 items-center gap-1 rounded px-2 gt-caption transition-colors",
                          captureViewMode === "list"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                        )}
                      >
                        <List className="size-3.5" />
                        列表
                      </button>
                    </div>
                    <Button variant="outline" size="sm" onClick={selectDefaults} disabled={!scanReport}>默认</Button>
                    <Button variant="outline" size="sm" onClick={toggleAllSelection} disabled={!scanReport || captureList.length === 0}>
                      {allCapturedSelected ? "取消" : "全选"}
                    </Button>
                  </div>
                </div>
                <div>
                  {captureList.length ? (
                    captureViewMode === "tree" ? (
                      <CaptureTree
                        nodes={captureTree}
                        openPaths={openCapturePaths}
                        selectedPaths={selectedPaths}
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
                    ) : (
                      <div className="divide-y">
                        {captureList.map((candidate) => (
                          <CaptureListItem
                            key={candidate.path}
                            candidate={candidate}
                            checked={selectedPaths.has(candidate.path)}
                            onToggle={() => toggleCandidate(candidate.path)}
                          />
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                      <Search className="size-8 text-muted-foreground" />
                      <div className="gt-body-strong">还没有扫描结果</div>
                      <p className="gt-caption max-w-sm text-muted-foreground">选择仓库后会自动捕捉 README、doc、docs、notes 等文档入口。</p>
                    </div>
                  )}
                </div>
              </section>

              {buildReport && (
                <section className="rounded-lg border bg-card">
                  <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
                    <div>
                      <div className="gt-title-panel">构建结果</div>
                      <p className="gt-caption mt-1 text-muted-foreground">
                        {buildReport.pageCount} 个页面 · {buildReport.assetCount} 个资源 · {formatDuration(buildReport.durationMs)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={revealOutput}>
                        <FolderOpen /> 输出目录
                      </Button>
                      <Button size="sm" onClick={openIndex}>
                        <ExternalLink /> 打开站点
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
                    <ResultStat label="Index" value={shortPath(buildReport.indexHtml)} />
                    <ResultStat label="Warnings" value={String(buildReport.warnings.length)} />
                    <ResultStat label="Broken links" value={String(buildReport.brokenLinks.length)} />
                  </div>
                  {(buildReport.warnings.length > 0 || buildReport.brokenLinks.length > 0) && (
                    <div className="border-t px-5 py-4">
                      <div className="gt-body-strong mb-2">提示</div>
                      <div className="flex flex-col gap-2">
                        {buildReport.warnings.slice(0, 6).map((warning) => (
                          <div key={`${warning.path}-${warning.message}`} className="gt-caption rounded-md bg-muted px-3 py-2">
                            {warning.path}: {warning.message}
                          </div>
                        ))}
                        {buildReport.brokenLinks.slice(0, 6).map((link) => (
                          <div key={`${link.source}-${link.target}`} className="gt-caption rounded-md bg-muted px-3 py-2">
                            {link.source}: {link.target} ({link.kind})
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background p-3">
      <div className="gt-caption text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  title,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  title?: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      title={title}
      onClick={(event) => event.stopPropagation()}
      onChange={onChange}
      className="size-3.5 shrink-0 accent-primary"
    />
  );
}

function CandidateMeta({ candidate }: { candidate: SitePathCandidate }) {
  return (
    <>
      <Badge variant="outline" className="h-5 shrink-0 px-1.5 gt-caption">
        {candidate.kind === "dir" ? "目录" : "文件"}
      </Badge>
      <Badge variant="secondary" className="h-5 shrink-0 px-1.5 gt-caption">
        {candidate.markdownCount} md
      </Badge>
    </>
  );
}

function CaptureListItem({
  candidate,
  checked,
  onToggle,
}: {
  candidate: SitePathCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  const Icon = candidate.kind === "dir" ? Folder : FileText;

  return (
    <label className="flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-accent/40">
      <SelectionCheckbox checked={checked} onChange={onToggle} title={checked ? "取消选择" : "选择"} />
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate gt-body-strong" title={candidate.path}>{candidate.path}</span>
          <CandidateMeta candidate={candidate} />
        </div>
        <div className="gt-caption mt-1 truncate text-muted-foreground" title={candidate.reason.join(" / ")}>
          {candidate.reason.join(" / ")} · score {candidate.score}
        </div>
      </div>
    </label>
  );
}

function CaptureTree({
  nodes,
  openPaths,
  selectedPaths,
  onToggleOpen,
  onToggleCandidate,
  onToggleGroup,
}: {
  nodes: CaptureTreeNode[];
  openPaths: Set<string>;
  selectedPaths: Set<string>;
  onToggleOpen: (path: string) => void;
  onToggleCandidate: (path: string) => void;
  onToggleGroup: (paths: string[]) => void;
}) {
  return (
    <div className="gt-thin-scroll overflow-x-auto py-1">
      <div className="w-max min-w-full pb-2">
        {nodes.map((node) => (
          <CaptureTreeRow
            key={node.path}
            node={node}
            depth={0}
            openPaths={openPaths}
            selectedPaths={selectedPaths}
            onToggleOpen={onToggleOpen}
            onToggleCandidate={onToggleCandidate}
            onToggleGroup={onToggleGroup}
          />
        ))}
      </div>
    </div>
  );
}

function CaptureTreeRow({
  node,
  depth,
  openPaths,
  selectedPaths,
  onToggleOpen,
  onToggleCandidate,
  onToggleGroup,
}: {
  node: CaptureTreeNode;
  depth: number;
  openPaths: Set<string>;
  selectedPaths: Set<string>;
  onToggleOpen: (path: string) => void;
  onToggleCandidate: (path: string) => void;
  onToggleGroup: (paths: string[]) => void;
}) {
  const hasChildren = node.children.length > 0;
  const candidatePaths = collectNodeCandidates(node).map((candidate) => candidate.path);
  const checkedCount = candidatePaths.filter((path) => selectedPaths.has(path)).length;
  const allChecked = candidatePaths.length > 0 && checkedCount === candidatePaths.length;
  const someChecked = checkedCount > 0 && checkedCount < candidatePaths.length;
  const isOpen = openPaths.has(node.path);
  const isDir = isDirectoryNode(node);
  const Icon = isDir ? Folder : FileText;

  return (
    <div>
      <div
        className="group flex h-9 cursor-pointer items-center gap-2 px-5 text-left transition-colors hover:bg-accent/40"
        style={{ paddingLeft: `${20 + depth * 18}px` }}
        onClick={() => {
          if (hasChildren) onToggleOpen(node.path);
          else if (node.candidate) onToggleCandidate(node.candidate.path);
        }}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {hasChildren ? (
            isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />
          ) : null}
        </span>
        <SelectionCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={() => onToggleGroup(candidatePaths)}
          title={allChecked ? "取消选择此分组" : "选择此分组"}
        />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap gt-body-strong" title={node.path}>
            {pathName(node.path)}
          </span>
          {node.candidate ? (
            <CandidateMeta candidate={node.candidate} />
          ) : (
            <Badge variant="secondary" className="h-5 shrink-0 px-1.5 gt-caption">
              {candidatePaths.length} 项
            </Badge>
          )}
          {node.candidate?.reason.length ? (
            <span className="gt-caption min-w-24 truncate text-muted-foreground">
              {node.candidate.reason.join(" / ")}
            </span>
          ) : null}
        </div>
      </div>
      {hasChildren && isOpen && node.children.map((child) => (
        <CaptureTreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          openPaths={openPaths}
          selectedPaths={selectedPaths}
          onToggleOpen={onToggleOpen}
          onToggleCandidate={onToggleCandidate}
          onToggleGroup={onToggleGroup}
        />
      ))}
    </div>
  );
}
