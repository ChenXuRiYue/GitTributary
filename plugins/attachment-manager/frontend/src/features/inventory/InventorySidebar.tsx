import { cn } from "@/shared/lib/utils";

import type { AttachmentScanReport } from "../../types";
import { filters, type Filter } from "./model";

export function InventorySidebar({
  report,
  filter,
  counts,
  width,
  onFilterChange,
}: {
  report: AttachmentScanReport | null;
  filter: Filter;
  counts: Record<Filter, number>;
  width: number;
  onFilterChange: (filter: Filter) => void;
}) {
  return (
    <aside
      className="border-border/50 flex min-h-0 shrink-0 flex-col border-r max-[900px]:hidden"
      style={{ width }}
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
              onClick={() => onFilterChange(item.id)}
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
  );
}
