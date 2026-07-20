import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FolderOpen,
  Globe2,
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
  Video,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { DomainTrail } from "@/components/DomainTrail";
import { IconNav } from "@/components/IconNav";
import { Input } from "@/components/ui/input";
import { ResizeHandle } from "@/components/ResizeHandle";
import { cn } from "@/lib/utils";

import { markPluginReady } from "./bridge";
import type {
  AttachmentItem,
  AttachmentKind,
  LinkKind,
  AttachmentPreview,
  AttachmentScanReport,
  WorkspaceInfo,
} from "./types";

type Filter = "all" | "orphan" | AttachmentKind;
type LinkFilter = "all" | LinkKind;
type Module = "inventory" | "domains";
type ViewMode = "grid" | "list";
type SortMode = "name" | "size" | "references";
type DomainSort = "resources" | "images" | "references" | "notes";

const filters: { id: Filter; label: string; icon: typeof File }[] = [
  { id: "all", label: "全部附件", icon: HardDrive },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "audio", label: "音频", icon: Music },
  { id: "link", label: "链接", icon: Link2 },
  { id: "orphan", label: "孤立附件", icon: Unlink },
];

const modules = [
  { id: "inventory", name: "扫描盘点", icon: ScanSearch },
  { id: "domains", name: "域名统计", icon: Globe2 },
];

const linkFilters: { id: LinkFilter; label: string }[] = [
  { id: "all", label: "全部链接" },
  { id: "image", label: "图片链接" },
  { id: "audio", label: "音频链接" },
  { id: "video", label: "视频链接" },
  { id: "website", label: "网站" },
  { id: "download", label: "下载" },
  { id: "unknown", label: "未知" },
];

const MAX_PREVIEW_CACHE_ITEMS = 80;
const PAGE_SIZE = 100;
const compactSelectClass = "border-input bg-background gt-body h-7 shrink-0 rounded-md border px-2 outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const previewCache = new Map<string, AttachmentPreview>();
const previewRequests = new Map<string, Promise<AttachmentPreview>>();

const kindLabels: Record<AttachmentKind, string> = {
  image: "图片",
  audio: "音频",
  link: "链接",
};

const linkKindLabels: Record<LinkKind, string> = {
  image: "图片链接",
  audio: "音频链接",
  video: "视频链接",
  website: "网站",
  download: "下载链接",
  unknown: "未知链接",
};

const referenceRoleLabels = {
  embed: "嵌入资源",
  navigation: "导航链接",
} as const;

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

function repositoryLabel(path: string | undefined): string {
  if (!path) return "当前仓库";
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "audio" ? Music : Link2;
  return <Icon className={className} />;
}

function AttachmentIcon({ item, className }: { item: AttachmentItem; className?: string }) {
  if (item.kind !== "link") return <KindIcon kind={item.kind} className={className} />;
  const Icon = item.linkKind === "image"
    ? ImageIcon
    : item.linkKind === "audio"
      ? Music
      : item.linkKind === "video"
        ? Video
        : item.linkKind === "website"
          ? Globe2
          : item.linkKind === "download"
            ? Download
            : CircleHelp;
  return <Icon className={className} />;
}

function attachmentTypeLabel(item: AttachmentItem): string {
  if (item.kind !== "link") return kindLabels[item.kind];
  return item.linkKind ? linkKindLabels[item.linkKind] : "未知链接";
}

function canPreviewAttachment(item: AttachmentItem): boolean {
  if (item.kind !== "link") return true;
  return item.linkKind === "image" || item.linkKind === "audio";
}

