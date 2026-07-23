import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";

import { Badge } from "@/shared/ui/badge";

import { pathCollator } from "./state";
import type { CaptureTreeNode, SitePathCandidate } from "./types";

export function splitPath(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function pathName(path: string): string {
  const parts = splitPath(path);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function isDirectoryNode(node: CaptureTreeNode): boolean {
  return node.children.length > 0 || node.candidate?.kind === "dir";
}

function compareCaptureNodes(a: CaptureTreeNode, b: CaptureTreeNode): number {
  const aDir = isDirectoryNode(a);
  const bDir = isDirectoryNode(b);
  if (aDir !== bDir) return aDir ? -1 : 1;
  return pathCollator.compare(a.name, b.name);
}

export function buildCaptureTree(candidates: SitePathCandidate[]): CaptureTreeNode[] {
  const root: CaptureTreeNode = { name: "", path: "", children: [] };

  for (const candidate of candidates) {
    const parts = splitPath(candidate.path);
    let cursor = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = cursor.children.find((node) => node.name === part);
      if (!child) {
        child = { name: part, path, children: [] };
        cursor.children.push(child);
      }
      cursor = child;
      if (index === parts.length - 1) {
        cursor.candidate = candidate;
      }
    });
  }

  function sortNode(node: CaptureTreeNode) {
    node.children.sort(compareCaptureNodes);
    node.children.forEach(sortNode);
  }
  sortNode(root);
  return root.children;
}

