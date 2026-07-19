import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  File,
  FileText,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Image as ImageIcon,
  Link2,
  List,
  LoaderCircle,
  Music,
  RefreshCw,
  Search,
  Unlink,
  Video,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
type ViewMode = "grid" | "list";
type SortMode = "name" | "size" | "references";

const filters: { id: Filter; label: string; icon: typeof File }[] = [
  { id: "all", label: "全部附件", icon: HardDrive },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "audio", label: "音频", icon: Music },
  { id: "video", label: "视频", icon: Video },
  { id: "document", label: "文档", icon: FileText },
  { id: "orphan", label: "孤立附件", icon: Unlink },
];

const kindLabels: Record<AttachmentKind, string> = {
  image: "图片",
  audio: "音频",
  video: "视频",
  document: "文档",
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
  const Icon = kind === "image"
    ? ImageIcon
    : kind === "audio"
      ? Music
      : kind === "video"
        ? Video
        : kind === "document"
          ? FileText
          : File;
  return <Icon className={className} />;
}

export function App() {
  const [report, setReport] = useState<AttachmentScanReport | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("name");
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
    setPreview(null);
    setPreviewError(null);
    if (!selected || !report) return;
    setPreviewLoading(true);
    void invoke<AttachmentPreview>("attachments_preview", {
      repoPath: report.repoPath,
      path: selected.path,
    }).then((value) => {
      if (!cancelled) setPreview(value);
    }).catch((reason) => {
      if (!cancelled) setPreviewError(errorMessage(reason));
    }).finally(() => {
      if (!cancelled) setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [report, selected]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: report?.attachments.length ?? 0,
      image: 0,
      audio: 0,
      video: 0,
      document: 0,
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
        || item.path.toLocaleLowerCase().includes(needle);
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
    if (!selected || !report) return;
    void revealItemInDir(absolutePath(report.repoPath, selected.path));
  }, [report, selected]);

  const openSelected = useCallback(() => {
    if (!selected || !report) return;
    void openPath(absolutePath(report.repoPath, selected.path));
  }, [report, selected]);

  return (
    <div className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="min-w-0">
          <h1 className="gt-title-app">附件</h1>
          <p className="text-muted-foreground gt-caption truncate">
            {report?.repoPath ?? "当前仓库"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {report && (
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
        <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(220px,1fr)_280px] overflow-hidden max-[720px]:grid-cols-[150px_minmax(220px,1fr)]">
          <aside className="bg-muted/20 border-border flex min-h-0 flex-col border-r p-3">
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
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
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
                      selected={item.path === selectedPath}
                      onSelect={() => setSelectedPath(item.path)}
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
                      onSelect={() => setSelectedPath(item.path)}
                    />
                  ))}
                </div>
              )}
            </div>
          </main>

          <aside className="border-border flex min-h-0 flex-col border-l max-[720px]:hidden">
            {selected ? (
              <>
                <div className="border-border flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
                  <h2 className="gt-title-panel min-w-0 truncate" title={selected.name}>{selected.name}</h2>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={revealSelected} title="在文件管理器中显示">
                      <FolderOpen />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={openSelected} title="使用系统应用打开">
                      <File />
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                  <PreviewPanel
                    item={selected}
                    preview={preview}
                    loading={previewLoading}
                    error={previewError}
                  />
                  <dl className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-2">
                    <dt className="text-muted-foreground gt-label">路径</dt>
                    <dd className="gt-caption break-all">{selected.path}</dd>
                    <dt className="text-muted-foreground gt-label">类型</dt>
                    <dd className="gt-body">{kindLabels[selected.kind]} · {selected.extension.toUpperCase()}</dd>
                    <dt className="text-muted-foreground gt-label">大小</dt>
                    <dd className="gt-body">{formatBytes(selected.size)}</dd>
                    <dt className="text-muted-foreground gt-label">修改时间</dt>
                    <dd className="gt-body">{formatDate(selected.modifiedAt)}</dd>
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
    </div>
  );
}

function AttachmentTile({
  item,
  selected,
  onSelect,
}: {
  item: AttachmentItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "border-border bg-card min-w-0 overflow-hidden rounded-md border text-left transition-colors",
        selected ? "border-primary ring-primary/20 ring-2" : "hover:bg-accent/40",
      )}
    >
      <div className="bg-muted/60 flex aspect-[4/3] items-center justify-center">
        <KindIcon kind={item.kind} className="text-muted-foreground size-8" />
      </div>
      <div className="p-2">
        <div className="gt-body-strong truncate" title={item.name}>{item.name}</div>
        <div className="text-muted-foreground gt-caption mt-1 flex items-center justify-between gap-2">
          <span>{formatBytes(item.size)}</span>
          <span className="flex items-center gap-1"><Link2 className="size-3" />{item.references.length}</span>
        </div>
      </div>
    </button>
  );
}

function AttachmentRow({
  item,
  selected,
  onSelect,
}: {
  item: AttachmentItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
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
      <span className="text-muted-foreground gt-caption w-16 shrink-0 text-right">{formatBytes(item.size)}</span>
      <span className="text-muted-foreground gt-caption flex w-8 shrink-0 items-center justify-end gap-1">
        <Link2 className="size-3" />{item.references.length}
      </span>
    </button>
  );
}

function PreviewPanel({
  item,
  preview,
  loading,
  error,
}: {
  item: AttachmentItem;
  preview: AttachmentPreview | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="bg-muted/40 border-border flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border">
      {loading ? (
        <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
      ) : error ? (
        <div className="text-muted-foreground gt-caption px-4 text-center">{error}</div>
      ) : !preview ? (
        <KindIcon kind={item.kind} className="text-muted-foreground size-8" />
      ) : item.kind === "image" ? (
        <img src={preview.dataUrl} alt={item.name} className="h-full w-full object-contain" />
      ) : item.kind === "audio" ? (
        <div className="w-full px-4">
          <Music className="text-muted-foreground mx-auto mb-4 size-8" />
          <audio controls preload="metadata" src={preview.dataUrl} />
        </div>
      ) : item.kind === "video" ? (
        <video controls preload="metadata" src={preview.dataUrl} className="h-full w-full object-contain" />
      ) : item.kind === "document" ? (
        <object data={preview.dataUrl} type={preview.mimeType} className="h-full w-full">
          <FileText className="text-muted-foreground size-8" />
        </object>
      ) : (
        <KindIcon kind={item.kind} className="text-muted-foreground size-8" />
      )}
    </div>
  );
}
