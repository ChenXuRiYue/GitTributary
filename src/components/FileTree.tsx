import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface FileTreeLeaf {
  id: string;
  path: string;
  label: string;
  subtitle?: string;
  icon?: LucideIcon;
  marker?: "active" | "muted" | "warning" | "error";
  kind?: "file" | "folder";
}

interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  children: Map<string, FileTreeNode>;
  leaf?: FileTreeLeaf;
}

interface FileTreeProps {
  items: FileTreeLeaf[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onContextMenu?: (item: FileTreeLeaf, point: { x: number; y: number }) => void;
  defaultOpen?: "all" | "first-level";
  showFolderCount?: boolean;
  allowHorizontalScroll?: boolean;
  className?: string;
}

function markerClass(marker?: FileTreeLeaf["marker"]) {
  switch (marker) {
    case "active":
      return "bg-green-500";
    case "warning":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    case "muted":
    default:
      return "bg-muted-foreground/35";
  }
}

function createNode(name: string, path: string): FileTreeNode {
  return {
    id: path || "__root__",
    name,
    path,
    children: new Map(),
  };
}

function buildTree(items: FileTreeLeaf[]) {
  const root = createNode("", "");

  for (const item of items) {
    const parts = item.path.split("/").filter(Boolean);
    const safeParts = parts.length > 0 ? parts : [item.label];
    let cursor = root;

    safeParts.forEach((part, index) => {
      const path = safeParts.slice(0, index + 1).join("/");
      let next = cursor.children.get(part);
      if (!next) {
        next = createNode(part, path);
        cursor.children.set(part, next);
      }
      cursor = next;

      if (index === safeParts.length - 1) {
        cursor.leaf = item;
        cursor.id = item.id;
      }
    });
  }

  return root;
}

function sortedChildren(node: FileTreeNode) {
  return Array.from(node.children.values()).sort((a, b) => {
    const aDir = !a.leaf || a.children.size > 0;
    const bDir = !b.leaf || b.children.size > 0;
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.name.localeCompare(b.name);
  });
}

function collectOpenPaths(node: FileTreeNode, mode: "all" | "first-level") {
  const paths = new Set<string>();

  function walk(current: FileTreeNode, depth: number) {
    if (current.children.size > 0 && current.path && (mode === "all" || depth <= 1)) {
      paths.add(current.path);
    }
    for (const child of current.children.values()) {
      walk(child, depth + 1);
    }
  }

  walk(node, 0);
  return paths;
}

function TreeRow({
  node,
  depth,
  selectedId,
  openPaths,
  onToggle,
  onSelect,
  onContextMenu,
  showFolderCount,
  allowHorizontalScroll,
}: {
  node: FileTreeNode;
  depth: number;
  selectedId?: string;
  openPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect?: (id: string) => void;
  onContextMenu?: (item: FileTreeLeaf, point: { x: number; y: number }) => void;
  showFolderCount: boolean;
  allowHorizontalScroll: boolean;
}) {
  const hasChildren = node.children.size > 0;
  const isFolder = node.leaf?.kind === "folder" || (hasChildren && !node.leaf);
  const isOpen = openPaths.has(node.path);
  const selected = node.leaf?.id === selectedId;
  const LeafIcon = node.leaf?.icon ?? File;
  const indent = depth * 14 + 8;
  const suppressClickRef = useRef(false);

  if (isFolder) {
    const selected = node.leaf?.id === selectedId;
    return (
      <div>
        <button
          type="button"
          onMouseDown={(event) => {
            if (event.button === 2) {
              suppressClickRef.current = true;
            }
          }}
          onContextMenu={(event) => {
            if (!node.leaf) return;
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = true;
            onContextMenu?.(node.leaf, { x: event.clientX, y: event.clientY });
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onToggle(node.path);
            if (node.leaf?.kind === "folder") {
              onSelect?.(node.leaf.id);
            }
          }}
          className={cn(
            "gt-tree flex h-7 min-w-0 items-center gap-1.5 px-2 pr-3 text-left text-muted-foreground transition-colors hover:bg-accent/45",
            allowHorizontalScroll ? "w-max min-w-full" : "w-full",
            selected && "bg-accent text-accent-foreground",
          )}
          style={{ paddingLeft: indent }}
        >
          {hasChildren ? (
            isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          {hasChildren && isOpen ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
          <span className={cn("min-w-0 flex-1", allowHorizontalScroll ? "whitespace-nowrap" : "truncate")}>
            {node.name}
          </span>
          {node.leaf?.marker && <span className={cn("size-1.5 rounded-full", markerClass(node.leaf.marker))} />}
          {showFolderCount && (
            <span className="gt-tree-meta rounded-sm px-1 font-mono text-muted-foreground/65">
              {node.children.size}
            </span>
          )}
        </button>
        {isOpen && sortedChildren(node).map((child) => (
          <TreeRow
            key={child.path || child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            openPaths={openPaths}
            onToggle={onToggle}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            showFolderCount={showFolderCount}
            allowHorizontalScroll={allowHorizontalScroll}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onContextMenu={(event) => {
        if (!node.leaf) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(node.leaf, { x: event.clientX, y: event.clientY });
      }}
      onClick={() => node.leaf && onSelect?.(node.leaf.id)}
      className={cn(
        "grid h-8 min-w-0 items-center gap-2 px-3 text-left transition-colors",
        allowHorizontalScroll ? "w-max min-w-full grid-cols-[16px_auto_auto]" : "w-full grid-cols-[16px_1fr_auto]",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/45",
      )}
      style={{ paddingLeft: indent + 18 }}
    >
      <LeafIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className={cn("gt-tree", allowHorizontalScroll ? "whitespace-nowrap" : "truncate")}>
          {node.leaf?.label ?? node.name}
        </p>
        {node.leaf?.subtitle && (
          <p className={cn("gt-tree-meta text-muted-foreground", allowHorizontalScroll ? "whitespace-nowrap" : "truncate")}>
            {node.leaf.subtitle}
          </p>
        )}
      </div>
      {node.leaf?.marker && <span className={cn("size-1.5 rounded-full", markerClass(node.leaf.marker))} />}
    </button>
  );
}

export function FileTree({
  items,
  selectedId,
  onSelect,
  onContextMenu,
  defaultOpen = "all",
  showFolderCount = false,
  allowHorizontalScroll = false,
  className,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(items), [items]);
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => collectOpenPaths(tree, defaultOpen));

  useEffect(() => {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      for (const path of collectOpenPaths(tree, defaultOpen)) {
        next.add(path);
      }
      return next;
    });
  }, [tree, defaultOpen]);

  const togglePath = (path: string) => {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className={cn("py-1", allowHorizontalScroll && "min-w-max pr-2", className)}>
      {sortedChildren(tree).map((node) => (
        <TreeRow
          key={node.path || node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          openPaths={openPaths}
          onToggle={togglePath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          showFolderCount={showFolderCount}
          allowHorizontalScroll={allowHorizontalScroll}
        />
      ))}
    </div>
  );
}
