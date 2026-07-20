import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Send,
  RefreshCw,
  GitBranch as GitBranchIcon,
  Clock,
  ChevronDown,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DiffPanel, type DiffFileEntry, type DiffPatch } from "@/components/DiffPanel";
import { cn } from "@/lib/utils";
import type { GitViewProps, RepoOverview } from "../types";

interface FileStatus {
  path: string;
  kind: string;
  staged: boolean;
}

interface CommitInfo {
  id: string;
  short_id: string;
  message: string;
  author: string;
  time: string;
}

interface ChangesSelectionUiState {
  version: 1;
  checkedPaths: string[];
  updatedAt: number;
}

const CHANGES_SELECTION_STATE_NS = "ui-state";
const CHANGES_SELECTION_STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const EMPTY_CHECKED_PATHS = new Set<string>();

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function changesSelectionStateKey(overview: RepoOverview): string {
  const repoIdentity = overview.remote_url || overview.path;
  return `git.changes.selection.${stableHash(repoIdentity)}.${stableHash(overview.current_branch)}`;
}

function parseChangesSelectionUiState(value: unknown): ChangesSelectionUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<ChangesSelectionUiState>;
  if (state.version !== 1) return null;
  if (!Array.isArray(state.checkedPaths) || state.checkedPaths.some((path) => typeof path !== "string")) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    checkedPaths: state.checkedPaths,
    updatedAt: state.updatedAt,
  };
}

/** 从路径中提取短名(最后两段) */
function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

