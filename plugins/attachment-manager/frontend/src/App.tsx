import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  File,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Image as ImageIcon,
  Link2,
  List,
  LoaderCircle,
  Maximize2,
  Music,
  RefreshCw,
  ScanSearch,
  Search,
  Unlink,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { IconNav } from "@/components/IconNav";
import { Input } from "@/components/ui/input";
import { ResizeHandle } from "@/components/ResizeHandle";
import { cn } from "@/lib/utils";

import { markPluginReady } from "./bridge";
import type {
  AttachmentItem,
  AttachmentKind,
  AttachmentPreview,
  AttachmentScanReport,
  WorkspaceInfo,
} from "./types";

type Filter = "all" | "orphan" | AttachmentKind;
type Module = "browser" | "inventory";
type ViewMode = "grid" | "list";
type SortMode = "name" | "size" | "references";

const filters: { id: Filter; label: string; icon: typeof File }[] = [
  { id: "all", label: "全部附件", icon: HardDrive },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "audio", label: "音频", icon: Music },
  { id: "link", label: "链接", icon: Link2 },
  { id: "orphan", label: "孤立附件", icon: Unlink },
];

const modules = [
  { id: "browser", name: "附件浏览", icon: ImageIcon },
  { id: "inventory", name: "扫描盘点", icon: ScanSearch },
];

const MAX_PREVIEW_CACHE_ITEMS = 80;
const previewCache = new Map<string, AttachmentPreview>();
const previewRequests = new Map<string, Promise<AttachmentPreview>>();

const kindLabels: Record<AttachmentKind, string> = {
  image: "图片",
  audio: "音频",
  link: "链接",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(seconds: number | null): string {
  if (!seconds) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(seconds * 1000));
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("preview_file_too_large")) return "文件超过 24 MB，请使用系统应用打开";
  if (message.includes("repository_not_open")) return "请先打开一个 Git 仓库";
  return message;
}

