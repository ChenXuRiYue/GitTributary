import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CloudUpload,
  FileText,
  Image as ImageIcon,
  ListFilter,
  LoaderCircle,
  Maximize2,
  Search,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { formatBytes } from "../../lib/attachment";
import {
  getCachedAttachmentPreview,
  loadAttachmentPreview,
  previewKey,
} from "../../lib/preview-cache";
import type { AttachmentItem, AttachmentPreview, ImageMigrationFileScope } from "../../types";
import { AttachmentTile } from "../inventory/AttachmentItems";
import { ImagePreviewDialog } from "../inventory/AttachmentPreview";
import {
  buildMigrationContentFiles,
  isMigrationFileScopeActive,
  resolveMigrationFileScope,
  uniqueMigrationImages,
  type MigrationContentFile,
} from "./migration-file-scope";
import { MigrationScopeDialog } from "./MigrationScopeDialog";

export function ImageMigrationList({
  repoPath,
  candidates,
  selectedPaths,
  selectedNotes,
  selectedBytes,
  scope,
  migrating,
  disabled = false,
  onScopeChange,
  onSelectPaths,
  onReplaceSelection,
  onMigrate,
}: {
  repoPath: string;
  candidates: AttachmentItem[];
  selectedPaths: Set<string>;
  selectedNotes: number;
  selectedBytes: number;
  scope: ImageMigrationFileScope;
  migrating: boolean;
  disabled?: boolean;
  onScopeChange: (scope: ImageMigrationFileScope) => void;
  onSelectPaths: (paths: string[], selected: boolean) => void;
  onReplaceSelection: (paths: string[]) => void;
  onMigrate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const files = useMemo(() => buildMigrationContentFiles(candidates), [candidates]);
  const scoped = useMemo(() => resolveMigrationFileScope(files, scope), [files, scope]);
  const scopedImages = useMemo(() => uniqueMigrationImages(scoped.files), [scoped.files]);
  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? scoped.files.filter((file) => (
        file.path.toLocaleLowerCase().includes(needle)
        || file.images.some((item) => item.path.toLocaleLowerCase().includes(needle))
      ))
      : scoped.files;
  }, [query, scoped.files]);

  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return;
    const imageMatches = scoped.files.filter((file) => (
      !file.path.toLocaleLowerCase().includes(needle)
      && file.images.some((item) => item.path.toLocaleLowerCase().includes(needle))
    ));
    if (imageMatches.length === 0) return;
    setExpandedFiles((current) => {
      const next = new Set(current);
      imageMatches.forEach((file) => next.add(file.path));
      return next;
    });
  }, [query, scoped.files]);
  const scopedPaths = scopedImages.map((item) => item.path);
  const selectedCount = scopedPaths.filter((path) => selectedPaths.has(path)).length;
  const allSelected = scopedPaths.length > 0 && selectedCount === scopedPaths.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const scopeActive = isMigrationFileScopeActive(scope, files);

  const applyScope = (nextScope: ImageMigrationFileScope) => {
    const next = resolveMigrationFileScope(files, nextScope);
    if (next.error) return;
    onScopeChange(nextScope);
    onReplaceSelection(uniqueMigrationImages(next.files).map((item) => item.path));
    setScopeOpen(false);
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="border-border/50 grid min-h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-y px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="gt-title-section shrink-0">待迁移图片</span>
          <span className="text-muted-foreground gt-caption min-w-0 truncate tabular-nums">
            <span>已选 {selectedCount}/{scopedPaths.length} 张</span>
            <span className="hidden xl:inline"> · {selectedNotes} 篇 · {formatBytes(selectedBytes)}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="relative w-36 xl:w-48">
            <Search className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选文件或图片"
              className="gt-body h-7 pl-7 pr-2"
              aria-label="筛选引用文件或图片"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setScopeOpen(true)}
            aria-label="配置文件范围"
            title={scopeActive ? "配置文件范围（已限制）" : "配置文件范围"}
          >
            <ListFilter />
          </Button>
          <Button
            size="sm"
            className="gt-body size-7 p-0 xl:w-auto xl:px-2.5"
            onClick={onMigrate}
            disabled={disabled || migrating || selectedCount === 0}
            aria-label={migrating ? "迁移中" : "开始迁移"}
            title={migrating ? "迁移中" : "开始迁移"}
          >
            {migrating ? <LoaderCircle className="animate-spin" /> : <CloudUpload />}
            <span className="hidden xl:inline">{migrating ? "迁移中" : "开始迁移"}</span>
          </Button>
        </div>
      </div>
      {candidates.length === 0 ? (
        <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <ImageIcon className="size-6" />
          <span className="gt-body">没有被 Markdown 引用的本地图片</span>
        </div>
      ) : (
        <MigrationFileView
          repoPath={repoPath}
          files={visibleFiles}
          scopedFileCount={scoped.files.length}
          query={query}
          expandedFiles={expandedFiles}
          selectedPaths={selectedPaths}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleFile={(path) => setExpandedFiles((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          })}
          onSelectAll={() => onSelectPaths(scopedPaths, !allSelected)}
          onSelectPaths={onSelectPaths}
        />
      )}

      <MigrationScopeDialog
        open={scopeOpen}
        files={files}
        scope={scope}
        onCancel={() => setScopeOpen(false)}
        onApply={applyScope}
      />
    </section>
  );
}

