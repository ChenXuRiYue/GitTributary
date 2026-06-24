import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { History, GitCommit, User, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
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

interface RepoOverview {
  path: string;
  current_branch: string;
  remote_url: string | null;
}

interface HistoryUiState {
  version: 1;
  focusedCommitId: string;
  expandedCommitId: string | null;
  updatedAt: number;
}

const HISTORY_STATE_NS = "ui-state";
const HISTORY_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const HISTORY_DETAIL_LINE_LIMIT = 20;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function historyStateKey(overview: RepoOverview): string {
  const repoIdentity = overview.remote_url || overview.path;
  return `git.history.${stableHash(repoIdentity)}.${stableHash(overview.current_branch)}`;
}

function parseHistoryUiState(value: unknown): HistoryUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<HistoryUiState>;
  if (state.version !== 1) return null;

  const legacy = state as Partial<HistoryUiState> & {
    commitId?: unknown;
    detailsExpanded?: unknown;
  };
  const focusedCommitId = typeof state.focusedCommitId === "string"
    ? state.focusedCommitId
    : typeof legacy.commitId === "string"
      ? legacy.commitId
      : null;
  const expandedCommitId = typeof state.expandedCommitId === "string"
    ? state.expandedCommitId
    : legacy.detailsExpanded === true && focusedCommitId
      ? focusedCommitId
      : null;

  if (!focusedCommitId) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    focusedCommitId,
    expandedCommitId,
    updatedAt: state.updatedAt,
  };
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

function wrapDetailText(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const chars = Array.from(line);
      if (chars.length <= HISTORY_DETAIL_LINE_LIMIT) return line;

      const chunks: string[] = [];
      for (let i = 0; i < chars.length; i += HISTORY_DETAIL_LINE_LIMIT) {
        chunks.push(chars.slice(i, i + HISTORY_DETAIL_LINE_LIMIT).join(""));
      }
      return chunks.join("\n");
    })
    .join("\n");
}

