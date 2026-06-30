import { FolderTree, List, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CaptureListItem, CaptureTree } from "../capture";
import type { CaptureTreeNode, CaptureViewMode, SitePathCandidate, SiteScanReport } from "../types";

export function CapturePanel({
  scanReport,
  captureTree,
  captureList,
  captureViewMode,
  selectedPaths,
  openCapturePaths,
  selectedCount,
  allCapturedSelected,
  onViewModeChange,
  onSelectDefaults,
  onToggleAll,
  onToggleOpen,
  onToggleCandidate,
  onToggleGroup,
}: {
  scanReport: SiteScanReport | null;
  captureTree: CaptureTreeNode[];
  captureList: SitePathCandidate[];
  captureViewMode: CaptureViewMode;
  selectedPaths: Set<string>;
  openCapturePaths: Set<string>;
  selectedCount: number;
  allCapturedSelected: boolean;
  onViewModeChange: (mode: CaptureViewMode) => void;
  onSelectDefaults: () => void;
  onToggleAll: () => void;
  onToggleOpen: (path: string) => void;
  onToggleCandidate: (path: string) => void;
  onToggleGroup: (paths: string[]) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
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
        </div>
      </div>
      <div className="gt-thin-scroll h-[260px] overflow-auto">
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
            <div className="gt-body-strong">还没有扫描结果</div>
            <p className="gt-caption max-w-sm text-muted-foreground">选择仓库后会自动捕捉 README、doc、docs、notes 等文档入口。</p>
          </div>
        )}
      </div>
    </section>
  );
}
