import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Send, RefreshCw, GitBranch as GitBranchIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DiffPanel, type DiffFileEntry, type DiffPatch } from "@/components/DiffPanel";

interface RepoOverview {
  path: string;
  current_branch: string;
  is_dirty: boolean;
  changed_count: number;
  remote_url: string | null;
}

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

export function ChangesView() {
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [files, setFiles] = useState<DiffFileEntry[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const ov = await invoke<RepoOverview>("get_overview");
      setOverview(ov);
      const st = await invoke<FileStatus[]>("get_status");
      const entries: DiffFileEntry[] = st.map((s) => ({ path: s.path, kind: s.kind, staged: s.staged }));
      setFiles(entries);
      setChecked(new Set(entries.map((e) => e.path)));
      setError(null);
    } catch { /* not opened */ }
  }, []);

  const openDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    try {
      const ov = await invoke<RepoOverview>("open_repo", { path: selected });
      setOverview(ov);
      const st = await invoke<FileStatus[]>("get_status");
      const entries: DiffFileEntry[] = st.map((s) => ({ path: s.path, kind: s.kind, staged: s.staged }));
      setFiles(entries);
      setChecked(new Set(entries.map((e) => e.path)));
      setError(null); setResult(null);
    } catch (e) { setError(String(e)); }
  };

  const fetchDiff = async (path: string): Promise<DiffPatch | null> => {
    try {
      return await invoke<DiffPatch>("get_file_diff", { path });
    } catch { return null; }
  };

  const doCommit = async () => {
    if (!message.trim() || checked.size === 0) return;
    setLoading(true); setResult(null); setError(null);
    try {
      let info: CommitInfo;
      if (checked.size === files.length) {
        info = await invoke<CommitInfo>("commit_all", { message });
      } else {
        info = await invoke<CommitInfo>("commit_selected", { paths: Array.from(checked), message });
      }
      setResult(`[${info.short_id}] ${info.message}`);
      setMessage("");
      await refresh();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部:仓库信息 + 提交操作 */}
      <div className="flex flex-col gap-2 border-b border-border/50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          {overview ? (
            <>
              <GitBranchIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{overview.current_branch}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground">{overview.path}</span>
              <span className="text-xs text-muted-foreground">{overview.changed_count} 变更</span>
            </>
          ) : (
            <span className="flex-1 text-xs text-muted-foreground">未选择仓库</span>
          )}
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={openDir}>
            <FolderOpen className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={refresh}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>

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
              disabled={loading || !message.trim() || checked.size === 0}>
              <Send className="size-3.5" />
              <span className="text-xs">{checked.size < files.length ? `${checked.size}` : "全部"}</span>
            </Button>
          </div>
        )}
        {result && <p className="text-[11px] text-green-600">{result}</p>}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      {/* 下部:复用 DiffPanel */}
      {overview && (
        <DiffPanel
          files={files}
          fetchDiff={fetchDiff}
          checkable
          checked={checked}
          onCheckedChange={setChecked}
        />
      )}
    </div>
  );
}