export function HistoryView() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<DiffFileEntry[]>([]);
  const [listWidth, setListWidth] = useState(256);
  const stateKeyRef = useRef<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  const expandedIdRef = useRef<string | null>(null);
  const [hoverCard, setHoverCard] = useState<{
    title: string;
    description: string;
    author: string;
    shortId: string;
    time: string;
    top: number;
    left: number;
    arrowTop: number;
    placement: "left" | "right";
  } | null>(null);

  const persistHistoryState = useCallback(async (
    key: string | null,
    commitId: string,
    detailsExpanded: boolean,
  ) => {
    if (!key) return;
    try {
      await invoke("store_set", {
        namespace: HISTORY_STATE_NS,
        key,
        value: {
          version: 1,
          focusedCommitId: commitId,
          expandedCommitId: detailsExpanded ? commitId : null,
          updatedAt: Date.now(),
        } satisfies HistoryUiState,
      });
    } catch {
      // UI cache writes should never block Git history browsing.
    }
  }, []);

  const focusCommit = useCallback(async (
    id: string | null,
    detailsExpanded: boolean,
    key = stateKeyRef.current,
    shouldPersist = true,
  ) => {
    focusedIdRef.current = id;
    expandedIdRef.current = id && detailsExpanded ? id : null;
    setFocusedId(id);
    setExpandedId(id && detailsExpanded ? id : null);

    if (!id) {
      setCommitFiles([]);
      return;
    }

    if (shouldPersist) {
      void persistHistoryState(key, id, detailsExpanded);
    }

    try {
      const files = await invoke<FileStatus[]>("get_commit_files", { commitId: id });
      if (focusedIdRef.current === id) {
        setCommitFiles(files.map((f) => ({ path: f.path, kind: f.kind })));
      }
    } catch {
      if (focusedIdRef.current === id) setCommitFiles([]);
    }
  }, [persistHistoryState]);

  const restoreHistoryState = useCallback(async (log: LogEntry[], overview: RepoOverview) => {
    const key = historyStateKey(overview);
    const hasCommit = (id: string) => log.some((entry) => entry.id === id);
    stateKeyRef.current = key;

    if (log.length === 0) {
      await focusCommit(null, false, key, false);
      return;
    }

    if (focusedIdRef.current && hasCommit(focusedIdRef.current)) {
      await focusCommit(
        focusedIdRef.current,
        expandedIdRef.current === focusedIdRef.current,
        key,
      );
      return;
    }

    try {
      const raw = await invoke<unknown>("store_get", { namespace: HISTORY_STATE_NS, key });
      const cached = parseHistoryUiState(raw);
      const fresh = cached && Date.now() - cached.updatedAt <= HISTORY_STATE_TTL_MS;
      if (cached && fresh && hasCommit(cached.focusedCommitId)) {
        const expanded = cached.expandedCommitId === cached.focusedCommitId
          && hasCommit(cached.expandedCommitId);
        await focusCommit(cached.focusedCommitId, expanded, key);
        return;
      }
      if (raw != null) {
        await invoke("store_delete", { namespace: HISTORY_STATE_NS, key });
      }
    } catch {
      // Missing or unreadable cache falls through to the default selection.
    }

    await focusCommit(log[0].id, true, key);
  }, [focusCommit]);

  const refresh = useCallback(async () => {
    try {
      const [log, overview] = await Promise.all([
        invoke<LogEntry[]>("get_log", { limit: 200 }),
        invoke<RepoOverview>("get_overview"),
      ]);
      setEntries(log);
      setError(null);
      await restoreHistoryState(log, overview);
    } catch (e) {
      setEntries([]);
      stateKeyRef.current = null;
      await focusCommit(null, false, null, false);
      setError(String(e));
    }
  }, [focusCommit, restoreHistoryState]);

  useEffect(() => { refresh(); }, [refresh]);

  const selected = entries.find((e) => e.id === focusedId);

  const selectCommit = (id: string) => {
    const nextExpanded = focusedIdRef.current === id
      ? expandedIdRef.current !== id
      : true;
    void focusCommit(id, nextExpanded);
  };

  const fetchCommitDiff = async (path: string): Promise<DiffPatch | null> => {
    if (!focusedId) return null;
    try {
      return await invoke<DiffPatch>("get_commit_file_diff", { commitId: focusedId, path });
    } catch { return null; }
  };

  const showCommitPreview = (event: PointerEvent<HTMLElement>, entry: LogEntry, title: string, details: string[]) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportRect = event.currentTarget
      .closest("[data-history-commit-list]")
      ?.getBoundingClientRect();
    const anchorRect = viewportRect ?? rect;
    const gap = 8;
    const margin = 10;
    const cardWidth = Math.min(336, Math.max(260, window.innerWidth - margin * 2));
    const estimatedHeight = details.length > 0 ? 172 : 112;
    const canPlaceRight = anchorRect.right + gap + cardWidth <= window.innerWidth - margin;
    const rawLeft = canPlaceRight
      ? anchorRect.right + gap
      : Math.max(margin, anchorRect.left - gap - cardWidth);
    const left = Math.max(margin, Math.min(rawLeft, window.innerWidth - cardWidth - margin));
    const top = Math.max(
      margin,
      Math.min(
        rect.top - 2,
        window.innerHeight - estimatedHeight - margin,
      ),
    );
    const arrowTop = Math.max(
      18,
      Math.min(rect.top + rect.height / 2 - top, estimatedHeight - 18),
    );

    setHoverCard({
      title: wrapDetailText(title),
      description: wrapDetailText(details.join("\n").trim()),
      author: entry.author,
      shortId: entry.short_id,
      time: formatTime(entry.time),
      top,
      left,
      arrowTop,
      placement: canPlaceRight ? "right" : "left",
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
        <div className="gt-thin-scroll min-h-0 flex-1 overflow-auto overscroll-contain" data-history-commit-list>
          <div className="flex w-max min-w-full flex-col">
            {entries.map((entry) => {
              const isFocused = focusedId === entry.id;
              const isExpanded = expandedId === entry.id;
              const [title, ...details] = entry.message.split("\n").filter(Boolean);

              return (
                <div
                  key={entry.id}
                  data-commit-preview-card
                  onPointerEnter={(event) => showCommitPreview(event, entry, title || entry.short_id, details)}
                  onPointerMove={(event) => showCommitPreview(event, entry, title || entry.short_id, details)}
                  onPointerLeave={() => setHoverCard(null)}
                  className={cn(
                    "group/commit relative min-w-full border-b border-border/20 px-2 py-1.5 transition-colors",
                    isFocused ? "bg-accent/45" : "hover:bg-accent/25",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectCommit(entry.id)}
                    aria-expanded={isExpanded}
                    className={cn(
                      "group flex w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-all active:scale-[0.99]",
                      isFocused
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/80"
                        : "text-foreground hover:bg-background/70 hover:shadow-sm",
                    )}
                  >
                    <div className="shrink-0">
                      <p className="whitespace-nowrap text-xs font-medium">{title || entry.short_id}</p>
                      <div className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-[10px] text-muted-foreground">
                        <span className="font-mono">{entry.short_id}</span>
                        <span>{entry.author}</span>
                        <span className="shrink-0">{formatTime(entry.time)}</span>
                      </div>
                    </div>
                  </button>

                  <div
                    className={cn(
                      "sticky left-2 grid max-w-[calc(100vw-7rem)] transition-[grid-template-rows,opacity,margin] duration-200 ease-out",
                      isExpanded ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
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
                            {wrapDetailText(details.join("\n"))}
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
        </div>
      </div>

      {/* 拖拽分隔条 */}
      <ResizeHandle direction="horizontal" size={listWidth} onResize={setListWidth} minSize={180} snapTo={256} />

      {/* 右:选中提交的变更预览(复用 DiffPanel) */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selected ? (
          <>
            {/* 提交元信息(紧凑一行) */}
            <div className="flex shrink-0 items-center gap-3 border-b border-border/50 px-3 py-1.5 text-xs">
              <GitCommit className="size-3.5 text-muted-foreground" />
              <span className="font-mono">{selected.short_id}</span>
              <User className="size-3.5 text-muted-foreground" />
              <span>{selected.author}</span>
              <span className="ml-auto text-muted-foreground">{new Date(selected.time).toLocaleString("zh-CN")}</span>
            </div>
            {/* 变更文件 + diff */}
            <div className="min-h-0 flex-1 overflow-hidden">
              <DiffPanel files={commitFiles} fetchDiff={fetchCommitDiff} />
            </div>
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
          className="pointer-events-none fixed z-[2147483647] w-[min(21rem,calc(100vw-20px))] rounded-md border border-border/80 bg-popover/95 px-3 py-2.5 text-popover-foreground shadow-xl ring-1 ring-black/5 backdrop-blur"
          style={{ top: hoverCard.top, left: hoverCard.left }}
        >
          <span
            className={cn(
              "absolute size-2.5 -translate-y-1/2 rotate-45 border bg-popover/95",
              hoverCard.placement === "right"
                ? "-left-[6px] border-r-0 border-t-0 border-border/80"
                : "-right-[6px] border-b-0 border-l-0 border-border/80",
            )}
            style={{ top: hoverCard.arrowTop }}
          />
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <GitCommit className="size-3.5 shrink-0" />
            <span className="font-mono">{hoverCard.shortId}</span>
            <span className="truncate">{hoverCard.author}</span>
            <span className="ml-auto shrink-0">{hoverCard.time}</span>
          </div>
          <p className="mt-1.5 whitespace-normal break-words text-xs font-semibold leading-5">
            {hoverCard.title}
          </p>
          {hoverCard.description && (
            <p className="mt-1.5 max-h-32 overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
              {hoverCard.description}
            </p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