function absolutePath(root: string, relative: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${separator}${relative.split("/").join(separator)}`;
}

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "audio" ? Music : Link2;
  return <Icon className={className} />;
}

function previewKey(repoPath: string, item: AttachmentItem): string {
  return `${repoPath}\0${item.path}\0${item.modifiedAt ?? 0}\0${item.size}`;
}

function loadAttachmentPreview(repoPath: string, item: AttachmentItem): Promise<AttachmentPreview> {
  const key = previewKey(repoPath, item);
  const cached = previewCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = previewRequests.get(key);
  if (pending) return pending;

  if (item.kind === "link") {
    const value = {
      path: item.path,
      mimeType: item.mimeType,
      dataUrl: item.url ?? item.path,
    };
    previewCache.set(key, value);
    while (previewCache.size > MAX_PREVIEW_CACHE_ITEMS) {
      const oldest = previewCache.keys().next().value;
      if (typeof oldest !== "string") break;
      previewCache.delete(oldest);
    }
    return Promise.resolve(value);
  }

  const request = invoke<AttachmentPreview>("attachments_preview", {
    repoPath,
    path: item.path,
  }).then((value) => {
    previewCache.set(key, value);
    while (previewCache.size > MAX_PREVIEW_CACHE_ITEMS) {
      const oldest = previewCache.keys().next().value;
      if (typeof oldest !== "string") break;
      previewCache.delete(oldest);
    }
    return value;
  }).finally(() => {
    previewRequests.delete(key);
  });
  previewRequests.set(key, request);
  return request;
}

interface DetailPreviewState {
  key: string;
  preview: AttachmentPreview | null;
  error: string | null;
}

export function App() {
  const [report, setReport] = useState<AttachmentScanReport | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detailPreview, setDetailPreview] = useState<DetailPreviewState>({
    key: "",
    preview: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [activeModule, setActiveModule] = useState<Module>("browser");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inventoryWidth, setInventoryWidth] = useState(150);
  const [detailWidth, setDetailWidth] = useState(280);
  const initialLoad = useRef(false);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const workspace = await invoke<WorkspaceInfo>("get_workspace_info");
      if (!workspace.active_repo) throw new Error("请先打开一个 Git 仓库");
      const next = await invoke<AttachmentScanReport>("attachments_scan", {
        repoPath: workspace.active_repo,
      });
      setReport(next);
      setSelectedPath((current) => {
        if (current && next.attachments.some((item) => item.path === current)) return current;
        return next.attachments[0]?.path ?? null;
      });
    } catch (reason) {
      setReport(null);
      setSelectedPath(null);
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    markPluginReady();
    if (initialLoad.current) return;
    initialLoad.current = true;
    void scan();
  }, [scan]);

  const selected = useMemo(
    () => report?.attachments.find((item) => item.path === selectedPath) ?? null,
    [report, selectedPath],
  );

  useEffect(() => {
    let cancelled = false;
    if (!selected || !report) return;
    const key = previewKey(report.repoPath, selected);
    const cached = previewCache.get(key) ?? null;
    if (cached) return;

    void loadAttachmentPreview(report.repoPath, selected).then((value) => {
      if (!cancelled) setDetailPreview({ key, preview: value, error: null });
    }).catch((reason) => {
      if (!cancelled) {
        setDetailPreview({ key, preview: null, error: errorMessage(reason) });
      }
    });
    return () => { cancelled = true; };
  }, [report, selected]);

  useEffect(() => {
    setPreviewOpen(false);
  }, [selectedPath]);

  useEffect(() => {
    if (!previewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewOpen]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: report?.attachments.length ?? 0,
      image: 0,
      audio: 0,
      link: 0,
      orphan: 0,
    };
    for (const item of report?.attachments ?? []) {
      result[item.kind] += 1;
      if (item.references.length === 0) result.orphan += 1;
    }
    return result;
  }, [report]);

  const visibleAttachments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const items = (report?.attachments ?? []).filter((item) => {
      const filterMatches = filter === "all"
        || (filter === "orphan" ? item.references.length === 0 : item.kind === filter);
      const queryMatches = !needle
        || item.name.toLocaleLowerCase().includes(needle)
        || item.path.toLocaleLowerCase().includes(needle)
        || item.url?.toLocaleLowerCase().includes(needle);
      return filterMatches && queryMatches;
    });
    return [...items].sort((left, right) => {
      if (sortMode === "size") return right.size - left.size || left.path.localeCompare(right.path);
      if (sortMode === "references") {
        return right.references.length - left.references.length || left.path.localeCompare(right.path);
      }
      return left.name.localeCompare(right.name, "zh-CN") || left.path.localeCompare(right.path);
    });
  }, [filter, query, report, sortMode]);

  const revealSelected = useCallback(() => {
    if (!selected || !report || selected.kind === "link") return;
    void revealItemInDir(absolutePath(report.repoPath, selected.path));
  }, [report, selected]);

  const openSelected = useCallback(() => {
    if (!selected || !report) return;
    if (selected.kind === "link") {
      void openUrl(selected.url ?? selected.path);
      return;
    }
    void openPath(absolutePath(report.repoPath, selected.path));
  }, [report, selected]);

  const selectAttachment = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const selectModule = useCallback((id: string) => {
    const next = id as Module;
    setActiveModule(next);
    setFilter("all");
  }, []);

  const selectedPreviewKey = selected && report ? previewKey(report.repoPath, selected) : "";
  const selectedCachedPreview = selectedPreviewKey ? previewCache.get(selectedPreviewKey) ?? null : null;
  const selectedPreview = selectedCachedPreview
    ?? (detailPreview.key === selectedPreviewKey ? detailPreview.preview : null);
  const selectedPreviewError = detailPreview.key === selectedPreviewKey ? detailPreview.error : null;
  const selectedPreviewLoading = !selectedPreview && !selectedPreviewError;

  return (
    <div className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="min-w-0">
          <h1 className="gt-title-app">{activeModule === "browser" ? "附件浏览" : "扫描盘点"}</h1>
          <p className="text-muted-foreground gt-caption truncate">
            {report?.repoPath ?? "当前仓库"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {activeModule === "inventory" && report && (
            <div className="text-muted-foreground gt-label hidden items-center gap-3 sm:flex">
              <span>{report.attachments.length} 个</span>
              <span>{formatBytes(report.totalSize)}</span>
              <span>{report.notesScanned} 篇笔记</span>
            </div>
          )}
          <Button variant="outline" size="icon" onClick={() => void scan()} disabled={loading} title="重新扫描">
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center text-center">
            <AlertTriangle className="text-destructive mb-3 size-6" />
            <h2 className="gt-title-panel">无法读取附件</h2>
            <p className="text-muted-foreground gt-body mt-2 break-words">{error}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => void scan()}>
              <RefreshCw />
              重试
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="border-border/50 flex w-10 shrink-0 flex-col items-center border-r py-2">
            <IconNav items={modules} activeId={activeModule} onSelect={selectModule} size="sm" />
          </aside>

          {activeModule === "inventory" && (
          <aside
            className="bg-sidebar/70 border-border flex min-h-0 shrink-0 flex-col border-r p-3"
            style={{ width: inventoryWidth }}
          >
            <div className="gt-label text-muted-foreground mb-2 px-2">类型</div>
            <nav className="space-y-1">
              {filters.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={cn(
                      "gt-body flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors",
                      filter === item.id
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="gt-caption tabular-nums">{counts[item.id]}</span>
                  </button>
                );
              })}
            </nav>
            {report && (
              <dl className="border-border text-muted-foreground gt-caption mt-auto space-y-1 border-t px-2 pt-3">
                <div className="flex justify-between gap-2"><dt>扫描耗时</dt><dd>{report.durationMs} ms</dd></div>
                <div className="flex justify-between gap-2"><dt>笔记</dt><dd>{report.notesScanned}</dd></div>
                <div className="flex justify-between gap-2"><dt>跳过</dt><dd>{report.skippedEntries}</dd></div>
              </dl>
            )}
          </aside>
          )}
          {activeModule === "inventory" && (
            <ResizeHandle
              direction="horizontal"
              size={inventoryWidth}
              onResize={setInventoryWidth}
              minSize={120}
              snapTo={150}
              ariaLabel="调整类型栏宽度"
            />
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {activeModule === "inventory" && report && (
              <div className="border-border bg-muted/20 flex min-h-11 shrink-0 items-center justify-between gap-3 border-b px-3">
                <div className="min-w-0">
                  <span className="gt-body-strong">{loading ? "正在重新扫描" : "扫描完成"}</span>
                  <span className="text-muted-foreground gt-caption ml-2">
                    发现 {report.attachments.length} 个附件，共 {formatBytes(report.totalSize)}
                  </span>
                </div>
                {report.skippedEntries > 0 && (
                  <span className="text-amber-700 gt-caption shrink-0">{report.skippedEntries} 项无法读取</span>
                )}
              </div>
            )}
            <div className="border-border flex h-12 shrink-0 items-center gap-2 border-b px-3">
              <div className="relative min-w-0 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称或路径"
                  className="h-8 pl-8"
                />
              </div>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="border-input bg-background gt-body h-8 rounded-md border px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="排序方式"
              >
                <option value="name">名称</option>
                <option value="size">大小</option>
                <option value="references">引用</option>
              </select>
              <div className="bg-muted flex h-8 shrink-0 items-center rounded-md p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={cn("flex size-7 items-center justify-center rounded-sm", viewMode === "grid" && "bg-background shadow-sm")}
                  title="网格视图"
                >
                  <Grid2X2 className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={cn("flex size-7 items-center justify-center rounded-sm", viewMode === "list" && "bg-background shadow-sm")}
                  title="列表视图"
                >
                  <List className="size-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
              {loading && !report ? (
                <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" />
                  <span className="gt-body">正在扫描附件</span>
                </div>
              ) : visibleAttachments.length === 0 ? (
                <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-center">
                  <File className="mb-3 size-7" />
                  <span className="gt-body">没有匹配的附件</span>
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                  {visibleAttachments.map((item) => (
                    <AttachmentTile
                      key={item.path}
                      item={item}
                      repoPath={report?.repoPath ?? ""}
                      selected={item.path === selectedPath}
                      onSelect={selectAttachment}
                    />
                  ))}
                </div>
              ) : (
                <div className="divide-border divide-y">
                  {visibleAttachments.map((item) => (
                    <AttachmentRow
                      key={item.path}
                      item={item}
                      selected={item.path === selectedPath}
                      onSelect={selectAttachment}
                    />
                  ))}
                </div>
              )}
            </div>
          </main>

          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={detailWidth}
            onResize={setDetailWidth}
            minSize={220}
            snapTo={280}
            ariaLabel="调整详情栏宽度"
            className="max-[720px]:hidden"
          />
          <aside
            className="border-border flex shrink-0 min-h-0 flex-col border-l max-[720px]:hidden"
            style={{ width: detailWidth }}
          >
            {selected ? (
              <>
                <div className="border-border flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
                  <h2 className="gt-title-panel min-w-0 truncate" title={selected.name}>{selected.name}</h2>
                  <div className="flex shrink-0 items-center gap-1">
                    {selected.kind !== "link" && (
                      <Button variant="ghost" size="icon" onClick={revealSelected} title="在文件管理器中显示">
                        <FolderOpen />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={openSelected}
                      title={selected.kind === "link" ? "在浏览器中打开" : "使用系统应用打开"}
                    >
                      {selected.kind === "link" ? <Link2 /> : <File />}
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
                  <PreviewPanel
                    item={selected}
                    preview={selectedPreview}
                    loading={selectedPreviewLoading}
                    error={selectedPreviewError}
                    onExpand={() => setPreviewOpen(true)}
                  />
                  <dl className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-2">
                    <dt className="text-muted-foreground gt-label">{selected.kind === "link" ? "链接" : "路径"}</dt>
                    <dd className="gt-caption break-all">{selected.url ?? selected.path}</dd>
                    <dt className="text-muted-foreground gt-label">类型</dt>
                    <dd className="gt-body">
                      {kindLabels[selected.kind]}{selected.extension ? ` · ${selected.extension.toUpperCase()}` : ""}
                    </dd>
                    <dt className="text-muted-foreground gt-label">大小</dt>
                    <dd className="gt-body">{selected.kind === "link" ? "远程资源" : formatBytes(selected.size)}</dd>
                    <dt className="text-muted-foreground gt-label">修改时间</dt>
                    <dd className="gt-body">{selected.kind === "link" ? "未知" : formatDate(selected.modifiedAt)}</dd>
                  </dl>

                  <div className="border-border mt-4 border-t pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="gt-title-section flex items-center gap-2">
                        <Link2 className="size-4" />
                        引用笔记
                      </h3>
                      <span className="text-muted-foreground gt-caption">{selected.references.length}</span>
                    </div>
                    {selected.references.length === 0 ? (
                      <p className="text-muted-foreground gt-body">未发现引用</p>
                    ) : (
                      <div className="space-y-1">
                        {selected.references.map((reference) => (
                          <div key={`${reference.notePath}:${reference.line}`} className="bg-muted/60 rounded-md px-2 py-1.5">
                            <div className="gt-body-strong truncate" title={reference.notePath}>{reference.notePath}</div>
                            <div className="text-muted-foreground gt-caption">第 {reference.line} 行</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center">
                <span className="gt-body">选择一个附件</span>
              </div>
            )}
          </aside>
        </div>
      )}
      {previewOpen && (selected?.kind === "image" || selected?.kind === "link") && selectedPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${selected.name} 图片预览`}
          onClick={() => setPreviewOpen(false)}
        >
          <img
            src={selectedPreview.dataUrl}
            alt={selected.name}
            decoding="async"
            className="max-h-full max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          <Button
            variant="outline"
            size="icon"
            className="absolute right-4 top-4 bg-background/90"
            onClick={() => setPreviewOpen(false)}
            title="关闭预览"
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}

