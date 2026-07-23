import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CloudUpload, Globe2, Images, LoaderCircle, RefreshCw, ScanSearch } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { DomainTrail } from "@/shared/components/DomainTrail";
import { IconNav } from "@/shared/components/IconNav";
import { ResizeHandle } from "@/shared/components/ResizeHandle";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { PAGE_SIZE } from "./components/Pagination";
import { DomainPanel } from "./features/domains/DomainPanel";
import { buildDomainStats, filterAndSortDomains } from "./features/domains/model";
import { AttachmentMigrationPanel } from "./features/github-images/AttachmentMigrationPanel";
import { GitHubImagePanel } from "./features/github-images/GitHubImagePanel";
import { useMigrationWorkspace } from "./features/github-images/useMigrationWorkspace";
import { AttachmentDetailPanel } from "./features/inventory/AttachmentDetailPanel";
import { ImagePreviewDialog } from "./features/inventory/AttachmentPreview";
import { InventoryPanel } from "./features/inventory/InventoryPanel";
import { InventorySidebar } from "./features/inventory/InventorySidebar";
import {
  countAttachments,
  countLinks,
  filterAndSortAttachments,
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
import type { AttachmentModule } from "./ui-state";
import { useAttachmentControls, useAttachmentUiPersistence } from "./useAttachmentUiState";

const modules = [
  { id: "inventory", name: "扫描盘点", icon: ScanSearch },
  { id: "domains", name: "域名统计", icon: Globe2 },
  { id: "gallery", name: "图库配置", icon: Images },
  { id: "migration", name: "附件迁移", icon: CloudUpload },
];

const EMPTY_ATTACHMENTS: AttachmentItem[] = [];

interface DetailPreviewState {
  key: string;
  preview: AttachmentPreview | null;
  error: string | null;
}

export function App() {
  const [report, setReport] = useState<AttachmentScanReport | null>(null);
  const [detailPreview, setDetailPreview] = useState<DetailPreviewState>({
    key: "",
    preview: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const ui = useAttachmentControls();
  const {
    activeModule, setActiveModule, inventorySelectedPath, setInventorySelectedPath,
    domainSelectedPath, setDomainSelectedPath, query, setQuery, filter, setFilter,
    linkFilter, setLinkFilter, viewMode, setViewMode, sortMode, setSortMode,
    inventoryPage, setInventoryPage, domainQuery, setDomainQuery, domainSort, setDomainSort,
    selectedDomain, setSelectedDomain, domainPage, setDomainPage, domainResourcePage,
    setDomainResourcePage, domainResourceKind, setDomainResourceKind, inventoryWidth,
    setInventoryWidth, detailWidth, setDetailWidth, migrationSelectedTaskId,
    setMigrationSelectedTaskId, migrationSelectedPaths, setMigrationSelectedPaths,
    migrationQuery, setMigrationQuery, migrationExpandedFiles, setMigrationExpandedFiles,
    uiStateHydrated,
  } = ui;
  const filterResetReadyRef = useRef(false);

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
      setInventorySelectedPath((current) => {
        if (current && next.attachments.some((item) => item.path === current)) return current;
        return next.attachments[0]?.path ?? null;
      });
      setDomainSelectedPath((current) => (
        current && next.attachments.some((item) => item.path === current) ? current : null
      ));
    } catch (reason) {
      setReport(null);
      setInventorySelectedPath(null);
      setDomainSelectedPath(null);
      setError(attachmentErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  const migrationWorkspace = useMigrationWorkspace(scan);
  useAttachmentUiPersistence(ui, scan);

  const selectedPath = activeModule === "inventory"
    ? inventorySelectedPath
    : activeModule === "domains"
      ? domainSelectedPath
      : null;

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
    () => countAttachments(attachments),
    [attachments],
  );
  const linkCounts = useMemo(
    () => countLinks(attachments),
    [attachments],
  );
  const domainStats = useMemo(
    () => buildDomainStats(attachments),
    [attachments],
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
    () => filterAndSortAttachments(attachments, filter, linkFilter, query, sortMode),
    [attachments, filter, linkFilter, query, sortMode],
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

  useEffect(() => {
    if (!uiStateHydrated) return;
    if (!filterResetReadyRef.current) {
      filterResetReadyRef.current = true;
      return;
    }
    setInventoryPage(0);
  }, [filter, linkFilter, query, sortMode, uiStateHydrated]);
  useEffect(() => {
    if (activeModule === "inventory" && inventoryPage >= inventoryPageCount) {
      setInventoryPage(inventoryPageCount - 1);
    }
  }, [activeModule, inventoryPage, inventoryPageCount]);

  const selectModule = useCallback((id: string) => {
    const next = id as AttachmentModule;
    setActiveModule(next);
  }, []);

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

  const moduleLabel = activeModule === "inventory"
    ? "扫描盘点"
    : activeModule === "domains"
      ? "域名统计"
      : activeModule === "gallery"
        ? "图库配置"
        : "附件迁移";
  const domainResourceCount = domainStats.reduce((sum, item) => sum + item.total, 0);
  const headerStats = activeModule === "inventory"
    ? [`附件:${attachments.length}`, `笔记:${report?.notesScanned ?? 0}`]
    : activeModule === "domains"
      ? [`域名:${domainStats.length}`, `资源:${domainResourceCount}`]
      : [];
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
          <span className="text-muted-foreground/60 na-body shrink-0">/</span>
          <span className="text-muted-foreground na-body min-w-0 truncate" title={report?.repoPath}>
            {repositoryLabel(report?.repoPath)}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-right">
          <div className="hidden items-center gap-2 md:flex">
            {headerStats.map((stat, index) => (
              <div key={stat} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted-foreground/40 na-caption">/</span>}
                <span className="text-foreground na-caption font-medium">{stat}</span>
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

      {error && activeModule !== "gallery" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center text-center">
            <AlertTriangle className="text-destructive mb-3 size-6" />
            <h2 className="na-title-panel">无法读取附件</h2>
            <p className="text-muted-foreground na-body mt-2 break-words">{error}</p>
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
                onSelect={setInventorySelectedPath}
                onPageChange={setInventoryPage}
              />
            ) : (
              <div className="na-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
                {activeModule === "gallery" ? (
                  <GitHubImagePanel />
                ) : activeModule === "migration" ? (
                  <AttachmentMigrationPanel
                    report={report}
                    workspace={migrationWorkspace}
                    selectedTaskId={migrationSelectedTaskId}
                    onSelectedTaskIdChange={setMigrationSelectedTaskId}
                    selectedPaths={migrationSelectedPaths}
                    onSelectedPathsChange={setMigrationSelectedPaths}
                    query={migrationQuery}
                    onQueryChange={setMigrationQuery}
                    expandedFiles={migrationExpandedFiles}
                    onExpandedFilesChange={setMigrationExpandedFiles}
                    onOpenSettings={() => selectModule("gallery")}
                  />
                ) : loading && !report ? (
                  <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    <span className="na-body">正在扫描附件</span>
                  </div>
                ) : (
                  <DomainPanel
                    domains={visibleDomains}
                    allDomains={domainStats}
                    query={domainQuery}
                    onQueryChange={setDomainQuery}
                    sort={domainSort}
                    onSortChange={setDomainSort}
                    domainPage={domainPage}
                    onDomainPageChange={setDomainPage}
                    resourcePage={domainResourcePage}
                    onResourcePageChange={setDomainResourcePage}
                    resourceKind={domainResourceKind}
                    onResourceKindChange={setDomainResourceKind}
                    selectedDomain={activeDomainStats}
                    selectedPath={selectedPath}
                    onSelectDomain={(domain) => {
                      setSelectedDomain(domain);
                      setDomainSelectedPath(null);
                    }}
                    onClearDomain={() => {
                      setSelectedDomain(null);
                      setDomainSelectedPath(null);
                    }}
                    onSelectAttachment={setDomainSelectedPath}
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
              onClose={() => {
                if (activeModule === "inventory") setInventorySelectedPath(null);
                if (activeModule === "domains") setDomainSelectedPath(null);
              }}
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
