import { useEffect, useMemo, useRef, useState } from "react";
import {
  File,
  FileCode2,
  FileText,
  Folder,
  ChevronRight,
  ChevronDown,
  List,
  FolderTree,
} from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { DiffViewer } from "./DiffViewer";
import { ResizeHandle } from "@/shared/components/ResizeHandle";
import { cn } from "@/shared/lib/utils";

// ─── Unified types (same shape for workdir changes & commit changes) ──

export interface DiffFileEntry {
  path: string;
  kind: string; // "Added" | "Modified" | "Deleted" | "Renamed" | "TypeChanged" | "Untracked" | "Conflicted"
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

function collectFilePaths(node: TreeNode): string[] {
  if (!node.isDir) return node.file ? [node.file.path] : [];
  return node.children.flatMap(collectFilePaths);
}

// ─── Icons ────────────────────────────────────────────────────────────

function PathIcon({ path }: { path: string }) {
  const c = "size-3.5 shrink-0";
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
    case "mdx":
    case "markdown":
    case "txt":
      return <FileText className={cn(c, "text-sky-600")} />;
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "css":
    case "html":
    case "json":
    case "rs":
    case "toml":
    case "yml":
    case "yaml":
      return <FileCode2 className={cn(c, "text-violet-600")} />;
    default:
      return <File className={cn(c, "text-muted-foreground")} />;
  }
}

function kindBadge(kind: string): string {
  switch (kind) {
    case "Added": return "A";
    case "Modified": return "M";
    case "Deleted": return "D";
    case "Renamed": return "R";
    case "TypeChanged": return "T";
    case "Untracked": return "U";
    case "Conflicted": return "C";
    default: return "?";
  }
}

function kindBadgeClass(kind: string): string {
  switch (kind) {
    case "Added": return "bg-green-600/10 text-green-700 dark:text-green-400";
    case "Modified": return "bg-yellow-600/10 text-yellow-700 dark:text-yellow-400";
    case "Deleted": return "bg-red-600/10 text-red-700 dark:text-red-400";
    case "Renamed": return "bg-blue-600/10 text-blue-700 dark:text-blue-400";
    case "TypeChanged": return "bg-purple-600/10 text-purple-700 dark:text-purple-400";
    case "Untracked": return "bg-sky-600/10 text-sky-700 dark:text-sky-400";
    case "Conflicted": return "bg-destructive/10 text-destructive";
    default: return "bg-muted text-muted-foreground";
  }
}

function StatusBadge({ kind }: { kind: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "h-4 w-4 shrink-0 justify-center p-0 text-[9px] font-bold",
        kindBadgeClass(kind),
      )}
      title={kind}
    >
      {kindBadge(kind)}
    </Badge>
  );
}

function StatusCell({ kind, selected = false }: { kind?: string; selected?: boolean }) {
  return (
    <span
      className={cn(
        "sticky right-1.5 z-10 ml-2 flex shrink-0 justify-center rounded-sm py-0.5 pl-1",
        selected ? "bg-accent" : "bg-background group-hover:bg-accent/40",
      )}
      style={{ width: STATUS_COLUMN_WIDTH }}
    >
      {kind ? <StatusBadge kind={kind} /> : null}
    </span>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  title,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  title?: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={onChange}
      title={title}
      className="size-3 shrink-0 accent-primary"
    />
  );
}

// ─── Tree Node ────────────────────────────────────────────────────────

const TREE_BASE_PADDING = 4;
const TREE_INDENT = 16;
const STATUS_COLUMN_WIDTH = 28;
const CHECKBOX_COLUMN_WIDTH = 14;
const ICON_COLUMN_WIDTH = 16;

