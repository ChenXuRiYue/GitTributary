import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Globe2, LoaderCircle, RefreshCw, ScanSearch } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { DomainTrail } from "@/shared/components/DomainTrail";
import { IconNav } from "@/shared/components/IconNav";
import { ResizeHandle } from "@/shared/components/ResizeHandle";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { markPluginReady } from "./bridge";
import { PAGE_SIZE } from "./components/Pagination";
import { DomainPanel } from "./features/domains/DomainPanel";
import {
  buildDomainStats,
  filterAndSortDomains,
  type DomainSort,
} from "./features/domains/model";
import { AttachmentDetailPanel } from "./features/inventory/AttachmentDetailPanel";
import { ImagePreviewDialog } from "./features/inventory/AttachmentPreview";
import { InventoryPanel } from "./features/inventory/InventoryPanel";
import { InventorySidebar } from "./features/inventory/InventorySidebar";
import {
  countAttachments,
  countLinks,
  filterAndSortAttachments,
  type Filter,
  type LinkFilter,
  type SortMode,
  type ViewMode,
} from "./features/inventory/model";
import {
  attachmentErrorMessage,
  canPreviewAttachment,
  canPreviewImage,
  repositoryLabel,
} from "./lib/attachment";
import {
  getCachedAttachmentPreview,
  loadAttachmentPreview,
  previewKey,
} from "./lib/preview-cache";
import type {
  AttachmentItem,
  AttachmentPreview,
  AttachmentScanReport,
  WorkspaceInfo,
} from "./types";

type Module = "inventory" | "domains";

const modules = [
  { id: "inventory", name: "扫描盘点", icon: ScanSearch },
  { id: "domains", name: "域名统计", icon: Globe2 },
];

const EMPTY_ATTACHMENTS: AttachmentItem[] = [];

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
  const [activeModule, setActiveModule] = useState<Module>("inventory");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [inventoryPage, setInventoryPage] = useState(0);
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
      setError(attachmentErrorMessage(reason));
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
    if (getCachedAttachmentPreview(key)) return;

    void loadAttachmentPreview(report.repoPath, selected).then((preview) => {
      if (!cancelled) setDetailPreview({ key, preview, error: null });
    }).catch((reason) => {
      if (!cancelled) {
        setDetailPreview({ key, preview: null, error: attachmentErrorMessage(reason) });
      }
    });
    return () => { cancelled = true; };
  }, [report, selected]);

  useEffect(() => setPreviewOpen(false), [selectedPath]);

  const attachments = report?.attachments ?? EMPTY_ATTACHMENTS;
  const counts = useMemo(
    () => countAttachments(activeModule === "inventory" ? attachments : EMPTY_ATTACHMENTS),
    [activeModule, attachments],
  );
  const linkCounts = useMemo(
    () => countLinks(activeModule === "inventory" ? attachments : EMPTY_ATTACHMENTS),
    [activeModule, attachments],
  );
  const domainStats = useMemo(
    () => activeModule === "domains" ? buildDomainStats(attachments) : [],
    [activeModule, attachments],
  );
  const visibleDomains = useMemo(
    () => filterAndSortDomains(domainStats, domainQuery, domainSort),
    [domainQuery, domainSort, domainStats],
  );
  const activeDomainStats = useMemo(
    () => domainStats.find((item) => item.domain === selectedDomain) ?? null,
    [domainStats, selectedDomain],
  );
  const visibleAttachments = useMemo(
    () => activeModule === "inventory"
      ? filterAndSortAttachments(attachments, filter, linkFilter, query, sortMode)
      : [],
    [activeModule, attachments, filter, linkFilter, query, sortMode],
  );

  useEffect(() => {
    if (selectedDomain && !domainStats.some((item) => item.domain === selectedDomain)) {
      setSelectedDomain(null);
    }
  }, [domainStats, selectedDomain]);

  const inventoryPageCount = Math.max(1, Math.ceil(visibleAttachments.length / PAGE_SIZE));
  const pagedAttachments = visibleAttachments.slice(
    inventoryPage * PAGE_SIZE,
    (inventoryPage + 1) * PAGE_SIZE,
  );

  useEffect(() => setInventoryPage(0), [filter, linkFilter, query, report, sortMode]);
  useEffect(() => {
    if (inventoryPage >= inventoryPageCount) setInventoryPage(inventoryPageCount - 1);
  }, [inventoryPage, inventoryPageCount]);

  const selectModule = useCallback((id: string) => {
    const next = id as Module;
    activeModuleRef.current = next;
    setActiveModule(next);
    setSelectedDomain(null);
    if (next !== "inventory") {
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
    ? [`附件:${attachments.length}`, `笔记:${report?.notesScanned ?? 0}`]
    : [`域名:${domainStats.length}`, `资源:${domainResourceCount}`];
  const trailItems = [
    { id: "attachments", label: "附件" },
    { id: activeModule, label: moduleLabel },
  ];

  const selectedPreviewKey = selected && report ? previewKey(report.repoPath, selected) : "";
  const selectedPreview = (selectedPreviewKey ? getCachedAttachmentPreview(selectedPreviewKey) : null)
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
            <>
              <InventorySidebar
                report={report}
                filter={filter}
                counts={counts}
                width={inventoryWidth}
                onFilterChange={(next) => {
                  setFilter(next);
                  if (next !== "link") setLinkFilter("all");
                }}
              />
              <ResizeHandle
                direction="horizontal"
                size={inventoryWidth}
                onResize={resizeInventory}
                minSize={160}
                snapTo={208}
                ariaLabel="调整类型栏宽度"
                className="max-[900px]:hidden"
              />
            </>
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {activeModule === "inventory" ? (
              <InventoryPanel
                report={report}
                loading={loading}
                filter={filter}
                linkFilter={linkFilter}
                linkCounts={linkCounts}
                query={query}
                sort={sortMode}
                view={viewMode}
                items={pagedAttachments}
                totalItems={visibleAttachments.length}
                selectedPath={selectedPath}
                page={inventoryPage}
                pageCount={inventoryPageCount}
                onQueryChange={setQuery}
                onLinkFilterChange={setLinkFilter}
                onSortChange={setSortMode}
                onViewChange={setViewMode}
                onSelect={setSelectedPath}
                onPageChange={setInventoryPage}
              />
            ) : (
              <div className="gt-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
                {loading && !report ? (
                  <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    <span className="gt-body">正在扫描附件</span>
                  </div>
                ) : (
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
                    onSelectAttachment={setSelectedPath}
                  />
                )}
              </div>
            )}
          </main>

          {selected && report && (
            <AttachmentDetailPanel
              item={selected}
              repoPath={report.repoPath}
              preview={selectedPreview}
              previewLoading={selectedPreviewLoading}
              previewError={selectedPreviewError}
              width={detailWidth}
              onResize={resizeDetail}
              onClose={() => setSelectedPath(null)}
              onExpand={() => setPreviewOpen(true)}
            />
          )}
        </div>
      )}

      {previewOpen && selected && selectedPreview && canPreviewImage(selected, selectedPreview.mimeType) && (
        <ImagePreviewDialog
          item={selected}
          preview={selectedPreview}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
