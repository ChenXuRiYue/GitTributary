import { useEffect, useMemo, useState } from "react";
import {
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

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffViewer } from "@/components/DiffViewer";
import { ResizeHandle } from "@/components/ResizeHandle";
import { cn } from "@/lib/utils";

// ─── Unified types (same shape for workdir changes & commit changes) ──

export interface DiffFileEntry {
  path: string;
  kind: string; // "Added" | "Modified" | "Deleted" | "Renamed" | "Untracked" | "Conflicted"
  staged?: boolean;
}

export interface DiffPatch {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface DiffPanelProps {
  /** 变更文件列表 */
  files: DiffFileEntry[];
  /** 获取某个文件的 diff 内容(异步) */
  fetchDiff: (path: string) => Promise<DiffPatch | null>;
  /** 是否展示勾选框(Changes 视图需要,History 不需要) */
  checkable?: boolean;
  /** 勾选状态(受控) */
  checked?: Set<string>;
  /** 勾选变更回调 */
  onCheckedChange?: (checked: Set<string>) => void;
}

// ─── Tree helpers ─────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: DiffFileEntry;
}

function buildTree(files: DiffFileEntry[]): TreeNode[] {
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
        existing = { name, path: pathSoFar, isDir: !isLast, children: [], file: isLast ? file : undefined };
        current.push(existing);
      }
      current = existing.children;
    }
  }
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) { if (n.isDir) sortNodes(n.children); }
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

// ─── Tree Node ────────────────────────────────────────────────────────

function FileTreeNode({
  node, depth, selectedFile, onSelect, expandedDirs, onToggleDir, checkable, checked, onToggleCheck,
}: {
  node: TreeNode; depth: number; selectedFile: string | null;
  onSelect: (path: string) => void; expandedDirs: Set<string>; onToggleDir: (path: string) => void;
  checkable: boolean; checked: Set<string>; onToggleCheck: (path: string, e: React.MouseEvent) => void;
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
        {isExpanded && node.children.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selectedFile={selectedFile}
            onSelect={onSelect} expandedDirs={expandedDirs} onToggleDir={onToggleDir}
            checkable={checkable} checked={checked} onToggleCheck={onToggleCheck} />
        ))}
      </div>
    );
  }

  const file = node.file!;
  const isSelected = selectedFile === file.path;
  return (
    <div
      className={cn("flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors",
        isSelected ? "bg-accent" : "hover:bg-accent/40")}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={() => onSelect(file.path)}
    >
      {checkable && (
        <input type="checkbox" checked={checked.has(file.path)}
          onClick={(e) => onToggleCheck(file.path, e)} onChange={() => {}} className="size-3 accent-primary" />
      )}
      <StatusIcon kind={file.kind} />
      <span className="flex-1 truncate">{node.name}</span>
      <Badge variant="secondary" className="h-4 w-4 justify-center p-0 text-[9px] font-bold">{kindBadge(file.kind)}</Badge>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export function DiffPanel({ files, fetchDiff, checkable = false, checked, onCheckedChange }: DiffPanelProps) {
  const [viewMode, setViewMode] = useState<"tree" | "flat">("tree");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<DiffPatch | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [leftWidth, setLeftWidth] = useState(220);

  const tree = useMemo(() => buildTree(files), [files]);
  const checkedSet = checked ?? new Set<string>();

  // 自动展开所有目录
  useEffect(() => {
    const dirs = new Set<string>();
    function collect(nodes: TreeNode[]) { for (const n of nodes) { if (n.isDir) { dirs.add(n.path); collect(n.children); } } }
    collect(tree);
    setExpandedDirs(dirs);
  }, [tree]);

  // 当 files 变化时清除选中
  useEffect(() => { setSelectedFile(null); setFileDiff(null); }, [files]);

  const selectFile = async (path: string) => {
    if (selectedFile === path) { setSelectedFile(null); setFileDiff(null); return; }
    setSelectedFile(path); setDiffLoading(true);
    try { setFileDiff(await fetchDiff(path)); }
    catch { setFileDiff(null); }
    finally { setDiffLoading(false); }
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => { const next = new Set(prev); if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath); return next; });
  };

  const toggleCheck = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onCheckedChange) return;
    const next = new Set(checkedSet);
    if (next.has(path)) next.delete(path); else next.add(path);
    onCheckedChange(next);
  };

  const toggleAll = () => {
    if (!onCheckedChange) return;
    onCheckedChange(checkedSet.size === files.length ? new Set() : new Set(files.map((f) => f.path)));
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* 左:文件列表 */}
      <div className="flex shrink-0 flex-col border-r border-border/50" style={{ width: `${leftWidth}px` }}>
        <div className="flex items-center gap-2 border-b border-border/30 px-2 py-1.5">
          {checkable && (
            <>
              <input type="checkbox" checked={files.length > 0 && checkedSet.size === files.length}
                onChange={toggleAll} className="size-3 accent-primary" />
              <span className="text-[11px] text-muted-foreground">{checkedSet.size}/{files.length}</span>
            </>
          )}
          {!checkable && (
            <span className="text-[11px] text-muted-foreground">{files.length} 个文件</span>
          )}
          <span className="flex-1" />
          <button type="button" onClick={() => setViewMode("flat")}
            className={cn("rounded p-0.5 transition-colors", viewMode === "flat" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")} title="平铺">
            <List className="size-3.5" />
          </button>
          <button type="button" onClick={() => setViewMode("tree")}
            className={cn("rounded p-0.5 transition-colors", viewMode === "tree" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")} title="树形">
            <FolderTree className="size-3.5" />
          </button>
        </div>
        <ScrollArea className="flex-1">
          <div className="py-1">
            {files.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">无文件</p>
            ) : viewMode === "tree" ? (
              tree.map((node) => (
                <FileTreeNode key={node.path} node={node} depth={0} selectedFile={selectedFile}
                  onSelect={selectFile} expandedDirs={expandedDirs} onToggleDir={toggleDir}
                  checkable={checkable} checked={checkedSet} onToggleCheck={toggleCheck} />
              ))
            ) : (
              [...files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => (
                <div key={file.path} onClick={() => selectFile(file.path)}
                  className={cn("flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors",
                    selectedFile === file.path ? "bg-accent" : "hover:bg-accent/40")}>
                  {checkable && <input type="checkbox" checked={checkedSet.has(file.path)}
                    onClick={(e) => toggleCheck(file.path, e)} onChange={() => {}} className="size-3 accent-primary" />}
                  <StatusIcon kind={file.kind} />
                  <span className="flex-1 truncate text-muted-foreground">{file.path}</span>
                  <Badge variant="secondary" className="h-4 w-4 justify-center p-0 text-[9px] font-bold">{kindBadge(file.kind)}</Badge>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 拖拽分隔条 */}
      <ResizeHandle direction="horizontal" size={leftWidth} onResize={setLeftWidth} minSize={140} snapTo={220} />

      {/* 右:Diff 预览 */}
      <div className="w-0 flex-1 overflow-hidden">
          {!selectedFile && (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">选择文件查看变更</div>
          )}
          {selectedFile && diffLoading && (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">加载中…</div>
          )}
          {selectedFile && !diffLoading && fileDiff && (
            <DiffViewer patch={fileDiff.patch} filePath={fileDiff.path} additions={fileDiff.additions} deletions={fileDiff.deletions} />
          )}
          {selectedFile && !diffLoading && !fileDiff && (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">无法加载 diff</div>
          )}
      </div>
    </div>
  );
}