const AttachmentTile = memo(function AttachmentTile({
  item,
  repoPath,
  selected,
  onSelect,
}: {
  item: AttachmentItem;
  repoPath: string;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const tileRef = useRef<HTMLButtonElement>(null);
  const key = previewKey(repoPath, item);
  const [preview, setPreview] = useState<AttachmentPreview | null>(() => previewCache.get(key) ?? null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    previewCache.has(key) ? "ready" : "idle",
  );
  const canPreview = item.kind === "image" || item.mimeType.startsWith("image/");

  useEffect(() => {
    let cancelled = false;
    const cached = previewCache.get(key) ?? null;
    setPreview(cached);
    setLoadState(cached ? "ready" : "idle");
    if (cached || !canPreview || !repoPath) return;

    const load = () => {
      setLoadState("loading");
      void loadAttachmentPreview(repoPath, item).then((value) => {
        if (!cancelled) {
          setPreview(value);
          setLoadState("ready");
        }
      }).catch(() => {
        if (!cancelled) setLoadState("error");
      });
    };
    const element = tileRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      load();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [canPreview, item, key, repoPath]);

  return (
    <button
      ref={tileRef}
      type="button"
      onClick={() => onSelect(item.path)}
      className={cn(
        "border-border bg-card min-w-0 overflow-hidden rounded-md border text-left transition-colors [contain:layout_paint]",
        selected ? "border-primary ring-primary/30 ring-2 ring-inset" : "hover:bg-accent/40",
      )}
    >
      <div className="bg-muted/60 pointer-events-none flex aspect-[4/3] w-full items-center justify-center overflow-hidden">
        {preview && canPreview ? (
          <AsyncPreviewImage key={preview.dataUrl} src={preview.dataUrl} alt="" fallbackKind={item.kind} />
        ) : loadState === "loading" ? (
          <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
        ) : loadState === "error" ? (
          <AlertTriangle className="text-muted-foreground size-6" />
        ) : (
          <KindIcon kind={item.kind} className="text-muted-foreground size-8" />
        )}
      </div>
      <div className="pointer-events-none p-2">
        <div className="gt-body-strong truncate" title={item.name}>{item.name}</div>
        <div className="text-muted-foreground gt-caption mt-1 flex items-center justify-between gap-2">
          <span>{item.kind === "link" ? "远程" : formatBytes(item.size)}</span>
          <span className="flex items-center gap-1"><Link2 className="size-3" />{item.references.length}</span>
        </div>
      </div>
    </button>
  );
});

const AttachmentRow = memo(function AttachmentRow({
  item,
  selected,
  onSelect,
}: {
  item: AttachmentItem;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.path)}
      className={cn(
        "flex h-11 w-full min-w-0 items-center gap-3 px-2 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <KindIcon kind={item.kind} className="text-muted-foreground size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="gt-body-strong block truncate">{item.name}</span>
        <span className="text-muted-foreground gt-caption block truncate">{item.path}</span>
      </span>
      <span className="text-muted-foreground gt-caption w-16 shrink-0 text-right">
        {item.kind === "link" ? "远程" : formatBytes(item.size)}
      </span>
      <span className="text-muted-foreground gt-caption flex w-8 shrink-0 items-center justify-end gap-1">
        <Link2 className="size-3" />{item.references.length}
      </span>
    </button>
  );
});

function PreviewPanel({
  item,
  preview,
  loading,
  error,
  onExpand,
}: {
  item: AttachmentItem;
  preview: AttachmentPreview | null;
  loading: boolean;
  error: string | null;
  onExpand: () => void;
}) {
  return (
    <div className="bg-muted/40 border-border flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border">
      {loading ? (
        <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
      ) : error ? (
        <div className="text-muted-foreground gt-caption px-4 text-center">{error}</div>
      ) : !preview ? (
        <KindIcon kind={item.kind} className="text-muted-foreground size-8" />
      ) : preview.mimeType.startsWith("audio/") ? (
        <AsyncPreviewAudio src={preview.dataUrl} />
      ) : item.kind === "image" || preview.mimeType.startsWith("image/") ? (
        <AsyncPreviewImage
          key={preview.dataUrl}
          src={preview.dataUrl}
          alt={item.name}
          fallbackKind={item.kind}
          onExpand={onExpand}
        />
      ) : item.kind === "link" ? (
        <div className="text-muted-foreground gt-caption flex flex-col items-center gap-2 px-4 text-center">
          <Link2 className="size-8" />
          <span>此链接没有可内嵌的媒体预览</span>
        </div>
      ) : (
        <KindIcon kind={item.kind} className="text-muted-foreground size-8" />
      )}
    </div>
  );
}

function AsyncPreviewImage({
  src,
  alt,
  fallbackKind,
  onExpand,
}: {
  src: string;
  alt: string;
  fallbackKind: AttachmentKind;
  onExpand?: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    timeoutRef.current = window.setTimeout(() => {
      setState((current) => current === "loading" ? "error" : current);
    }, 15_000);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [src]);

  const finish = (next: "ready" | "error") => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setState(next);
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {state === "loading" && <LoaderCircle className="text-muted-foreground size-5 animate-spin" />}
      {state === "error" && (
        <div className="text-muted-foreground gt-caption flex flex-col items-center gap-2 px-4 text-center">
          <KindIcon kind={fallbackKind} className="size-7" />
          {fallbackKind === "link" && <span>此链接无法作为图片预览</span>}
        </div>
      )}
      {state !== "error" && (
        <img
          src={src}
          alt={alt}
          decoding="async"
          onLoad={() => finish("ready")}
          onError={() => finish("error")}
          className={cn(
            "pointer-events-none absolute inset-0 block h-full w-full object-contain",
            state === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {state === "ready" && onExpand && (
        <button
          type="button"
          className="group absolute inset-0 cursor-zoom-in"
          onClick={onExpand}
          title="放大预览"
        >
          <span className="bg-background/90 absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            <Maximize2 className="size-4" />
          </span>
        </button>
      )}
    </div>
  );
}

function AsyncPreviewAudio({ src }: { src: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => setState("loading"), [src]);

  return (
    <div className="flex w-full flex-col items-center px-4">
      {state === "loading" ? (
        <LoaderCircle className="text-muted-foreground mb-4 size-5 animate-spin" />
      ) : state === "error" ? (
        <AlertTriangle className="text-muted-foreground mb-4 size-6" />
      ) : (
        <Music className="text-muted-foreground mb-4 size-8" />
      )}
      <audio
        controls
        preload="metadata"
        src={src}
        onLoadedMetadata={() => setState("ready")}
        onError={() => setState("error")}
      />
    </div>
  );
}
