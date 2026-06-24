import { useCallback, useEffect, useState } from "react";
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左:提交列表(纵向长列表) */}
      <div className="flex shrink-0 flex-col border-r border-border/50" style={{ width: `${listWidth}px` }}>
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
        <ScrollArea className="flex-1">
          <div className="flex flex-col">
            {entries.map((entry) => (
              <div
                key={entry.id}
                onClick={() => selectCommit(entry.id)}
                className={cn(
                  "group flex cursor-pointer flex-col gap-0.5 border-b border-border/20 px-3 py-2 transition-colors",
                  selectedId === entry.id ? "bg-accent" : "hover:bg-accent/40",
                )}
              >
                <p className="truncate text-xs font-medium">{entry.message.split("\n")[0]}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">{entry.short_id}</span>
                  <span>{entry.author}</span>
                  <span className="ml-auto">{formatTime(entry.time)}</span>
                </div>
              </div>
            ))}
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
    </div>
  );
}