function FileTreeNode({
  node, depth, selectedFile, onSelect, expandedDirs, onToggleDir, checkable, checked, onToggleCheck, onToggleDirCheck,
}: {
  node: TreeNode; depth: number; selectedFile: string | null;
  onSelect: (path: string) => void; expandedDirs: Set<string>; onToggleDir: (path: string) => void;
  checkable: boolean; checked: Set<string>; onToggleCheck: (path: string) => void; onToggleDirCheck: (paths: string[]) => void;
}) {
  if (node.isDir) {
    const isExpanded = expandedDirs.has(node.path);
    const filePaths = collectFilePaths(node);
    const checkedCount = filePaths.filter((path) => checked.has(path)).length;
    const allChecked = filePaths.length > 0 && checkedCount === filePaths.length;
    const someChecked = checkedCount > 0 && checkedCount < filePaths.length;
    return (
      <div>
        <div
          className="group flex cursor-pointer items-center gap-1 rounded py-0.5 text-xs text-muted-foreground hover:bg-accent/50"
          style={{ paddingLeft: `${TREE_BASE_PADDING + depth * TREE_INDENT}px` }}
          onClick={() => onToggleDir(node.path)}
        >
          <span className="flex size-3 shrink-0 items-center justify-center">
            {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </span>
          <span className="flex shrink-0 items-center justify-center" style={{ width: CHECKBOX_COLUMN_WIDTH }}>
            {checkable && (
              <SelectionCheckbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={() => onToggleDirCheck(filePaths)}
                title={allChecked ? "取消选择此文件夹" : "选择此文件夹"}
              />
            )}
          </span>
          <span className="flex shrink-0 items-center justify-center" style={{ width: ICON_COLUMN_WIDTH }}>
            <Folder className="size-3.5 text-muted-foreground/70" />
          </span>
          <span className="shrink-0 whitespace-nowrap">{node.name}</span>
          <span className="min-w-4 flex-1" />
          <StatusCell />
        </div>
        {isExpanded && node.children.map((child) => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selectedFile={selectedFile}
            onSelect={onSelect} expandedDirs={expandedDirs} onToggleDir={onToggleDir}
            checkable={checkable} checked={checked} onToggleCheck={onToggleCheck} onToggleDirCheck={onToggleDirCheck} />
        ))}
      </div>
    );
  }

  const file = node.file!;
  const isSelected = selectedFile === file.path;
  return (
    <div
      className={cn("group flex cursor-pointer items-center gap-1.5 rounded py-0.5 text-xs transition-colors",
        isSelected ? "bg-accent" : "hover:bg-accent/40")}
      style={{
        paddingLeft: `${TREE_BASE_PADDING + depth * TREE_INDENT + 13}px`,
      }}
      onClick={() => onSelect(file.path)}
    >
      <span className="flex shrink-0 items-center justify-center" style={{ width: CHECKBOX_COLUMN_WIDTH }}>
        {checkable && (
          <SelectionCheckbox
            checked={checked.has(file.path)}
            onChange={() => onToggleCheck(file.path)}
            title={checked.has(file.path) ? "取消选择此文件" : "选择此文件"}
          />
        )}
      </span>
      <span className="flex shrink-0 items-center justify-center" style={{ width: ICON_COLUMN_WIDTH }}>
        <PathIcon path={file.path} />
      </span>
      <span className="shrink-0 whitespace-nowrap">{node.name}</span>
      <span className="min-w-4 flex-1" />
      <StatusCell kind={file.kind} selected={isSelected} />
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
  const diffRequestGenerationRef = useRef(0);

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
  useEffect(() => {
    diffRequestGenerationRef.current += 1;
    setSelectedFile(null);
    setFileDiff(null);
    setDiffLoading(false);
  }, [files]);

  const selectFile = async (path: string) => {
    const requestGeneration = ++diffRequestGenerationRef.current;
    if (selectedFile === path) {
      setSelectedFile(null);
      setFileDiff(null);
      setDiffLoading(false);
      return;
    }
    setSelectedFile(path);
    setFileDiff(null);
    setDiffLoading(true);
    try {
      const nextDiff = await fetchDiff(path);
      if (requestGeneration === diffRequestGenerationRef.current) setFileDiff(nextDiff);
    } catch {
      if (requestGeneration === diffRequestGenerationRef.current) setFileDiff(null);
    } finally {
      if (requestGeneration === diffRequestGenerationRef.current) setDiffLoading(false);
    }
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => { const next = new Set(prev); if (next.has(dirPath)) next.delete(dirPath); else next.add(dirPath); return next; });
  };

  const toggleCheck = (path: string) => {
    if (!onCheckedChange) return;
    const next = new Set(checkedSet);
    if (next.has(path)) next.delete(path); else next.add(path);
    onCheckedChange(next);
  };

  const toggleDirCheck = (paths: string[]) => {
    if (!onCheckedChange || paths.length === 0) return;
    const next = new Set(checkedSet);
    const allChecked = paths.every((path) => next.has(path));
    for (const path of paths) {
      if (allChecked) next.delete(path); else next.add(path);
    }
    onCheckedChange(next);
  };

  const toggleAll = () => {
    if (!onCheckedChange) return;
    onCheckedChange(checkedSet.size === files.length ? new Set() : new Set(files.map((f) => f.path)));
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* 左:文件列表 */}
      <div className="flex min-h-0 shrink-0 flex-col border-r border-border/50" style={{ width: `${leftWidth}px` }}>
        <div className="flex items-center gap-2 border-b border-border/30 px-2 py-1.5">
          {checkable && (
            <>
              <input type="checkbox" checked={files.length > 0 && checkedSet.size === files.length}
                onChange={toggleAll} className="size-3 accent-primary" />
              <span className="text-[11px] text-muted-foreground">已选 {checkedSet.size}/{files.length}</span>
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
        <div className="gt-thin-scroll min-h-0 flex-1 overflow-auto overscroll-contain" data-diff-file-list>
          <div className="w-max min-w-full py-1 pb-3">
            {files.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">无文件</p>
            ) : viewMode === "tree" ? (
              tree.map((node) => (
                <FileTreeNode key={node.path} node={node} depth={0} selectedFile={selectedFile}
                  onSelect={selectFile} expandedDirs={expandedDirs} onToggleDir={toggleDir}
                  checkable={checkable} checked={checkedSet} onToggleCheck={toggleCheck} onToggleDirCheck={toggleDirCheck} />
              ))
            ) : (
              [...files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => (
                <div key={file.path} onClick={() => selectFile(file.path)}
                  className={cn("group flex cursor-pointer items-center gap-1.5 rounded py-0.5 pl-2 text-xs transition-colors",
                    selectedFile === file.path ? "bg-accent" : "hover:bg-accent/40")}>
                  <span className="flex shrink-0 items-center justify-center" style={{ width: CHECKBOX_COLUMN_WIDTH }}>
                    {checkable && (
                      <SelectionCheckbox
                        checked={checkedSet.has(file.path)}
                        onChange={() => toggleCheck(file.path)}
                        title={checkedSet.has(file.path) ? "取消选择此文件" : "选择此文件"}
                      />
                    )}
                  </span>
                  <span className="flex shrink-0 items-center justify-center" style={{ width: ICON_COLUMN_WIDTH }}>
                    <PathIcon path={file.path} />
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">{file.path}</span>
                  <span className="min-w-4 flex-1" />
                  <StatusCell kind={file.kind} selected={selectedFile === file.path} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 拖拽分隔条 */}
      <ResizeHandle direction="horizontal" size={leftWidth} onResize={setLeftWidth} minSize={140} snapTo={220} />

      {/* 右:Diff 预览 */}
      <div className="min-h-0 w-0 flex-1 overflow-hidden">
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
