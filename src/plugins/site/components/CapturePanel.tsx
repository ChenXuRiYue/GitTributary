import { FolderTree, List, ListChecks, RotateCcw, Save, Search, SlidersHorizontal } from "lucide-react";

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
  const filtersActive = Boolean(
    filters.query
      || filters.kind !== "all"
      || filters.selection !== "all"
      || filters.defaultState !== "all"
      || filters.minMarkdownCount > 0
      || filters.sort !== "path",
  );

  const updateFilters = (patch: Partial<CaptureFilterState>) => {
    onFiltersChange({ ...filters, ...patch });
  };
  const saveStateLabel = !scanReport ? "待扫描" : dirty ? "未保存" : "已保存";

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)] 2xl:grid-cols-[minmax(0,7fr)_minmax(460px,5fr)]">
        <div className="flex min-w-0 flex-col border-b border-border/50 lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-border/50 bg-muted/10 px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="gt-title-panel truncate">候选文档</div>
                  <Badge variant="outline" className="h-5 shrink-0 px-1.5 gt-caption">
                    {filtersActive ? `显示 ${filteredCount} / 候选 ${totalCount}` : `${totalCount} 个候选`}
                  </Badge>
                </div>
                <p className="gt-caption mt-1 truncate text-muted-foreground">
                  {scanReport ? `扫描到 ${scanReport.markdownCount} 个 Markdown 文件` : "选择参与构建的入口目录或文件。"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="flex shrink-0 overflow-hidden rounded-md border border-border/70 bg-background p-0.5">
                  <button
                    type="button"
                    onClick={() => onViewModeChange("tree")}
                    disabled={!scanReport}
                    title="树形"
                    className={cn(
                      "flex size-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      captureViewMode === "tree"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                  >
                    <FolderTree className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onViewModeChange("list")}
                    disabled={!scanReport}
                    title="列表"
                    className={cn(
                      "flex size-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      captureViewMode === "list"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                  >
                    <List className="size-3.5" />
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={onSelectDefaults}
                  disabled={!scanReport}
                  title="恢复默认范围"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={onToggleAll}
                  disabled={!scanReport || captureList.length === 0}
                  title={allCapturedSelected ? "取消当前筛选结果" : "选择当前筛选结果"}
                >
                  <ListChecks className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              {showSearch && (
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filters.query}
                    onChange={(event) => updateFilters({ query: event.target.value })}
                    placeholder="搜索文档路径"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              )}
              <details className="relative shrink-0">
                <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border bg-background px-2.5 gt-caption text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <SlidersHorizontal className="size-3.5" />
                  筛选
                  {filtersActive && <span className="size-1.5 rounded-full bg-primary" />}
                </summary>
                <div className="absolute right-0 top-[calc(100%_+_0.5rem)] z-20 w-[min(36rem,calc(100vw_-_10rem))] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={filters.kind}
                      onChange={(event) => updateFilters({ kind: event.target.value as CaptureFilterState["kind"] })}
                      className="h-8 rounded-md border bg-background px-2 gt-caption outline-none"
                      aria-label="路径类型筛选"
                    >
                      <option value="all">全部类型</option>
                      <option value="dir">只看目录</option>
                      <option value="file">只看文件</option>
                    </select>
                    <select
                      value={filters.selection}
                      onChange={(event) => updateFilters({ selection: event.target.value as CaptureFilterState["selection"] })}
                      className="h-8 rounded-md border bg-background px-2 gt-caption outline-none"
                      aria-label="选择状态筛选"
                    >
                      <option value="all">全部状态</option>
                      <option value="selected">已选</option>
                      <option value="unselected">未选</option>
                    </select>
                    <select
                      value={filters.defaultState}
                      onChange={(event) => updateFilters({ defaultState: event.target.value as CaptureFilterState["defaultState"] })}
                      className="h-8 rounded-md border bg-background px-2 gt-caption outline-none"
                      aria-label="默认范围筛选"
                    >
                      <option value="all">全部来源</option>
                      <option value="default">默认命中</option>
                      <option value="custom">手动补充</option>
                    </select>
                    <select
                      value={filters.sort}
                      onChange={(event) => updateFilters({ sort: event.target.value as CaptureFilterState["sort"] })}
                      className="h-8 rounded-md border bg-background px-2 gt-caption outline-none"
                      aria-label="排序方式"
                    >
                      <option value="path">按路径</option>
                      <option value="score-desc">按匹配度</option>
                      <option value="markdown-desc">按 Markdown 数</option>
                    </select>
                    <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 gt-caption text-muted-foreground">
                      <span className="shrink-0">md ≥</span>
                      <Input
                        type="number"
                        min={0}
                        value={filters.minMarkdownCount}
                        onChange={(event) => updateFilters({ minMarkdownCount: Math.max(0, Number(event.target.value) || 0) })}
                        className="h-6 w-16 border-0 bg-transparent px-1 py-0 text-xs shadow-none focus-visible:ring-0"
                        aria-label="最小 Markdown 数"
                      />
                    </label>
                    {filtersActive && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => onFiltersChange({
                          query: "",
                          kind: "all",
                          selection: "all",
                          defaultState: "all",
                          minMarkdownCount: 0,
                          sort: "path",
                        })}
                      >
                        清除
                      </Button>
                    )}
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div className="gt-thin-scroll min-h-0 flex-1 overflow-auto">
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
              <div className="flex min-h-80 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                <Search className="size-8 text-muted-foreground" />
                <div className="gt-body-strong">{totalCount > 0 ? "没有符合条件的文档" : "还没有扫描结果"}</div>
                <p className="gt-caption max-w-sm text-muted-foreground">
                  {totalCount > 0 ? "调整筛选条件后再查看。" : "选择仓库后会自动识别 README、doc、docs、notes 等文档目录。"}
                </p>
              </div>
            )}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col bg-sidebar/70">
          <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
            <div className="min-w-0">
              <div className="gt-title-panel">发布范围</div>
              <div className="gt-caption mt-1 truncate text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} 个入口,${selectedMarkdownCount} 个 Markdown` : "选择左侧入口后显示。"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "h-6 px-2 gt-caption",
                  dirty ? "text-amber-600" : "text-muted-foreground",
                )}
              >
                {saveStateLabel}
              </Badge>
              <Button
                size="sm"
                className="h-8"
                onClick={onSave}
                disabled={!scanReport || !dirty}
              >
                <Save className="size-3.5" />
                保存范围
              </Button>
            </div>
          </div>
          <div className="gt-thin-scroll min-h-0 flex-1 overflow-auto">
            {selectedCaptureTree.length ? (
              <CapturePreviewTree nodes={selectedCaptureTree} />
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
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