export function ChangesView({
  overview,
  recentRepos,
  sessionGeneration,
  openRepository,
  refreshRepository,
  onStatusCountChange,
}: GitViewProps) {
  const [files, setFiles] = useState<DiffFileEntry[]>([]);
  const [dataGeneration, setDataGeneration] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showRecent, setShowRecent] = useState(false);
  const selectionStateKeyRef = useRef<string | null>(null);
  const loadedGenerationRef = useRef<number | null>(null);

  const persistCheckedSelection = useCallback(async (key: string | null, nextChecked: Set<string>) => {
    if (!key) return;
    try {
      await invoke("store_set", {
        namespace: CHANGES_SELECTION_STATE_NS,
        key,
        value: {
          version: 1,
          checkedPaths: Array.from(nextChecked).sort(),
          updatedAt: Date.now(),
        } satisfies ChangesSelectionUiState,
      });
    } catch {
      // UI cache writes should not block Git operations.
    }
  }, []);

  const restoreCheckedSelection = useCallback(async (ov: RepoOverview, entries: DiffFileEntry[]) => {
    const key = changesSelectionStateKey(ov);
    const currentPaths = new Set(entries.map((entry) => entry.path));
    const defaultChecked = new Set(currentPaths);
    selectionStateKeyRef.current = key;

    try {
      const raw = await invoke<unknown>("store_get", { namespace: CHANGES_SELECTION_STATE_NS, key });
      const cached = parseChangesSelectionUiState(raw);
      const fresh = cached && Date.now() - cached.updatedAt <= CHANGES_SELECTION_STATE_TTL_MS;

      if (cached && fresh) {
        const restored = new Set(cached.checkedPaths.filter((path) => currentPaths.has(path)));
        if (selectionStateKeyRef.current !== key) return;
        setChecked(restored);
        if (restored.size !== cached.checkedPaths.length) {
          void persistCheckedSelection(key, restored);
        }
        return;
      }

      if (raw != null) {
        await invoke("store_delete", { namespace: CHANGES_SELECTION_STATE_NS, key });
      }
    } catch {
      // Missing or unreadable cache falls back to the current default.
    }

    if (selectionStateKeyRef.current !== key) return;
    setChecked(defaultChecked);
    void persistCheckedSelection(key, defaultChecked);
  }, [persistCheckedSelection]);

  // 刷新当前仓库状态
  const refresh = useCallback(async () => {
    if (!overview) return;
    const requestedGeneration = sessionGeneration;
    try {
      const st = await invoke<FileStatus[]>("get_status");
      if (loadedGenerationRef.current !== requestedGeneration) return;
      const entries: DiffFileEntry[] = st.map((s) => ({ path: s.path, kind: s.kind, staged: s.staged }));
      setFiles(entries);
      setDataGeneration(requestedGeneration);
      onStatusCountChange(entries.length);
      await restoreCheckedSelection(overview, entries);
      setError(null);
    } catch { /* not opened */ }
  }, [onStatusCountChange, overview, restoreCheckedSelection, sessionGeneration]);

  const updateChecked = useCallback((nextChecked: Set<string>) => {
    setChecked(nextChecked);
    void persistCheckedSelection(selectionStateKeyRef.current, nextChecked);
  }, [persistCheckedSelection]);

  // 通过文件选择器打开新仓库
  const openFromDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    setShowRecent(false);
    await openRepository(selected as string);
  };

  useEffect(() => {
    if (!overview || loadedGenerationRef.current === sessionGeneration) return;
    loadedGenerationRef.current = sessionGeneration;
    selectionStateKeyRef.current = null;
    setFiles([]);
    setChecked(new Set());
    onStatusCountChange(0);
    void refresh();
  }, [onStatusCountChange, overview, refresh, sessionGeneration]);

  const fetchDiff = async (path: string): Promise<DiffPatch | null> => {
    try { return await invoke<DiffPatch>("get_file_diff", { path }); }
    catch { return null; }
  };

  const doCommit = async () => {
    const activeFiles = dataGeneration === sessionGeneration ? files : [];
    const activeChecked = dataGeneration === sessionGeneration ? checked : EMPTY_CHECKED_PATHS;
    if (!message.trim() || activeChecked.size === 0) return;
    setLoading(true); setResult(null); setError(null);
    try {
      let info: CommitInfo;
      if (activeChecked.size === activeFiles.length) {
        info = await invoke<CommitInfo>("commit_all", { message });
      } else {
        info = await invoke<CommitInfo>("commit_selected", { paths: Array.from(activeChecked), message });
      }
      setResult(`[${info.short_id}] ${info.message}`);
      setMessage("");
      await refreshRepository();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const visibleFiles = dataGeneration === sessionGeneration ? files : [];
  const visibleChecked = dataGeneration === sessionGeneration ? checked : EMPTY_CHECKED_PATHS;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 顶部:仓库信息 + 提交操作 */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-3 py-2.5">
        {/* 仓库选择行 */}
        <div className="flex items-center gap-2">
          {overview ? (
            <>
              <GitBranchIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{overview.current_branch}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground" title={overview.path}>
                {shortPath(overview.path)}
              </span>
              <span className="text-xs text-muted-foreground">{visibleFiles.length} 变更</span>
            </>
          ) : (
            <span className="flex-1 text-xs text-muted-foreground">选择一个 Git 仓库开始</span>
          )}
          {/* 最近项目下拉 */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => setShowRecent(!showRecent)}
              title="最近项目"
            >
              <Clock className="size-3.5" />
              <ChevronDown className="size-3" />
            </Button>
            {showRecent && recentRepos.length > 0 && (
              <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border bg-popover p-1 shadow-md">
                {recentRepos.slice(0, 5).map((repo) => (
                  <button
                    key={repo}
                    type="button"
                    onClick={() => openRepository(repo)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                      overview?.path === repo && "bg-accent font-medium",
                    )}
                  >
                    <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate" title={repo}>{shortPath(repo)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* 打开文件夹 */}
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={openFromDialog} title="打开文件夹">
            <FolderOpen className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={refresh} title="刷新">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>

        {/* 提交行 */}
        {overview && (
          <div className="flex items-start gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="提交信息…"
              className="min-h-[32px] flex-1 resize-none py-1.5 text-xs"
              rows={1}
            />
            <Button size="sm" className="h-8 shrink-0" onClick={doCommit}
              disabled={loading || !message.trim() || visibleChecked.size === 0}>
              <Send className="size-3.5" />
              <span className="text-xs">{visibleChecked.size < visibleFiles.length ? `${visibleChecked.size}` : "全部"}</span>
            </Button>
          </div>
        )}
        {result && <p className="text-[11px] text-green-600">{result}</p>}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      {/* 下部:DiffPanel */}
      {overview && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffPanel
            files={visibleFiles}
            fetchDiff={fetchDiff}
            checkable
            checked={visibleChecked}
            onCheckedChange={updateChecked}
          />
        </div>
      )}

      {/* 未打开仓库时的空状态 */}
      {!overview && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <GitBranchIcon className="size-10 opacity-20" />
          <p className="text-sm">打开一个 Git 仓库开始工作</p>
          <div className="flex gap-2">
            {recentRepos.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => openRepository(recentRepos[0])}>
                <Clock className="size-3.5" /> 打开最近: {shortPath(recentRepos[0])}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={openFromDialog}>
              <FolderOpen className="size-3.5" /> 选择文件夹
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
