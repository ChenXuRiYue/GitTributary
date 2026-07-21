import { useMemo, useState } from "react";
import { CloudUpload, Image as ImageIcon, LoaderCircle, Search } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { formatBytes } from "../../lib/attachment";
import type { AttachmentItem } from "../../types";

export function ImageMigrationList({
  candidates,
  selectedPaths,
  selectedCount,
  selectedNotes,
  selectedBytes,
  migrating,
  onSelectAll,
  onToggle,
  onMigrate,
}: {
  candidates: AttachmentItem[];
  selectedPaths: Set<string>;
  selectedCount: number;
  selectedNotes: number;
  selectedBytes: number;
  migrating: boolean;
  onSelectAll: (selected: boolean) => void;
  onToggle: (path: string) => void;
  onMigrate: () => void;
}) {
  const [query, setQuery] = useState("");
  const visibleCandidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? candidates.filter((item) => item.path.toLocaleLowerCase().includes(needle))
      : candidates;
  }, [candidates, query]);
  const allSelected = candidates.length > 0 && selectedCount === candidates.length;
  return (
    <section className="border-border/60 border">
      <div className="border-border/50 flex min-h-11 flex-wrap items-center gap-3 border-b px-4 py-2">
        <label className="flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onSelectAll(!allSelected)}
            className="accent-primary size-4 shrink-0"
            aria-label="选择全部候选图片"
          />
          <span className="gt-title-section">待迁移图片</span>
        </label>
        <span className="text-muted-foreground gt-caption tabular-nums">
          <span>{selectedCount}/{candidates.length}</span>
          <span> 张 · {selectedNotes} 篇笔记 · {formatBytes(selectedBytes)}</span>
        </span>
        <div className="relative ml-auto w-44">
          <Search className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选路径"
            className="h-7 pl-7"
            aria-label="筛选待迁移图片"
          />
        </div>
        <Button size="sm" onClick={onMigrate} disabled={migrating || selectedCount === 0}>
          {migrating ? <LoaderCircle className="animate-spin" /> : <CloudUpload />}
          {migrating ? "正在迁移" : "上传并替换"}
        </Button>
      </div>
      {candidates.length === 0 ? (
        <div className="text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-2 p-4 text-center">
          <ImageIcon className="size-6" />
          <span className="gt-body">没有被 Markdown 引用的本地图片</span>
        </div>
      ) : (
        <div className="gt-thin-scroll max-h-[360px] overflow-y-auto">
          <div className="border-border/30 text-muted-foreground gt-label sticky top-0 grid grid-cols-[28px_minmax(140px,1fr)_48px] items-center gap-2 border-b bg-background px-4 py-2 sm:grid-cols-[28px_minmax(180px,1fr)_80px_72px]">
            <span />
            <span>本地路径</span>
            <span className="text-right">引用</span>
            <span className="hidden text-right sm:block">大小</span>
          </div>
          <div className="divide-border/30 divide-y">
            {visibleCandidates.map((item) => (
              <ImageCandidateRow
                key={item.path}
                item={item}
                checked={selectedPaths.has(item.path)}
                onToggle={onToggle}
              />
            ))}
            {visibleCandidates.length === 0 && (
              <div className="text-muted-foreground gt-body px-4 py-8 text-center">没有匹配的图片</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ImageCandidateRow({
  item,
  checked,
  onToggle,
}: {
  item: AttachmentItem;
  checked: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <label className={cn(
      "hover:bg-accent/30 grid min-h-10 cursor-pointer grid-cols-[28px_minmax(140px,1fr)_48px] items-center gap-2 px-4 py-2 transition-colors sm:grid-cols-[28px_minmax(180px,1fr)_80px_72px]",
      checked && "bg-primary/5",
    )}>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(item.path)}
        className="accent-primary size-4"
      />
      <span className="gt-body min-w-0 truncate" title={item.path}>{item.path}</span>
      <span className="gt-caption text-right tabular-nums">{item.references.length}</span>
      <span className="text-muted-foreground gt-caption hidden text-right tabular-nums sm:block">{formatBytes(item.size)}</span>
    </label>
  );
}
