import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  Send,
  RefreshCw,
  GitBranch as GitBranchIcon,
  FilePlus2,
  FilePen,
  FileX,
  FileQuestion,
  Folder,
  ChevronRight,
  ChevronDown,
  List,
  FolderTree,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffViewer } from "@/components/DiffViewer";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────

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

interface FileDiff {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

// ─── File tree helpers ────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string; // full relative path
  isDir: boolean;
  children: TreeNode[];
  file?: FileStatus;
}

function buildTree(files: FileStatus[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === name && n.isDir === !isLast);
      if (!existing) {
        existing = {
          name,
          path: pathSoFar,
          isDir: !isLast,
          children: [],
          file: isLast ? file : undefined,
        };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  // 排序:文件夹按字母序在前,文件按字母序在后(递归)
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isDir) sortNodes(n.children);
    }
  }
  sortNodes(root);

  return root;
}

// ─── Icons ────────────────────────────────────────────────────────────

function StatusIcon({ kind }: { kind: string }) {
  const c = "size-3.5 shrink-0";
  switch (kind) {
    case "Added": return <FilePlus2 className={cn(c, "text-green-600")} />;
    case "Modified": return <FilePen className={cn(c, "text-yellow-600")} />;
    case "Deleted": return <FileX className={cn(c, "text-red-500")} />;
    case "Untracked": return <FileQuestion className={cn(c, "text-muted-foreground")} />;
    default: return <FilePen className={cn(c, "text-muted-foreground")} />;
  }
}

function kindBadge(kind: string): string {
  switch (kind) {
    case "Added": return "A";
    case "Modified": return "M";
    case "Deleted": return "D";
    case "Renamed": return "R";
    case "Untracked": return "?";
    case "Conflicted": return "!";
    default: return "?";
  }
}

// ─── Tree Node Component ──────────────────────────────────────────────

