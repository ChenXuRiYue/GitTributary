import { useMemo } from "react";
import { FolderTree, List, Workflow } from "lucide-react";

import { FileTree, type FileTreeLeaf } from "@/components/FileTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FlowListItem, FlowListMode } from "../types";
import { flowFileName, flowMarker, flowMarkerClass, normalizeFolder, summaryFromItem } from "../utils";
import type { FlowPoint, FlowTreeSelection } from "./flowBrowserTypes";

export function FlowFileBrowser({
  flows,
  folders,
  selectedId,
  selectedFolder,
  onSelect,
  onContextMenu,
  canOperate,
  listMode,
  onListModeChange,
}: {
  flows: FlowListItem[];
  folders: string[];
  selectedId: string | null;
  selectedFolder: string | null;
  onSelect: (selection: FlowTreeSelection) => void;
  onContextMenu: (selection: FlowTreeSelection, point: FlowPoint) => void;
  canOperate: boolean;
  listMode: FlowListMode;
  onListModeChange: (mode: FlowListMode) => void;
}) {
  const selectedTreeId = selectedId ?? (selectedFolder ? `folder:${selectedFolder}` : undefined);
  const items = useMemo<FileTreeLeaf[]>(() => {
    const folderItems = folders.map((folder) => ({
      id: `folder:${folder}`,
      path: folder,
      label: folder.split("/").pop() ?? folder,
      icon: FolderTree,
      kind: "folder" as const,
    }));
    const flowItems = flows.map((flow) => {
      const summary = summaryFromItem(flow);
      const folder = normalizeFolder(flow.folder, summary);
      const file = flowFileName(flow.id);
      return {
        id: flow.id,
        path: `${folder}/${file}`,
        label: summary.name,
        subtitle: file,
        icon: Workflow,
        marker: flowMarker(flow.enabled),
      };
    });
    return [...folderItems, ...flowItems];
  }, [flows, folders]);
  const hasVisibleItems = items.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2">
        <span className="gt-label text-muted-foreground">流文件</span>
        <div className="inline-flex h-6 rounded-md border bg-background p-0.5">
          <button
            type="button"
            title="列表视图"
            onClick={() => onListModeChange("list")}
            className={cn(
              "flex size-5 items-center justify-center rounded transition-colors",
              listMode === "list" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            <List className="size-3.5" />
          </button>
          <button
            type="button"
            title="文件夹视图"
            onClick={() => onListModeChange("tree")}
            className={cn(
              "flex size-5 items-center justify-center rounded transition-colors",
              listMode === "tree" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            <FolderTree className="size-3.5" />
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" orientation="both">
        {!hasVisibleItems ? (
          <div className="px-3 py-4 text-sm text-muted-foreground">还没有保存的 Flow。</div>
        ) : listMode === "tree" ? (
          <FileTree
            items={items}
            selectedId={selectedTreeId}
            onSelect={(id) => {
              if (id.startsWith("folder:")) {
                onSelect({ type: "folder", path: id.slice("folder:".length) });
              } else {
                onSelect({ type: "flow", id });
              }
            }}
            onContextMenu={(item, point) => {
              if (!canOperate) return;
              if (item.id.startsWith("folder:")) {
                onContextMenu({ type: "folder", path: item.id.slice("folder:".length) }, point);
              } else {
                onContextMenu({ type: "flow", id: item.id }, point);
              }
            }}
            defaultOpen="all"
            allowHorizontalScroll
            showFolderCount
          />
        ) : (
          <div className="min-w-max py-1 pr-2">
            {flows.map((flow) => {
              const summary = summaryFromItem(flow);
              const selected = flow.id === selectedId;
              const marker = flowMarker(flow.enabled);
              return (
                <button
                  key={flow.id}
                  type="button"
                  onClick={() => onSelect({ type: "flow", id: flow.id })}
                  className={cn(
                    "grid h-9 min-w-full grid-cols-[16px_minmax(168px,max-content)_minmax(120px,max-content)_auto] items-center gap-2 px-3 text-left transition-colors",
                    selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/45",
                  )}
                >
                  <Workflow className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="gt-tree whitespace-nowrap">{summary.name}</span>
                  <span className="gt-tree-meta whitespace-nowrap font-mono text-muted-foreground">
                    {flowFileName(flow.id)}
                  </span>
                  <span className={cn("size-1.5 rounded-full", flowMarkerClass(marker))} />
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