export function flattenCaptureTree(nodes: CaptureTreeNode[]): SitePathCandidate[] {
  const result: SitePathCandidate[] = [];
  function walk(node: CaptureTreeNode) {
    if (node.candidate) result.push(node.candidate);
    node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

export function orderedCandidates(candidates: SitePathCandidate[]): SitePathCandidate[] {
  return flattenCaptureTree(buildCaptureTree(candidates));
}

export function collectNodeCandidates(node: CaptureTreeNode): SitePathCandidate[] {
  const result: SitePathCandidate[] = [];
  function walk(current: CaptureTreeNode) {
    if (current.candidate) result.push(current.candidate);
    current.children.forEach(walk);
  }
  walk(node);
  return result;
}

export function collectOpenNodePaths(nodes: CaptureTreeNode[]): Set<string> {
  const paths = new Set<string>();
  function walk(node: CaptureTreeNode) {
    if (node.children.length > 0) {
      paths.add(node.path);
      node.children.forEach(walk);
    }
  }
  nodes.forEach(walk);
  return paths;
}

export function filterKnownPaths(paths: string[], knownPaths: Set<string>): string[] {
  return paths.filter((path) => knownPaths.has(path));
}

export function SelectionCheckbox({
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
      title={title}
      onClick={(event) => event.stopPropagation()}
      onChange={onChange}
      className="size-3.5 shrink-0 accent-primary"
    />
  );
}

export function CandidateMeta({ candidate }: { candidate: SitePathCandidate }) {
  return (
    <>
      <Badge variant="outline" className="h-5 shrink-0 px-1.5 na-caption">
        {candidate.kind === "dir" ? "目录" : "文件"}
      </Badge>
      <Badge variant="secondary" className="h-5 shrink-0 px-1.5 na-caption">
        {candidate.markdownCount} md
      </Badge>
    </>
  );
}

export function CaptureListItem({
  candidate,
  checked,
  onToggle,
}: {
  candidate: SitePathCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  const Icon = candidate.kind === "dir" ? Folder : FileText;

  return (
    <label className="flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-accent/40">
      <SelectionCheckbox checked={checked} onChange={onToggle} title={checked ? "取消选择" : "选择"} />
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate na-body-strong" title={candidate.path}>{candidate.path}</span>
          <CandidateMeta candidate={candidate} />
        </div>
        <div className="na-caption mt-1 truncate text-muted-foreground" title={candidate.reason.join(" / ")}>
          {candidate.reason.join(" / ")} · score {candidate.score}
        </div>
      </div>
    </label>
  );
}

export function CaptureTree({
  nodes,
  openPaths,
  selectedPaths,
  onToggleOpen,
  onToggleCandidate,
  onToggleGroup,
}: {
  nodes: CaptureTreeNode[];
  openPaths: Set<string>;
  selectedPaths: Set<string>;
  onToggleOpen: (path: string) => void;
  onToggleCandidate: (path: string) => void;
  onToggleGroup: (paths: string[]) => void;
}) {
  return (
    <div className="na-thin-scroll overflow-x-auto py-1">
      <div className="w-max min-w-full pb-2">
        {nodes.map((node) => (
          <CaptureTreeRow
            key={node.path}
            node={node}
            depth={0}
            openPaths={openPaths}
            selectedPaths={selectedPaths}
            onToggleOpen={onToggleOpen}
            onToggleCandidate={onToggleCandidate}
            onToggleGroup={onToggleGroup}
          />
        ))}
      </div>
    </div>
  );
}

export function CapturePreviewTree({ nodes }: { nodes: CaptureTreeNode[] }) {
  return (
    <div className="na-thin-scroll overflow-x-auto py-1">
      <div className="w-max min-w-full pb-2">
        {nodes.map((node) => (
          <CapturePreviewTreeRow key={node.path} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}

function CapturePreviewTreeRow({
  node,
  depth,
}: {
  node: CaptureTreeNode;
  depth: number;
}) {
  const candidatePaths = collectNodeCandidates(node);
  const markdownCount = candidatePaths.reduce((sum, candidate) => sum + candidate.markdownCount, 0);
  const isDir = isDirectoryNode(node);
  const Icon = isDir ? Folder : FileText;

  return (
    <div>
      <div
        className="group flex h-8 items-center gap-2 px-4 text-left transition-colors hover:bg-accent/30"
        style={{ paddingLeft: `${16 + depth * 18}px` }}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap na-body-strong" title={node.path}>
            {pathName(node.path)}
          </span>
          {node.candidate ? (
            <CandidateMeta candidate={node.candidate} />
          ) : (
            <>
              <Badge variant="secondary" className="h-5 shrink-0 px-1.5 na-caption">
                {candidatePaths.length} 项
              </Badge>
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 na-caption">
                {markdownCount} md
              </Badge>
            </>
          )}
        </div>
      </div>
      {node.children.map((child) => (
        <CapturePreviewTreeRow key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function CaptureTreeRow({
  node,
  depth,
  openPaths,
  selectedPaths,
  onToggleOpen,
  onToggleCandidate,
  onToggleGroup,
}: {
  node: CaptureTreeNode;
  depth: number;
  openPaths: Set<string>;
  selectedPaths: Set<string>;
  onToggleOpen: (path: string) => void;
  onToggleCandidate: (path: string) => void;
  onToggleGroup: (paths: string[]) => void;
}) {
  const hasChildren = node.children.length > 0;
  const candidatePaths = collectNodeCandidates(node).map((candidate) => candidate.path);
  const checkedCount = candidatePaths.filter((path) => selectedPaths.has(path)).length;
  const allChecked = candidatePaths.length > 0 && checkedCount === candidatePaths.length;
  const someChecked = checkedCount > 0 && checkedCount < candidatePaths.length;
  const isOpen = openPaths.has(node.path);
  const isDir = isDirectoryNode(node);
  const Icon = isDir ? Folder : FileText;

  return (
    <div>
      <div
        className="group flex h-9 cursor-pointer items-center gap-2 px-5 text-left transition-colors hover:bg-accent/40"
        style={{ paddingLeft: `${20 + depth * 18}px` }}
        onClick={() => {
          if (hasChildren) onToggleOpen(node.path);
          else if (node.candidate) onToggleCandidate(node.candidate.path);
        }}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {hasChildren ? (
            isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />
          ) : null}
        </span>
        <SelectionCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={() => onToggleGroup(candidatePaths)}
          title={allChecked ? "取消选择此分组" : "选择此分组"}
        />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap na-body-strong" title={node.path}>
            {pathName(node.path)}
          </span>
          {node.candidate ? (
            <CandidateMeta candidate={node.candidate} />
          ) : (
            <Badge variant="secondary" className="h-5 shrink-0 px-1.5 na-caption">
              {candidatePaths.length} 项
            </Badge>
          )}
          {node.candidate?.reason.length ? (
            <span className="na-caption min-w-24 truncate text-muted-foreground">
              {node.candidate.reason.join(" / ")}
            </span>
          ) : null}
        </div>
      </div>
      {hasChildren && isOpen && node.children.map((child) => (
        <CaptureTreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          openPaths={openPaths}
          selectedPaths={selectedPaths}
          onToggleOpen={onToggleOpen}
          onToggleCandidate={onToggleCandidate}
          onToggleGroup={onToggleGroup}
        />
      ))}
    </div>
  );
}