function MigrationFileView({
  repoPath,
  files,
  scopedFileCount,
  query,
  expandedFiles,
  selectedPaths,
  allSelected,
  someSelected,
  onToggleFile,
  onSelectAll,
  onSelectPaths,
}: {
  repoPath: string;
  files: MigrationContentFile[];
  scopedFileCount: number;
  query: string;
  expandedFiles: Set<string>;
  selectedPaths: Set<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggleFile: (path: string) => void;
  onSelectAll: () => void;
  onSelectPaths: (paths: string[], selected: boolean) => void;
}) {
  return (
    <div className="gt-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="border-border/30 text-muted-foreground gt-label sticky top-0 z-10 grid grid-cols-[24px_24px_minmax(120px,1fr)_48px] items-center gap-1 border-b bg-background px-3 py-1.5 sm:grid-cols-[24px_24px_minmax(160px,1fr)_56px_64px]">
        <SelectionCheckbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={onSelectAll}
          label={allSelected ? "取消选择当前范围" : "选择当前范围"}
        />
        <span />
        <span>引用文件</span>
        <span className="text-right">图片</span>
        <span className="hidden text-right sm:block">大小</span>
      </div>
      <div className="divide-border/30 divide-y">
        {files.map((file) => (
          <MigrationFileRow
            key={file.path}
            repoPath={repoPath}
            file={file}
            query={query}
            expanded={expandedFiles.has(file.path)}
            selectedPaths={selectedPaths}
            onToggle={() => onToggleFile(file.path)}
            onSelectPaths={onSelectPaths}
          />
        ))}
        {files.length === 0 && (
          <div className="text-muted-foreground gt-body px-4 py-8 text-center">
            {scopedFileCount === 0 ? "当前范围没有引用文件" : "没有匹配的引用文件"}
          </div>
        )}
      </div>
    </div>
  );
}

