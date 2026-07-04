import { FolderTree, List, Save, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { CaptureListItem, CapturePreviewTree, CaptureTree } from "../capture";
import type { CaptureFilterState, CaptureTreeNode, CaptureViewMode, SitePathCandidate, SiteScanReport } from "../types";

/** 候选项超过该数量时才显示搜索框，避免小列表上无意义的筛选噪音。 */
const CAPTURE_SEARCH_THRESHOLD = 20;

export function CapturePanel({
  scanReport,
  captureTree,
  selectedCaptureTree,
  captureList,
  captureViewMode,
  filters,
  totalCount,
  filteredCount,
  selectedPaths,
  openCapturePaths,
  selectedCount,
  selectedMarkdownCount,
  allCapturedSelected,
  dirty,
  onSave,
  onViewModeChange,
  onSelectDefaults,
  onToggleAll,
  onToggleOpen,
  onToggleCandidate,
  onToggleGroup,
  onFiltersChange,
}: {
  scanReport: SiteScanReport | null;
  captureTree: CaptureTreeNode[];
  selectedCaptureTree: CaptureTreeNode[];
  captureList: SitePathCandidate[];
  captureViewMode: CaptureViewMode;
  filters: CaptureFilterState;
  totalCount: number;
  filteredCount: number;
  selectedPaths: Set<string>;
  openCapturePaths: Set<string>;
  selectedCount: number;
  selectedMarkdownCount: number;
  allCapturedSelected: boolean;
  dirty: boolean;
  onSave: () => void;
  onViewModeChange: (mode: CaptureViewMode) => void;
  onSelectDefaults: () => void;
  onToggleAll: () => void;
  onToggleOpen: (path: string) => void;
  onToggleCandidate: (path: string) => void;
  onToggleGroup: (paths: string[]) => void;
  onFiltersChange: (filters: CaptureFilterState) => void;
}) {
  const showSearch = totalCount > CAPTURE_SEARCH_THRESHOLD;

  const updateFilters = (patch: Partial<CaptureFilterState>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="gt-title-panel">文档范围</div>
            {dirty && <Badge variant="outline" className="h-5 px-1.5 gt-caption text-amber-600">未保存</Badge>}
          </div>
          <div className="gt-caption mt-1 flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="truncate">
              {scanReport ? `${scanReport.markdownCount} 个 Markdown,${scanReport.assetCount} 个资源` : "先选择仓库并扫描。"}
            </span>
            {scanReport && (
              <span className="min-w-14 shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-center font-mono tabular-nums text-foreground">
                {selectedCount} 项
              </span>
            )}
            {scanReport && (
              <span className="min-w-20 shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-center font-mono tabular-nums text-foreground">
                {filteredCount}/{totalCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange("tree")}
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
              onClick={() => onViewModeChange("list")}
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
          <Button variant="outline" size="sm" onClick={onSelectDefaults} disabled={!scanReport}>默认</Button>
          <Button variant="outline" size="sm" onClick={onToggleAll} disabled={!scanReport || captureList.length === 0}>
            {allCapturedSelected ? "取消" : "全选"}
          </Button>
          <Button size="sm" onClick={onSave} disabled={!scanReport || !dirty}>
            <Save className="size-3.5" />
            保存
          </Button>
        </div>
      </div>
      <div className="grid min-h-[460px] grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
          {showSearch && (
            <div className="border-b bg-muted/10 px-5 py-3">
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filters.query}
                  onChange={(event) => updateFilters({ query: event.target.value })}
                  placeholder="搜索文档路径"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
          )}

          <div className="gt-thin-scroll h-[360px] overflow-auto lg:h-[396px]">
            {captureList.length ? (
              captureViewMode === "tree" ? (
                <CaptureTree
                  nodes={captureTree}
                  openPaths={openCapturePaths}
                  selectedPaths={selectedPaths}
                  onToggleOpen={onToggleOpen}
                  onToggleCandidate={onToggleCandidate}
                  onToggleGroup={onToggleGroup}
                />
              ) : (
                <div className="divide-y">
                  {captureList.map((candidate) => (
                    <CaptureListItem
                      key={candidate.path}
                      candidate={candidate}
                      checked={selectedPaths.has(candidate.path)}
                      onToggle={() => onToggleCandidate(candidate.path)}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                <Search className="size-8 text-muted-foreground" />
                <div className="gt-body-strong">{totalCount > 0 ? "没有符合条件的文档" : "还没有扫描结果"}</div>
                <p className="gt-caption max-w-sm text-muted-foreground">
                  {totalCount > 0 ? "调整搜索关键词后再查看。" : "选择仓库后会自动识别 README、doc、docs、notes 等文档目录。"}
                </p>
              </div>
            )}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col bg-muted/10">
          <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
            <div className="min-w-0">
              <div className="gt-title-panel">发布范围</div>
              <div className="gt-caption mt-1 truncate text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} 个入口,${selectedMarkdownCount} 个 Markdown` : "选择左侧入口后显示。"}
              </div>
            </div>
            {selectedCount > 0 && (
              <Badge variant="secondary" className="h-6 shrink-0 px-2 gt-caption">
                已选
              </Badge>
            )}
          </div>
          <div className="gt-thin-scroll h-[360px] overflow-auto lg:h-[459px]">
            {selectedCaptureTree.length ? (
              <CapturePreviewTree nodes={selectedCaptureTree} />
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                <FolderTree className="size-8 text-muted-foreground" />
                <div className="gt-body-strong">暂无已选目录</div>
                <p className="gt-caption max-w-xs text-muted-foreground">
                  勾选左侧候选目录后,这里会按目录层级展示将发布的文档范围。
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
