import type { Dispatch, RefObject, SetStateAction } from "react";
import { Check, ChevronDown, FolderTree, Plus, Workflow } from "lucide-react";

import { DomainTrail, type DomainTrailItem } from "@/components/DomainTrail";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_FLOW_FOLDER } from "../constants";
import type { FlowListItem, FlowRecord, FlowSection } from "../types";
import { flowFileName, flowSectionLabel, normalizeFolder } from "../utils";

interface FlowHeaderProps {
  section: FlowSection;
  flows: FlowListItem[];
  selectedId: string | null;
  selectedFolder: string | null;
  selectedRecord: FlowRecord | null;
  isEditingYaml: boolean;
  eventCount: number;
  nodeDefinitionCount: number;
  flowNodeCount: number;
  folderCount: number;
  enabledCount: number;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  onChangeSection: (section: FlowSection) => void;
  onSelectFlow: (id: string) => void;
  onCreateFlow: () => void;
}

export function FlowHeader({
  section,
  flows,
  selectedId,
  selectedFolder,
  selectedRecord,
  isEditingYaml,
  eventCount,
  nodeDefinitionCount,
  flowNodeCount,
  folderCount,
  enabledCount,
  menuOpen,
  menuRef,
  setMenuOpen,
  onChangeSection,
  onSelectFlow,
  onCreateFlow,
}: FlowHeaderProps) {
  const activeFolder = selectedRecord
    ? normalizeFolder(selectedRecord.folder, selectedRecord.summary)
    : selectedFolder;
  const contextLabel = (() => {
    if (section === "flows") {
      if (isEditingYaml && !selectedRecord) return "新建 Flow";
      if (isEditingYaml && selectedRecord) return `${selectedRecord.summary.name} 草稿`;
      return selectedRecord?.summary.name ?? selectedFolder ?? "选择 Flow";
    }
    if (selectedRecord) return selectedRecord.summary.name;
    return section === "events" ? "事件目录" : "节点目录";
  })();
  const contextTitle = selectedRecord
    ? `${selectedRecord.summary.name} / ${activeFolder ?? DEFAULT_FLOW_FOLDER}`
    : contextLabel;
  const trailItems: DomainTrailItem[] = [
    { id: "flow", label: "Flow" },
    { id: section, label: flowSectionLabel(section) },
  ];
  const secondaryStats = (() => {
    switch (section) {
      case "events": return `事件:${eventCount}`;
      case "nodes": return `动作:${nodeDefinitionCount} 节点:${flowNodeCount}`;
      case "flows":
      default:
        return `文件夹:${folderCount} 步骤:${selectedRecord?.summary.step_count ?? 0}`;
    }
  })();
  const primaryStats = `流:${flows.length} 启用:${enabledCount}`;

  return (
    <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <DomainTrail items={trailItems} />
        <span className="shrink-0 text-muted-foreground/60 gt-body">/</span>
        <div ref={menuRef} className="relative min-w-0 shrink">
          <button
            type="button"
            className="flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`切换 Flow: ${contextLabel}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            title={contextTitle}
          >
            <span className="min-w-0 truncate gt-body">{contextLabel}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg sm:w-80"
            >
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <div className="min-w-0">
                  <div className="gt-body-strong truncate">{contextLabel}</div>
                  <div className="gt-caption truncate text-muted-foreground">
                    {activeFolder ? `flows/${activeFolder}` : "未选择 Flow"}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={() => {
                    setMenuOpen(false);
                    onChangeSection("flows");
                  }}
                >
                  <FolderTree className="size-3.5" />
                  流目录
                </Button>
              </div>

              <div className="max-h-72 overflow-y-auto p-1">
                {flows.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <Workflow className="mx-auto size-6 text-muted-foreground" />
                    <div className="gt-body-strong mt-2">暂无 Flow</div>
                    <p className="gt-caption mt-1 text-muted-foreground">新建后会出现在这里。</p>
                  </div>
                ) : (
                  flows.map((flow) => {
                    const isCurrent = selectedId === flow.id;
                    const folder = normalizeFolder(flow.folder, flow.summary);
                    return (
                      <button
                        key={flow.id}
                        type="button"
                        role="menuitem"
                        className={cn(
                          "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                          isCurrent ? "bg-primary/8 text-foreground" : "hover:bg-accent hover:text-accent-foreground",
                        )}
                        onClick={() => onSelectFlow(flow.id)}
                      >
                        <span className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md border",
                          isCurrent ? "border-primary/30 bg-primary/10 text-primary" : "bg-background text-muted-foreground",
                        )}>
                          {isCurrent ? <Check className="size-3.5" /> : <Workflow className="size-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="gt-body-strong block truncate">{flow.summary.name}</span>
                          <span className="gt-caption block truncate text-muted-foreground">
                            {folder} / {flowFileName(flow.id)}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-2 py-2">
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={onCreateFlow}>
                  <Plus className="size-3.5" />
                  新建 Flow
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="ml-auto hidden shrink-0 items-center gap-2 text-right md:flex">
        {[secondaryStats, primaryStats].map((stat, index) => (
          <div key={`${index}.${stat}`} className="flex items-center gap-2">
            {index > 0 && <span className="text-muted-foreground/40 gt-caption">/</span>}
            <span className="text-foreground gt-caption font-medium">{stat}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