function canPreviewImage(item: AttachmentItem, mimeType = item.mimeType): boolean {
  return item.kind === "image" || item.linkKind === "image" || mimeType.startsWith("image/");
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

interface DomainStats {
  domain: string;
  items: AttachmentItem[];
  total: number;
  image: number;
  audio: number;
  video: number;
  website: number;
  download: number;
  unknown: number;
  references: number;
  uniqueNotes: number;
  embed: number;
  navigation: number;
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
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [inventoryPage, setInventoryPage] = useState(0);
  const [activeModule, setActiveModule] = useState<Module>("inventory");
  const [domainQuery, setDomainQuery] = useState("");
  const [domainSort, setDomainSort] = useState<DomainSort>("resources");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inventoryWidth, setInventoryWidth] = useState(208);
  const [detailWidth, setDetailWidth] = useState(320);
  const initialLoad = useRef(false);
  const activeModuleRef = useRef<Module>("inventory");

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
      if (activeModuleRef.current !== "inventory") {
        setSelectedPath(null);
        return;
      }
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
    if (!selected || !report || !canPreviewAttachment(selected)) return;
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
    if (activeModule !== "inventory") return result;
    for (const item of report?.attachments ?? []) {
      result[item.kind] += 1;
      if (item.references.length === 0) result.orphan += 1;
    }
    return result;
  }, [activeModule, report]);

  const linkCounts = useMemo(() => {
    const result: Record<LinkFilter, number> = {
      all: 0,
      image: 0,
      audio: 0,
      video: 0,
      website: 0,
      download: 0,
      unknown: 0,
    };
    if (activeModule !== "inventory") return result;
    for (const item of report?.attachments ?? []) {
      if (item.kind !== "link") continue;
      result.all += 1;
      result[item.linkKind ?? "unknown"] += 1;
    }
    return result;
  }, [activeModule, report]);

  const domainStats = useMemo(() => {
    if (activeModule !== "domains") return [];
    const groups = new Map<string, { items: AttachmentItem[]; notes: Set<string> }>();
    for (const item of report?.attachments ?? []) {
      if (item.kind !== "link" || !item.domain) continue;
      const current = groups.get(item.domain) ?? { items: [], notes: new Set<string>() };
      current.items.push(item);
      for (const reference of item.references) current.notes.add(reference.notePath);
      groups.set(item.domain, current);
    }

    return [...groups.entries()].map(([domain, group]): DomainStats => {
      const result: DomainStats = {
        domain,
        items: group.items,
        total: group.items.length,
        image: 0,
        audio: 0,
        video: 0,
        website: 0,
        download: 0,
        unknown: 0,
        references: 0,
        uniqueNotes: group.notes.size,
        embed: 0,
        navigation: 0,
      };
      for (const item of group.items) {
        const kind = item.linkKind ?? "unknown";
        result[kind] += 1;
        result.references += item.references.length;
        for (const reference of item.references) {
          if (reference.role === "embed") result.embed += 1;
          if (reference.role === "navigation") result.navigation += 1;
        }
      }
      return result;
    });
  }, [activeModule, report]);

  const visibleDomains = useMemo(() => {
    if (activeModule !== "domains") return [];
    const needle = domainQuery.trim().toLocaleLowerCase();
    const matches = needle
      ? domainStats.filter((item) => item.domain.toLocaleLowerCase().includes(needle))
      : [...domainStats];
    return matches.sort((left, right) => {
      const difference = domainSort === "images"
        ? right.image - left.image
        : domainSort === "references"
          ? right.references - left.references
          : domainSort === "notes"
            ? right.uniqueNotes - left.uniqueNotes
            : right.total - left.total;
      return difference || left.domain.localeCompare(right.domain);
    });
  }, [activeModule, domainQuery, domainSort, domainStats]);

  const activeDomainStats = useMemo(
    () => domainStats.find((item) => item.domain === selectedDomain) ?? null,
    [domainStats, selectedDomain],
  );

  useEffect(() => {
    if (selectedDomain && !domainStats.some((item) => item.domain === selectedDomain)) {
      setSelectedDomain(null);
    }
  }, [domainStats, selectedDomain]);

  const visibleAttachments = useMemo(() => {
    if (activeModule !== "inventory") return [];
    const needle = query.trim().toLocaleLowerCase();
    const items = (report?.attachments ?? []).filter((item) => {
      const filterMatches = filter === "all"
        || (filter === "orphan" ? item.references.length === 0 : item.kind === filter);
      const linkFilterMatches = filter !== "link"
        || linkFilter === "all"
        || (item.linkKind ?? "unknown") === linkFilter;
      const queryMatches = !needle
        || item.name.toLocaleLowerCase().includes(needle)
        || item.path.toLocaleLowerCase().includes(needle)
        || item.url?.toLocaleLowerCase().includes(needle)
        || item.domain?.toLocaleLowerCase().includes(needle);
      return filterMatches && linkFilterMatches && queryMatches;
    });
    return [...items].sort((left, right) => {
      if (sortMode === "size") return right.size - left.size || left.path.localeCompare(right.path);
      if (sortMode === "references") {
        return right.references.length - left.references.length || left.path.localeCompare(right.path);
      }
      return left.name.localeCompare(right.name, "zh-CN") || left.path.localeCompare(right.path);
    });
  }, [activeModule, filter, linkFilter, query, report, sortMode]);

  const inventoryPageCount = Math.max(1, Math.ceil(visibleAttachments.length / PAGE_SIZE));
  const pagedAttachments = visibleAttachments.slice(
    inventoryPage * PAGE_SIZE,
    (inventoryPage + 1) * PAGE_SIZE,
  );

  useEffect(() => {
    setInventoryPage(0);
  }, [filter, linkFilter, query, report, sortMode]);

  useEffect(() => {
    if (inventoryPage >= inventoryPageCount) setInventoryPage(inventoryPageCount - 1);
  }, [inventoryPage, inventoryPageCount]);

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
    activeModuleRef.current = next;
    setActiveModule(next);
    setSelectedDomain(null);
    if (next === "domains") {
      setSelectedPath(null);
    } else {
      setSelectedPath((current) => current ?? report?.attachments[0]?.path ?? null);
    }
  }, [report]);

  const resizeInventory = useCallback((value: number) => {
    const available = window.innerWidth - detailWidth - 40 - 360;
    setInventoryWidth(Math.min(value, 320, Math.max(160, available)));
  }, [detailWidth]);

  const resizeDetail = useCallback((value: number) => {
    const visibleInventoryWidth = window.innerWidth > 900 && activeModule === "inventory"
      ? inventoryWidth
      : 0;
    const available = window.innerWidth - visibleInventoryWidth - 40 - 360;
    setDetailWidth(Math.min(value, 480, Math.max(240, available)));
  }, [activeModule, inventoryWidth]);

  const moduleLabel = activeModule === "inventory" ? "扫描盘点" : "域名统计";
  const domainResourceCount = domainStats.reduce((sum, item) => sum + item.total, 0);
  const headerStats = activeModule === "inventory"
    ? [`附件:${report?.attachments.length ?? 0}`, `笔记:${report?.notesScanned ?? 0}`]
    : [`域名:${domainStats.length}`, `资源:${domainResourceCount}`];
  const trailItems = [
    { id: "attachments", label: "附件" },
    { id: activeModule, label: moduleLabel },
  ];

  const selectedPreviewKey = selected && report ? previewKey(report.repoPath, selected) : "";
  const selectedCachedPreview = selectedPreviewKey ? previewCache.get(selectedPreviewKey) ?? null : null;
  const selectedPreview = selectedCachedPreview
    ?? (detailPreview.key === selectedPreviewKey ? detailPreview.preview : null);
  const selectedPreviewError = detailPreview.key === selectedPreviewKey ? detailPreview.error : null;
  const selectedPreviewLoading = Boolean(selected && canPreviewAttachment(selected))
    && !selectedPreview
    && !selectedPreviewError;

  return (
    <div className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DomainTrail items={trailItems} />
          <span className="text-muted-foreground/60 gt-body shrink-0">/</span>
          <span className="text-muted-foreground gt-body min-w-0 truncate" title={report?.repoPath}>
            {repositoryLabel(report?.repoPath)}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-right">
          <div className="hidden items-center gap-2 md:flex">
            {headerStats.map((stat, index) => (
              <div key={stat} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted-foreground/40 gt-caption">/</span>}
                <span className="text-foreground gt-caption font-medium">{stat}</span>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-1 size-7"
            onClick={() => void scan()}
            disabled={loading}
            title="重新扫描"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
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
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <aside className="border-border/50 flex w-10 shrink-0 flex-col items-center border-r py-2">
            <IconNav items={modules} activeId={activeModule} onSelect={selectModule} size="sm" />
          </aside>

          {activeModule === "inventory" && (
          <aside
            className="border-border/50 flex min-h-0 shrink-0 flex-col border-r max-[900px]:hidden"
            style={{ width: inventoryWidth }}
          >
            <div className="border-border/30 gt-title-section flex h-10 shrink-0 items-center border-b px-3">
              附件类型
            </div>
            <nav className="space-y-0.5 p-1">
              {filters.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setFilter(item.id);
                      if (item.id !== "link") setLinkFilter("all");
                    }}
                    aria-current={filter === item.id ? "page" : undefined}
                    className={cn(
                      "gt-body flex h-8 w-full items-center gap-2 rounded-md px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      filter === item.id
                        ? "bg-primary/8 text-foreground"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", filter === item.id && "text-primary")} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="gt-caption tabular-nums">{counts[item.id]}</span>
                  </button>
                );
              })}
            </nav>
            {report && (
              <dl className="border-border/30 text-muted-foreground gt-caption mt-auto space-y-1 border-t px-3 py-2">
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
              onResize={resizeInventory}
              minSize={160}
              snapTo={208}
              ariaLabel="调整类型栏宽度"
              className="max-[900px]:hidden"
            />
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {activeModule === "inventory" && (
            <div className="border-border/50 flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-2">
              <div className="relative min-w-0 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称或路径"
                  className="h-7 pl-8"
                />
              </div>
              {filter === "link" && (
                <select
                  value={linkFilter}
                  onChange={(event) => setLinkFilter(event.target.value as LinkFilter)}
                  className={cn(compactSelectClass, "max-w-32")}
                  aria-label="链接分类"
                >
                  {linkFilters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} ({linkCounts[item.id]})
                    </option>
                  ))}
                </select>
              )}
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className={compactSelectClass}
                aria-label="排序方式"
              >
                <option value="name">名称</option>
                <option value="size">大小</option>
                <option value="references">引用</option>
              </select>
              <div className="border-border bg-muted/30 flex h-7 shrink-0 items-center rounded-md border p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  aria-pressed={viewMode === "grid"}
                  className={cn("flex size-6 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", viewMode === "grid" && "bg-background text-foreground shadow-sm")}
                  title="网格视图"
                >
                  <Grid2X2 className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                  className={cn("flex size-6 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", viewMode === "list" && "bg-background text-foreground shadow-sm")}
                  title="列表视图"
                >
                  <List className="size-4" />
                </button>
              </div>
              <span className="text-muted-foreground gt-caption hidden shrink-0 lg:inline">
                {loading ? "正在扫描" : `${visibleAttachments.length} 项 · ${formatBytes(report?.totalSize ?? 0)}`}
                {!loading && report && report.skippedEntries > 0 ? ` · 跳过 ${report.skippedEntries}` : ""}
              </span>
            </div>
            )}

            <div className="gt-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
              {loading && !report ? (
                <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" />
                  <span className="gt-body">正在扫描附件</span>
                </div>
              ) : activeModule === "domains" ? (
                <DomainPanel
                  domains={visibleDomains}
                  allDomains={domainStats}
                  query={domainQuery}
                  onQueryChange={setDomainQuery}
                  sort={domainSort}
                  onSortChange={setDomainSort}
                  selectedDomain={activeDomainStats}
                  selectedPath={selectedPath}
                  onSelectDomain={(domain) => {
                    setSelectedDomain(domain);
                    setSelectedPath(null);
                  }}
                  onClearDomain={() => {
                    setSelectedDomain(null);
                    setSelectedPath(null);
                  }}
                  onSelectAttachment={selectAttachment}
                />
              ) : visibleAttachments.length === 0 ? (
                <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-center">
                  <File className="mb-3 size-7" />
                  <span className="gt-body">没有匹配的附件</span>
                </div>
              ) : viewMode === "grid" ? (
                <>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                    {pagedAttachments.map((item) => (
                      <AttachmentTile
                        key={item.path}
                        item={item}
                        repoPath={report?.repoPath ?? ""}
                        selected={item.path === selectedPath}
                        onSelect={selectAttachment}
                      />
                    ))}
                  </div>
                  <Pagination
                    page={inventoryPage}
                    pageCount={inventoryPageCount}
                    total={visibleAttachments.length}
                    onPageChange={setInventoryPage}
                  />
                </>
              ) : (
                <>
                  <div className="divide-border divide-y">
                    {pagedAttachments.map((item) => (
                      <AttachmentRow
                        key={item.path}
                        item={item}
                        selected={item.path === selectedPath}
                        onSelect={selectAttachment}
                      />
                    ))}
                  </div>
                  <Pagination
                    page={inventoryPage}
                    pageCount={inventoryPageCount}
                    total={visibleAttachments.length}
                    onPageChange={setInventoryPage}
                  />
                </>
              )}
            </div>
          </main>

          {selected && (
            <>
              <ResizeHandle
                direction="horizontal"
                edge="start"
                size={detailWidth}
                onResize={resizeDetail}
                minSize={240}
                snapTo={320}
                ariaLabel="调整详情栏宽度"
                className="max-[720px]:hidden"
              />
              <aside
                className="border-border/50 bg-background flex min-h-0 shrink-0 flex-col border-l max-[720px]:absolute max-[720px]:inset-y-0 max-[720px]:left-10 max-[720px]:z-20 max-[720px]:w-[calc(100%-2.5rem)]"
                style={{ width: `min(${detailWidth}px, calc(100vw - 2.5rem))` }}
              >
                <div className="border-border/50 flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-1 size-7 min-[721px]:hidden"
                    onClick={() => setSelectedPath(null)}
                    title="返回附件列表"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <h2 className="gt-title-panel min-w-0 truncate" title={selected.name}>{selected.name}</h2>
                  <div className="flex shrink-0 items-center gap-1">
                    {selected.kind !== "link" && (
                      <Button variant="ghost" size="icon" className="size-7" onClick={revealSelected} title="在文件管理器中显示">
                        <FolderOpen className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={openSelected}
                      title={selected.kind === "link" ? "在浏览器中打开" : "使用系统应用打开"}
                    >
                      {selected.kind === "link" ? <Link2 className="size-4" /> : <File className="size-4" />}
                    </Button>
                  </div>
                </div>
                <div className="gt-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
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
                      {attachmentTypeLabel(selected)}{selected.extension ? ` · ${selected.extension.toUpperCase()}` : ""}
                    </dd>
                    {selected.kind === "link" && (
                      <>
                        <dt className="text-muted-foreground gt-label">域名</dt>
                        <dd className="gt-body break-all">{selected.domain ?? "未知"}</dd>
                      </>
                    )}
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
                      <div className="divide-border/20 divide-y">
                        {selected.references.map((reference) => (
                          <div key={`${reference.notePath}:${reference.line}:${reference.role ?? "unknown"}`} className="px-1 py-2">
                            <div className="gt-body-strong truncate" title={reference.notePath}>{reference.notePath}</div>
                            <div className="text-muted-foreground gt-caption flex justify-between gap-2">
                              <span>第 {reference.line} 行</span>
                              <span>{reference.role ? referenceRoleLabels[reference.role] : "引用"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            </>
          )}
        </div>
      )}
      {previewOpen && selected && canPreviewImage(selected, selectedPreview?.mimeType) && selectedPreview && (
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
            variant="ghost"
            size="icon"
            autoFocus
            className="bg-background/90 text-foreground absolute right-4 top-4 shadow-sm"
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

function DomainPanel({
  domains,
  allDomains,
  query,
  onQueryChange,
  sort,
  onSortChange,
  selectedDomain,
  selectedPath,
  onSelectDomain,
  onClearDomain,
  onSelectAttachment,
}: {
  domains: DomainStats[];
  allDomains: DomainStats[];
  query: string;
  onQueryChange: (value: string) => void;
  sort: DomainSort;
  onSortChange: (value: DomainSort) => void;
  selectedDomain: DomainStats | null;
  selectedPath: string | null;
  onSelectDomain: (domain: string) => void;
  onClearDomain: () => void;
  onSelectAttachment: (path: string) => void;
}) {
  const [domainPage, setDomainPage] = useState(0);
  const [resourcePage, setResourcePage] = useState(0);
  const [resourceKind, setResourceKind] = useState<LinkFilter>("all");
  const domainPageCount = Math.max(1, Math.ceil(domains.length / PAGE_SIZE));
  const pagedDomains = domains.slice(domainPage * PAGE_SIZE, (domainPage + 1) * PAGE_SIZE);
  const domainResources = selectedDomain?.items.filter((item) => (
    resourceKind === "all" || (item.linkKind ?? "unknown") === resourceKind
  )) ?? [];
  const resourcePageCount = Math.max(1, Math.ceil(domainResources.length / PAGE_SIZE));
  const pagedResources = domainResources.slice(resourcePage * PAGE_SIZE, (resourcePage + 1) * PAGE_SIZE);
  const domainCount = allDomains.length;
  const remoteResourceCount = allDomains.reduce((sum, item) => sum + item.total, 0);
  const imageLinkCount = allDomains.reduce((sum, item) => sum + item.image, 0);
  const referenceCount = allDomains.reduce((sum, item) => sum + item.references, 0);

  useEffect(() => setDomainPage(0), [query]);
  useEffect(() => {
    setResourcePage(0);
    setResourceKind("all");
  }, [selectedDomain?.domain]);
  useEffect(() => {
    if (domainPage >= domainPageCount) setDomainPage(domainPageCount - 1);
  }, [domainPage, domainPageCount]);
  useEffect(() => {
    if (resourcePage >= resourcePageCount) setResourcePage(resourcePageCount - 1);
  }, [resourcePage, resourcePageCount]);

  if (selectedDomain) {
    return (
      <div className="min-w-0">
        <div className="border-border/50 -mx-3 -mt-3 mb-2 flex min-h-11 min-w-0 items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="icon" className="size-7" onClick={onClearDomain} title="返回全部域名">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="gt-title-panel truncate" title={selectedDomain.domain}>{selectedDomain.domain}</h2>
            <p className="text-muted-foreground gt-caption mt-0.5">
              {selectedDomain.total} 个资源 · {selectedDomain.references} 次引用 · {selectedDomain.uniqueNotes} 篇笔记
              {` · 嵌入 ${selectedDomain.embed} · 导航 ${selectedDomain.navigation}`}
            </p>
          </div>
          <select
            value={resourceKind}
            onChange={(event) => {
              setResourceKind(event.target.value as LinkFilter);
              setResourcePage(0);
            }}
            className={cn(compactSelectClass, "max-w-28")}
            aria-label="资源类型"
          >
            {linkFilters.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        {pagedResources.length === 0 ? (
          <div className="text-muted-foreground flex min-h-40 items-center justify-center gt-body">没有匹配的资源</div>
        ) : (
        <div className="divide-border divide-y">
          {pagedResources.map((item) => (
            <AttachmentRow
              key={item.path}
              item={item}
              selected={item.path === selectedPath}
              onSelect={onSelectAttachment}
            />
          ))}
        </div>
        )}
        <Pagination
          page={resourcePage}
          pageCount={resourcePageCount}
          total={domainResources.length}
          onPageChange={setResourcePage}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="border-border/50 -mx-3 -mt-3 mb-3 flex min-h-11 min-w-0 items-center gap-2 border-b px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索域名"
            className="h-7 pl-8"
          />
        </div>
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as DomainSort)}
          className={compactSelectClass}
          aria-label="域名排序"
        >
          <option value="resources">按资源数</option>
          <option value="images">按图片数</option>
          <option value="references">按引用数</option>
          <option value="notes">按笔记数</option>
        </select>
        <span className="text-muted-foreground gt-caption hidden shrink-0 lg:inline">
          域名 {domainCount} / 资源 {remoteResourceCount} / 图片 {imageLinkCount} / 引用 {referenceCount}
        </span>
      </div>
      {domains.length === 0 ? (
        <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center text-center">
          <Globe2 className="mb-3 size-7" />
          <span className="gt-body">{domainCount === 0 ? "没有可统计的链接域名" : "没有匹配的域名"}</span>
        </div>
      ) : (
        <div className="border-border/50 min-w-0 overflow-x-auto border">
          <div className="border-border/50 bg-muted/20 text-muted-foreground gt-label sticky top-0 grid min-w-[700px] grid-cols-[minmax(180px,1fr)_64px_repeat(6,52px)_64px_64px] items-center gap-2 border-b px-2 py-2">
            <span>域名</span>
            <span className="text-right">资源</span>
            <span className="text-right">图片</span>
            <span className="text-right">音频</span>
            <span className="text-right">视频</span>
            <span className="text-right">网站</span>
            <span className="text-right">下载</span>
            <span className="text-right">未知</span>
            <span className="text-right">引用</span>
            <span className="text-right">笔记</span>
          </div>
          <div className="divide-border/20 divide-y">
            {pagedDomains.map((item) => (
              <button
                key={item.domain}
                type="button"
                onClick={() => onSelectDomain(item.domain)}
                className="hover:bg-accent/40 gt-caption grid h-10 w-full min-w-[700px] grid-cols-[minmax(180px,1fr)_64px_repeat(6,52px)_64px_64px] items-center gap-2 px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span className="gt-body-strong flex min-w-0 items-center gap-2 truncate" title={item.domain}>
                  <Globe2 className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{item.domain}</span>
                </span>
                <span className="text-right tabular-nums">{item.total}</span>
                <span className="text-right tabular-nums">{item.image}</span>
                <span className="text-right tabular-nums">{item.audio}</span>
                <span className="text-right tabular-nums">{item.video}</span>
                <span className="text-right tabular-nums">{item.website}</span>
                <span className="text-right tabular-nums">{item.download}</span>
                <span className="text-right tabular-nums">{item.unknown}</span>
                <span className="text-right tabular-nums">{item.references}</span>
                <span className="text-right tabular-nums">{item.uniqueNotes}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Pagination
        page={domainPage}
        pageCount={domainPageCount}
        total={domains.length}
        onPageChange={setDomainPage}
      />
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-end gap-1">
      <span className="text-muted-foreground gt-caption mr-2">{total} 项 · {page + 1}/{pageCount}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
        title="上一页"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
        title="下一页"
      >
        <ChevronRight className="size-4" />
      </Button>
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
  const canPreview = canPreviewImage(item);

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
      aria-pressed={selected}
      className={cn(
        "border-border/60 bg-card min-w-0 overflow-hidden rounded-md border text-left transition-colors [contain:layout_paint] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected ? "border-primary/40 bg-primary/5" : "hover:bg-accent/40",
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
          <AttachmentIcon item={item} className="text-muted-foreground size-8" />
        )}
      </div>
      <div className="pointer-events-none p-2">
        <div className="gt-body-strong truncate" title={item.name}>{item.name}</div>
        <div className="text-muted-foreground gt-caption mt-1 flex items-center justify-between gap-2">
          <span
            className="truncate"
            title={item.kind === "link" ? [attachmentTypeLabel(item), item.domain].filter(Boolean).join(" · ") : undefined}
          >
            {item.kind === "link"
              ? [attachmentTypeLabel(item), item.domain].filter(Boolean).join(" · ")
              : formatBytes(item.size)}
          </span>
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
      aria-pressed={selected}
      className={cn(
        "flex min-h-10 w-full min-w-0 items-center gap-3 px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
        selected ? "bg-primary/8 text-foreground" : "hover:bg-accent/40",
      )}
    >
      <AttachmentIcon item={item} className={cn("text-muted-foreground size-4 shrink-0", selected && "text-primary")} />
      <span className="min-w-0 flex-1">
        <span className="gt-body-strong block truncate">{item.name}</span>
        <span className="text-muted-foreground gt-caption block truncate">
          {item.kind === "link"
            ? [attachmentTypeLabel(item), item.domain].filter(Boolean).join(" · ")
            : item.path}
        </span>
      </span>
      <span className="text-muted-foreground gt-caption w-16 shrink-0 text-right">
        {item.kind === "link" ? attachmentTypeLabel(item) : formatBytes(item.size)}
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
        <AttachmentIcon item={item} className="text-muted-foreground size-8" />
      ) : preview.mimeType.startsWith("audio/") ? (
        <AsyncPreviewAudio src={preview.dataUrl} />
      ) : canPreviewImage(item, preview.mimeType) ? (
        <AsyncPreviewImage
          key={preview.dataUrl}
          src={preview.dataUrl}
          alt={item.name}
          fallbackKind={item.kind}
          onExpand={onExpand}
        />
      ) : item.kind === "link" ? (
        <div className="text-muted-foreground gt-caption flex flex-col items-center gap-2 px-4 text-center">
          <AttachmentIcon item={item} className="size-8" />
          <span>此链接没有可内嵌的媒体预览</span>
        </div>
      ) : (
        <AttachmentIcon item={item} className="text-muted-foreground size-8" />
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
          referrerPolicy="no-referrer"
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
          className="group absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
          onClick={onExpand}
          title="放大预览"
        >
          <span className="bg-background/90 absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
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
