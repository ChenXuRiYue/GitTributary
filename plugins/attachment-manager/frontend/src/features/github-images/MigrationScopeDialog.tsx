import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  X,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

import { registerPluginModal } from "../../bridge";
import type { ImageMigrationFileScope } from "../../types";
import {
  allMigrationFolders,
  buildMigrationFolderTree,
  resolveMigrationFileScope,
  selectableFolders,
  uniqueMigrationImages,
  type MigrationContentFile,
  type MigrationFolderNode,
} from "./migration-file-scope";

export function MigrationScopeDialog({
  open,
  files,
  scope,
  onCancel,
  onApply,
}: {
  open: boolean;
  files: MigrationContentFile[];
  scope: ImageMigrationFileScope;
  onCancel: () => void;
  onApply: (scope: ImageMigrationFileScope) => void;
}) {
  const titleId = useId();
  const allFolders = useMemo(() => allMigrationFolders(files), [files]);
  const folderTree = useMemo(() => buildMigrationFolderTree(files), [files]);
  const [draft, setDraft] = useState<ImageMigrationFileScope>(scope);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    return registerPluginModal("standard");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDraft({
      ...scope,
      manualFolders: scope.manualFolders ?? allFolders,
    });
    setCollapsed(new Set());
  }, [allFolders, open, scope]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, open]);

  if (!open) return null;

  const selectedFolders = new Set(draft.manualFolders ?? allFolders);
  const preview = resolveMigrationFileScope(files, draft);
  const previewImages = uniqueMigrationImages(preview.files);
  const toggleFolderSelection = (paths: string[], selected: boolean) => {
    setDraft((current) => {
      const next = new Set(current.manualFolders ?? allFolders);
      for (const path of paths) {
        if (selected) next.add(path);
        else next.delete(path);
      }
      return { ...current, manualFolders: [...next] };
    });
  };
  const toggleCollapsed = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-border bg-background flex h-[500px] max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden border shadow-xl"
      >
        <header className="border-border/60 flex min-h-11 shrink-0 items-center gap-3 border-b px-4">
          <h2 id={titleId} className="na-title-panel">配置文件范围</h2>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7"
            onClick={onCancel}
            aria-label="关闭"
            title="关闭"
          >
            <X />
          </Button>
        </header>

        <div className="border-border/50 flex shrink-0 items-center border-b px-4 py-2.5">
          <div className="border-input inline-grid grid-cols-2 rounded-md border p-0.5" role="radiogroup" aria-label="文件范围方式">
            <ScopeModeOption
              value="manual"
              selected={draft.mode === "manual"}
              label="手动范围"
              icon={Folder}
              onSelect={() => setDraft((current) => ({ ...current, mode: "manual" }))}
            />
            <ScopeModeOption
              value="rules"
              selected={draft.mode === "rules"}
              label="忽略规则"
              icon={FileCode2}
              onSelect={() => setDraft((current) => ({ ...current, mode: "rules" }))}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-3">
          {draft.mode === "manual" ? (
            <div className="border-border/60 na-thin-scroll h-full overflow-y-auto border">
              <FolderScopeRow
                node={folderTree}
                depth={0}
                selectedFolders={selectedFolders}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
                onToggleSelection={toggleFolderSelection}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <Textarea
                value={draft.rules}
                onChange={(event) => setDraft((current) => ({ ...current, rules: event.target.value }))}
                placeholder={"/docs/generated/\n**/draft/**\n!docs/draft/release.md"}
                aria-label="忽略规则"
                aria-invalid={preview.error ? true : undefined}
                className="min-h-0 flex-1 resize-none rounded-none font-mono text-xs leading-5"
                autoFocus
              />
              {preview.error && (
                <div className="text-destructive na-caption mt-2 break-all">{preview.error}</div>
              )}
            </div>
          )}
        </div>

        <footer className="border-border/60 bg-muted/20 flex min-h-12 shrink-0 items-center gap-2 border-t px-4 py-2.5">
          <span className="text-muted-foreground na-caption tabular-nums">
            {preview.files.length} 个文件 · {previewImages.length} 张图片
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2.5"
            onClick={() => setDraft((current) => current.mode === "manual"
              ? { ...current, manualFolders: allFolders }
              : { ...current, rules: "" })}
          >
            重置
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            className="h-7 px-2.5"
            disabled={Boolean(preview.error)}
            onClick={() => onApply({
              ...draft,
              manualFolders: draft.manualFolders ?? allFolders,
            })}
          >
            应用
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ScopeModeOption({
  value,
  selected,
  label,
  icon: Icon,
  onSelect,
}: {
  value: ImageMigrationFileScope["mode"];
  selected: boolean;
  label: string;
  icon: typeof Folder;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-value={value}
      className={cn(
        "na-caption flex h-7 items-center justify-center gap-1.5 rounded-sm px-3 transition-colors",
        selected ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function FolderScopeRow({
  node,
  depth,
  selectedFolders,
  collapsed,
  onToggleCollapsed,
  onToggleSelection,
}: {
  node: MigrationFolderNode;
  depth: number;
  selectedFolders: Set<string>;
  collapsed: Set<string>;
  onToggleCollapsed: (path: string) => void;
  onToggleSelection: (paths: string[], selected: boolean) => void;
}) {
  const paths = selectableFolders(node);
  const selectedCount = paths.filter((path) => selectedFolders.has(path)).length;
  const allSelected = paths.length > 0 && selectedCount === paths.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const expanded = !collapsed.has(node.path);
  const hasChildren = node.children.length > 0;
  const label = node.path ? `文件夹 ${node.path}` : "仓库根目录";

  return (
    <>
      <div className="border-border/30 hover:bg-accent/30 flex min-h-8 items-center gap-1 border-b px-2 py-1">
        <span style={{ width: `${depth * 14}px` }} className="shrink-0" />
        {hasChildren ? (
          <button
            type="button"
            className="text-muted-foreground flex size-5 shrink-0 items-center justify-center"
            onClick={() => onToggleCollapsed(node.path)}
            aria-label={`${expanded ? "收起" : "展开"}${label}`}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : <span className="size-5 shrink-0" />}
        <IndeterminateCheckbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={() => onToggleSelection(paths, !allSelected)}
          label={`${allSelected ? "取消选择" : "选择"}${label}`}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => hasChildren && onToggleCollapsed(node.path)}
          title={node.path || "仓库根目录"}
        >
          {expanded && hasChildren
            ? <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
            : <Folder className="text-muted-foreground size-3.5 shrink-0" />}
          <span className="na-body min-w-0 truncate">{node.name}</span>
        </button>
        <span className="text-muted-foreground na-caption shrink-0 tabular-nums">{node.totalFileCount}</span>
      </div>
      {expanded && node.children.map((child) => (
        <FolderScopeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFolders={selectedFolders}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onToggleSelection={onToggleSelection}
        />
      ))}
    </>
  );
}

function IndeterminateCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
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
      onChange={onChange}
      className="accent-primary size-4 shrink-0"
      aria-label={label}
    />
  );
}