function FileTreeNode({
  node,
  depth,
  checked,
  selectedFile,
  onToggleCheck,
  onSelect,
  expandedDirs,
  onToggleDir,
}: {
  node: TreeNode;
  depth: number;
  checked: Set<string>;
  selectedFile: string | null;
  onToggleCheck: (path: string, e: React.MouseEvent) => void;
  onSelect: (path: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}) {
  if (node.isDir) {
    const isExpanded = expandedDirs.has(node.path);
    return (
      <div>
        <div
          className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent/50"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => onToggleDir(node.path)}
        >
          {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <Folder className="size-3.5 text-muted-foreground/70" />
          <span className="truncate">{node.name}</span>
        </div>
        {isExpanded &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              checked={checked}
              selectedFile={selectedFile}
              onToggleCheck={onToggleCheck}
              onSelect={onSelect}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
            />
          ))}
      </div>
    );
  }

  const file = node.file!;
  const isSelected = selectedFile === file.path;

  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors",
        isSelected ? "bg-accent" : "hover:bg-accent/40",
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={() => onSelect(file.path)}
    >
      <input
        type="checkbox"
        checked={checked.has(file.path)}
        onClick={(e) => onToggleCheck(file.path, e)}
        onChange={() => {}}
        className="size-3 accent-primary"
      />
      <StatusIcon kind={file.kind} />
      <span className="flex-1 truncate">{node.name}</span>
      <Badge variant="secondary" className="h-4 w-4 justify-center p-0 text-[9px] font-bold">
        {kindBadge(file.kind)}
      </Badge>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────

export function ChangesView() {
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"tree" | "flat">("tree");

  const tree = useMemo(() => buildTree(statuses), [statuses]);

  // 默认展开所有目录
  useEffect(() => {
    const dirs = new Set<string>();
    function collectDirs(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.isDir) { dirs.add(n.path); collectDirs(n.children); }
      }
    }
    collectDirs(tree);
    setExpandedDirs(dirs);
  }, [tree]);

  const refresh = useCallback(async () => {
    try {
      const ov = await invoke<RepoOverview>("get_overview");
      setOverview(ov);
      const st = await invoke<FileStatus[]>("get_status");
      setStatuses(st);
      setChecked(new Set(st.map((s) => s.path)));
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
      setStatuses(st);
      setChecked(new Set(st.map((s) => s.path)));
      setError(null); setResult(null);
      setSelectedFile(null); setFileDiff(null);
    } catch (e) { setError(String(e)); }
  };

  const toggleCheck = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked(checked.size === statuses.length ? new Set() : new Set(statuses.map((s) => s.path)));
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath);
      return next;
    });
  };

  const doCommit = async () => {
    if (!message.trim() || checked.size === 0) return;
    setLoading(true); setResult(null); setError(null);
    try {
      let info: CommitInfo;
      if (checked.size === statuses.length) {
        info = await invoke<CommitInfo>("commit_all", { message });
      } else {
        info = await invoke<CommitInfo>("commit_selected", { paths: Array.from(checked), message });
      }
      setResult(`[${info.short_id}] ${info.message}`);
      setMessage(""); setSelectedFile(null); setFileDiff(null);
      await refresh();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const selectFile = async (path: string) => {
    if (selectedFile === path) { setSelectedFile(null); setFileDiff(null); return; }
    setSelectedFile(path); setDiffLoading(true);
    try { setFileDiff(await invoke<FileDiff>("get_file_diff", { path })); }
    catch { setFileDiff(null); }
    finally { setDiffLoading(false); }
  };

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── 顶部:仓库信息(紧凑) + 提交操作(频繁操作在前) ─── */}
      <div className="flex flex-col gap-2 border-b border-border/50 px-3 py-2.5">
        {/* 仓库行:紧凑一行 */}
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

        {/* 提交行:信息输入 + 提交按钮 */}
        {overview && (
          <div className="flex items-start gap-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="提交信息…"
              className="min-h-[32px] flex-1 resize-none py-1.5 text-xs"
              rows={1}
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              onClick={doCommit}
              disabled={loading || !message.trim() || checked.size === 0}
            >
              <Send className="size-3.5" />
              <span className="text-xs">
                {checked.size < statuses.length ? `${checked.size}` : "全部"}
              </span>
            </Button>
          </div>
        )}
        {result && <p className="text-[11px] text-green-600">{result}</p>}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      {/* ─── 下部:左右分栏(文件树 | diff 预览) ─── */}
      {overview && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 左:文件列表 */}
          <div className="flex w-56 shrink-0 flex-col border-r border-border/50">
            {/* 工具行:全选 + 视图切换 */}
            <div className="flex items-center gap-2 border-b border-border/30 px-2 py-1.5">
              <input
                type="checkbox"
                checked={statuses.length > 0 && checked.size === statuses.length}
                onChange={toggleAll}
                className="size-3 accent-primary"
              />
              <span className="flex-1 text-[11px] text-muted-foreground">
                {checked.size}/{statuses.length}
              </span>
              <button
                type="button"
                onClick={() => setViewMode("flat")}
                className={cn("rounded p-0.5 transition-colors", viewMode === "flat" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                title="平铺"
              >
                <List className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("tree")}
                className={cn("rounded p-0.5 transition-colors", viewMode === "tree" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                title="树形"
              >
                <FolderTree className="size-3.5" />
              </button>
            </div>
            {/* 文件列表内容 */}
            <ScrollArea className="flex-1">
              <div className="py-1">
                {statuses.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">无变更</p>
                ) : viewMode === "tree" ? (
                  tree.map((node) => (
                    <FileTreeNode
                      key={node.path}
                      node={node}
                      depth={0}
                      checked={checked}
                      selectedFile={selectedFile}
                      onToggleCheck={toggleCheck}
                      onSelect={selectFile}
                      expandedDirs={expandedDirs}
                      onToggleDir={toggleDir}
                    />
                  ))
                ) : (
                  /* 平铺模式:按路径字母序 */
                  [...statuses].sort((a, b) => a.path.localeCompare(b.path)).map((file) => (
                    <div
                      key={file.path}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors",
                        selectedFile === file.path ? "bg-accent" : "hover:bg-accent/40",
                      )}
                      onClick={() => selectFile(file.path)}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(file.path)}
                        onClick={(e) => toggleCheck(file.path, e)}
                        onChange={() => {}}
                        className="size-3 accent-primary"
                      />
                      <StatusIcon kind={file.kind} />
                      <span className="flex-1 truncate text-muted-foreground">{file.path}</span>
                      <Badge variant="secondary" className="h-4 w-4 justify-center p-0 text-[9px] font-bold">
                        {kindBadge(file.kind)}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* 右:Diff 预览 */}
          <div className="w-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              {!selectedFile && (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                  选择文件查看变更
                </div>
              )}
              {selectedFile && diffLoading && (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                  加载中…
                </div>
              )}
              {selectedFile && !diffLoading && fileDiff && (
                <DiffViewer
                  patch={fileDiff.patch}
                  filePath={fileDiff.path}
                  additions={fileDiff.additions}
                  deletions={fileDiff.deletions}
                />
              )}
              {selectedFile && !diffLoading && !fileDiff && (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                  无法加载 diff
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