function MigrationFileRow({
  repoPath,
  file,
  query,
  expanded,
  selectedPaths,
  onToggle,
  onSelectPaths,
}: {
  repoPath: string;
  file: MigrationContentFile;
  query: string;
  expanded: boolean;
  selectedPaths: Set<string>;
  onToggle: () => void;
  onSelectPaths: (paths: string[], selected: boolean) => void;
}) {
  const paths = file.images.map((item) => item.path);
  const selectedCount = paths.filter((path) => selectedPaths.has(path)).length;
  const allSelected = paths.length > 0 && selectedCount === paths.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const bytes = file.images.reduce((total, item) => total + item.size, 0);
  const action = allSelected ? "取消选择" : "选择";
  const needle = query.trim().toLocaleLowerCase();
  const fileMatches = file.path.toLocaleLowerCase().includes(needle);
  const previewImages = needle && !fileMatches
    ? file.images.filter((item) => item.path.toLocaleLowerCase().includes(needle))
    : file.images;
  return (
    <div>
      <div className={cn(
        "hover:bg-accent/30 grid min-h-9 grid-cols-[24px_24px_minmax(120px,1fr)_48px] items-center gap-1 px-3 py-1 transition-colors sm:grid-cols-[24px_24px_minmax(160px,1fr)_56px_64px]",
        selectedCount > 0 && "bg-primary/5",
      )}>
        <SelectionCheckbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={() => onSelectPaths(paths, !allSelected)}
          label={`${action}文件 ${file.path}`}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded"
          onClick={onToggle}
          aria-label={`${expanded ? "收起" : "展开"}文件 ${file.path}`}
          aria-expanded={expanded}
          title={expanded ? "收起图片" : "展开图片"}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <span className="flex min-w-0 items-center gap-1.5" title={file.path}>
          <FileText className="text-muted-foreground size-3.5 shrink-0" />
          <span className="gt-body min-w-0 truncate">{file.name}</span>
          <span className="text-muted-foreground gt-caption min-w-0 truncate">
            {file.folder || "/"}
          </span>
        </span>
        <span className="gt-caption text-right tabular-nums">{selectedCount}/{paths.length}</span>
        <span className="text-muted-foreground gt-caption hidden text-right tabular-nums sm:block">{formatBytes(bytes)}</span>
      </div>
      {expanded && (
        <div className="border-border/30 bg-muted/15 ml-10 border-l px-3 py-2">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {previewImages.map((item) => {
              const selected = selectedPaths.has(item.path);
              return (
                <MigrationImageCard
                  key={item.path}
                  item={item}
                  repoPath={repoPath}
                  selected={selected}
                  onSelect={(nextSelected) => onSelectPaths([item.path], nextSelected)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MigrationImageCard({
  item,
  repoPath,
  selected,
  onSelect,
}: {
  item: AttachmentItem;
  repoPath: string;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const [dialogPreview, setDialogPreview] = useState<AttachmentPreview | null>(null);
  const [openingPreview, setOpeningPreview] = useState(false);

  const openPreview = async () => {
    setOpeningPreview(true);
    try {
      const key = previewKey(repoPath, item);
      const preview = getCachedAttachmentPreview(key) ?? await loadAttachmentPreview(repoPath, item);
      setDialogPreview(preview);
    } finally {
      setOpeningPreview(false);
    }
  };

  return (
    <>
      <div className="relative min-w-0" title={item.path}>
        <AttachmentTile
          item={item}
          repoPath={repoPath}
          selected={selected}
        />
        <span className="bg-background/90 absolute left-2 top-2 z-10 flex rounded p-0.5 shadow-sm">
          <SelectionCheckbox
            checked={selected}
            onChange={() => onSelect(!selected)}
            label={`${selected ? "取消选择" : "选择"}图片 ${item.path}`}
          />
        </span>
        <Button
          variant="secondary"
          size="icon"
          className="bg-background/90 absolute right-2 top-2 z-10 size-6 rounded shadow-sm"
          onClick={() => void openPreview()}
          disabled={openingPreview}
          aria-label={`放大预览图片 ${item.path}`}
          title="放大预览"
        >
          {openingPreview ? <LoaderCircle className="animate-spin" /> : <Maximize2 />}
        </Button>
      </div>
      {dialogPreview && (
        <ImagePreviewDialog
          item={item}
          preview={dialogPreview}
          onClose={() => setDialogPreview(null)}
        />
      )}
    </>
  );
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
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
      title={label}
    />
  );
}
