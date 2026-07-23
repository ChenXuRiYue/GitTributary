import { File, Grid2X2, List, LoaderCircle, Search } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Input } from "@/shared/ui/input";

import { Pagination } from "../../components/Pagination";
import { compactSelectClass } from "../../components/styles";
import { formatBytes } from "../../lib/attachment";
import type { AttachmentItem, AttachmentScanReport } from "../../types";
import { AttachmentRow, AttachmentTile } from "./AttachmentItems";
import { linkFilters, type Filter, type LinkFilter, type SortMode, type ViewMode } from "./model";

export function InventoryPanel({
  report,
  loading,
  filter,
  linkFilter,
  linkCounts,
  query,
  sort,
  view,
  items,
  totalItems,
  selectedPath,
  page,
  pageCount,
  onQueryChange,
  onLinkFilterChange,
  onSortChange,
  onViewChange,
  onSelect,
  onPageChange,
}: {
  report: AttachmentScanReport | null;
  loading: boolean;
  filter: Filter;
  linkFilter: LinkFilter;
  linkCounts: Record<LinkFilter, number>;
  query: string;
  sort: SortMode;
  view: ViewMode;
  items: AttachmentItem[];
  totalItems: number;
  selectedPath: string | null;
  page: number;
  pageCount: number;
  onQueryChange: (value: string) => void;
  onLinkFilterChange: (value: LinkFilter) => void;
  onSortChange: (value: SortMode) => void;
  onViewChange: (value: ViewMode) => void;
  onSelect: (path: string) => void;
  onPageChange: (page: number) => void;
}) {
  return (
    <>
      <div className="border-border/50 flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索名称或路径"
            className="h-7 pl-8"
          />
        </div>
        {filter === "link" && (
          <select
            value={linkFilter}
            onChange={(event) => onLinkFilterChange(event.target.value as LinkFilter)}
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
          value={sort}
          onChange={(event) => onSortChange(event.target.value as SortMode)}
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
            onClick={() => onViewChange("grid")}
            aria-pressed={view === "grid"}
            className={cn("flex size-6 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", view === "grid" && "bg-background text-foreground shadow-sm")}
            title="网格视图"
          >
            <Grid2X2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewChange("list")}
            aria-pressed={view === "list"}
            className={cn("flex size-6 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", view === "list" && "bg-background text-foreground shadow-sm")}
            title="列表视图"
          >
            <List className="size-4" />
          </button>
        </div>
        <span className="text-muted-foreground na-caption hidden shrink-0 lg:inline">
          {loading ? "正在扫描" : `${totalItems} 项 · ${formatBytes(report?.totalSize ?? 0)}`}
          {!loading && report && report.skippedEntries > 0 ? ` · 跳过 ${report.skippedEntries}` : ""}
        </span>
      </div>

      <div className="na-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
        {loading && !report ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <LoaderCircle className="size-4 animate-spin" />
            <span className="na-body">正在扫描附件</span>
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-center">
            <File className="mb-3 size-7" />
            <span className="na-body">没有匹配的附件</span>
          </div>
        ) : view === "grid" ? (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {items.map((item) => (
                <AttachmentTile
                  key={item.path}
                  item={item}
                  repoPath={report?.repoPath ?? ""}
                  selected={item.path === selectedPath}
                  onSelect={onSelect}
                />
              ))}
            </div>
            <Pagination page={page} pageCount={pageCount} total={totalItems} onPageChange={onPageChange} />
          </>
        ) : (
          <>
            <div className="divide-border divide-y">
              {items.map((item) => (
                <AttachmentRow
                  key={item.path}
                  item={item}
                  selected={item.path === selectedPath}
                  onSelect={onSelect}
                />
              ))}
            </div>
            <Pagination page={page} pageCount={pageCount} total={totalItems} onPageChange={onPageChange} />
          </>
        )}
      </div>
    </>
  );
}
