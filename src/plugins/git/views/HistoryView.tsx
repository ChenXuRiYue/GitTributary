import { useCallback, useEffect, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { History, GitCommit, User, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffPanel, type DiffFileEntry, type DiffPatch } from "@/components/DiffPanel";
import { ResizeHandle } from "@/components/ResizeHandle";
import { cn } from "@/lib/utils";

interface LogEntry {
  id: string;
  short_id: string;
  message: string;
  author: string;
  email: string;
  time: string;
}

interface FileStatus {
  path: string;
  kind: string;
  staged: boolean;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}小时前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}天前`;
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch { return iso; }
}

export function HistoryView() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<DiffFileEntry[]>([]);
  const [listWidth, setListWidth] = useState(256);
  const [hoverCard, setHoverCard] = useState<{
    title: string;
    description: string;
    author: string;
    shortId: string;
    time: string;
    top: number;
    left: number;
  } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const log = await invoke<LogEntry[]>("get_log", { limit: 200 });
      setEntries(log);
      setError(null);
    } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selected = entries.find((e) => e.id === selectedId);

  const selectCommit = async (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      setCommitFiles([]);
      return;
    }

    setSelectedId(id);
    try {
      const files = await invoke<FileStatus[]>("get_commit_files", { commitId: id });
      setCommitFiles(files.map((f) => ({ path: f.path, kind: f.kind })));
    } catch { setCommitFiles([]); }
  };

  const fetchCommitDiff = async (path: string): Promise<DiffPatch | null> => {
    if (!selectedId) return null;
    try {
      return await invoke<DiffPatch>("get_commit_file_diff", { commitId: selectedId, path });
    } catch { return null; }
  };

  const showCommitPreview = (event: PointerEvent<HTMLElement>, entry: LogEntry, title: string, details: string[]) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverCard({
      title,
      description: details.join("\n").trim(),
      author: entry.author,
      shortId: entry.short_id,
      time: formatTime(entry.time),
      top: Math.max(12, Math.min(rect.top - 4, window.innerHeight - 220)),
      left: Math.min(rect.right + 10, window.innerWidth - 400),
    });
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* 左:提交列表(纵向长列表) */}
      <div className="flex min-h-0 shrink-0 flex-col border-r border-border/50" style={{ width: `${listWidth}px` }}>
        {/* 头部 */}
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <History className="size-3.5 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground">{entries.length} 条提交</span>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={refresh}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {error && <p className="border-b border-border/30 px-3 py-1 text-[11px] text-destructive">{error}</p>}
        {/* 列表 */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col">
            {entries.map((entry) => {
              const isSelected = selectedId === entry.id;
              const [title, ...details] = entry.message.split("\n").filter(Boolean);

              return (
                <div
                  key={entry.id}
                  data-commit-preview-card
                  onPointerEnter={(event) => showCommitPreview(event, entry, title || entry.short_id, details)}
                  onPointerMove={(event) => showCommitPreview(event, entry, title || entry.short_id, details)}
                  onPointerLeave={() => setHoverCard(null)}
                  className={cn(
                    "group/commit relative border-b border-border/20 px-2 py-1.5 transition-colors",
                    isSelected ? "bg-accent/45" : "hover:bg-accent/25",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectCommit(entry.id)}
                    aria-expanded={isSelected}
                    className={cn(
                      "group flex w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-all active:scale-[0.99]",
                      isSelected
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/80"
                        : "text-foreground hover:bg-background/70 hover:shadow-sm",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{title || entry.short_id}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{entry.short_id}</span>
                        <span className="truncate">{entry.author}</span>
                        <span className="ml-auto shrink-0">{formatTime(entry.time)}</span>
                      </div>
                    </div>
                  </button>

                  <div
                    className={cn(
                      "grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out",
                      isSelected ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="max-h-44 overflow-y-auto rounded-md border border-border/70 bg-popover px-2.5 py-2 text-[11px] shadow-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <GitCommit className="size-3.5 shrink-0" />
                          <span className="truncate font-mono">{entry.id}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-muted-foreground">
                          <User className="size-3.5 shrink-0" />
                          <span className="truncate">{entry.author}</span>
                          {entry.email && <span className="truncate opacity-80">{entry.email}</span>}
                        </div>
                        {details.length > 0 && (
                          <p className="mt-2 whitespace-pre-wrap text-foreground/80">
                            {details.join("\n")}
                          </p>
                        )}
                        <p className="mt-1.5 text-muted-foreground">
                          {new Date(entry.time).toLocaleString("zh-CN")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* 拖拽分隔条 */}
      <ResizeHandle direction="horizontal" size={listWidth} onResize={setListWidth} minSize={180} snapTo={256} />

      {/* 右:选中提交的变更预览(复用 DiffPanel) */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selected ? (
          <>
            {/* 提交元信息(紧凑一行) */}
            <div className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 text-xs">
              <GitCommit className="size-3.5 text-muted-foreground" />
              <span className="font-mono">{selected.short_id}</span>
              <User className="size-3.5 text-muted-foreground" />
              <span>{selected.author}</span>
              <span className="ml-auto text-muted-foreground">{new Date(selected.time).toLocaleString("zh-CN")}</span>
            </div>
            {/* 变更文件 + diff */}
            <DiffPanel files={commitFiles} fetchDiff={fetchCommitDiff} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            选择一条提交查看变更
          </div>
        )}
      </div>
      {hoverCard && createPortal(
        <div
          data-floating-commit-preview
          className="pointer-events-none fixed z-[2147483647] w-96 rounded-md border border-border bg-popover px-3.5 py-3 text-popover-foreground shadow-2xl ring-1 ring-black/5"
          style={{ top: hoverCard.top, left: hoverCard.left }}
        >
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <GitCommit className="size-3.5 shrink-0" />
            <span className="font-mono">{hoverCard.shortId}</span>
            <span className="truncate">{hoverCard.author}</span>
            <span className="ml-auto shrink-0">{hoverCard.time}</span>
          </div>
          <p className="mt-2 whitespace-normal break-words text-xs font-semibold leading-5">
            {hoverCard.title}
          </p>
          {hoverCard.description && (
            <p className="mt-2 max-h-40 overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
              {hoverCard.description}
            </p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
