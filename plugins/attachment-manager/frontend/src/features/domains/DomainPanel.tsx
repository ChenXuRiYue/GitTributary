import { useEffect, useRef } from "react";
import { ArrowLeft, Globe2, Search } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { PAGE_SIZE, Pagination } from "../../components/Pagination";
import { compactSelectClass } from "../../components/styles";
import { AttachmentRow } from "../inventory/AttachmentItems";
import { linkFilters, type LinkFilter } from "../inventory/model";
import type { DomainSort, DomainStats } from "./model";

export function DomainPanel({
  domains,
  allDomains,
  query,
  onQueryChange,
  sort,
  onSortChange,
  domainPage,
  onDomainPageChange,
  resourcePage,
  onResourcePageChange,
  resourceKind,
  onResourceKindChange,
  selectedDomain,
  selectedPath,
  onSelectDomain,
  onClearDomain,
  onSelectAttachment,
}: {
  domains: DomainStats[];
  allDomains: DomainStats[];
  query: string;
  onQueryChange: (value: string) => void;
  sort: DomainSort;
  onSortChange: (value: DomainSort) => void;
  domainPage: number;
  onDomainPageChange: (page: number) => void;
  resourcePage: number;
  onResourcePageChange: (page: number) => void;
  resourceKind: LinkFilter;
  onResourceKindChange: (kind: LinkFilter) => void;
  selectedDomain: DomainStats | null;
  selectedPath: string | null;
  onSelectDomain: (domain: string) => void;
  onClearDomain: () => void;
  onSelectAttachment: (path: string) => void;
}) {
  const previousQueryRef = useRef(query);
  const previousDomainRef = useRef(selectedDomain?.domain);
  const domainPageCount = Math.max(1, Math.ceil(domains.length / PAGE_SIZE));
  const pagedDomains = domains.slice(domainPage * PAGE_SIZE, (domainPage + 1) * PAGE_SIZE);
  const domainResources = selectedDomain?.items.filter((item) => (
    resourceKind === "all" || (item.linkKind ?? "unknown") === resourceKind
  )) ?? [];
  const resourcePageCount = Math.max(1, Math.ceil(domainResources.length / PAGE_SIZE));
  const pagedResources = domainResources.slice(resourcePage * PAGE_SIZE, (resourcePage + 1) * PAGE_SIZE);
  const domainCount = allDomains.length;
  const remoteResourceCount = allDomains.reduce((sum, item) => sum + item.total, 0);
  const imageLinkCount = allDomains.reduce((sum, item) => sum + item.image, 0);
  const referenceCount = allDomains.reduce((sum, item) => sum + item.references, 0);

  useEffect(() => {
    if (previousQueryRef.current === query) return;
    previousQueryRef.current = query;
    onDomainPageChange(0);
  }, [onDomainPageChange, query]);
  useEffect(() => {
    if (previousDomainRef.current === selectedDomain?.domain) return;
    previousDomainRef.current = selectedDomain?.domain;
    onResourcePageChange(0);
    onResourceKindChange("all");
  }, [onResourceKindChange, onResourcePageChange, selectedDomain?.domain]);
  useEffect(() => {
    if (domainPage >= domainPageCount) onDomainPageChange(domainPageCount - 1);
  }, [domainPage, domainPageCount, onDomainPageChange]);
  useEffect(() => {
    if (resourcePage >= resourcePageCount) onResourcePageChange(resourcePageCount - 1);
  }, [onResourcePageChange, resourcePage, resourcePageCount]);

  if (selectedDomain) {
    return (
      <div className="min-w-0">
        <div className="border-border/50 -mx-3 -mt-3 mb-2 flex min-h-11 min-w-0 items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="icon" className="size-7" onClick={onClearDomain} title="返回全部域名">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="na-title-panel truncate" title={selectedDomain.domain}>{selectedDomain.domain}</h2>
            <p className="text-muted-foreground na-caption mt-0.5">
              {selectedDomain.total} 个资源 · {selectedDomain.references} 次引用 · {selectedDomain.uniqueNotes} 篇笔记
              {` · 嵌入 ${selectedDomain.embed} · 导航 ${selectedDomain.navigation}`}
            </p>
          </div>
          <select
            value={resourceKind}
            onChange={(event) => {
              onResourceKindChange(event.target.value as LinkFilter);
              onResourcePageChange(0);
            }}
            className={cn(compactSelectClass, "max-w-28")}
            aria-label="资源类型"
          >
            {linkFilters.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        {pagedResources.length === 0 ? (
          <div className="text-muted-foreground flex min-h-40 items-center justify-center na-body">没有匹配的资源</div>
        ) : (
          <div className="divide-border divide-y">
            {pagedResources.map((item) => (
              <AttachmentRow
                key={item.path}
                item={item}
                selected={item.path === selectedPath}
                onSelect={onSelectAttachment}
              />
            ))}
          </div>
        )}
        <Pagination
          page={resourcePage}
          pageCount={resourcePageCount}
          total={domainResources.length}
          onPageChange={onResourcePageChange}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="border-border/50 -mx-3 -mt-3 mb-3 flex min-h-11 min-w-0 items-center gap-2 border-b px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索域名"
            className="h-7 pl-8"
          />
        </div>
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as DomainSort)}
          className={compactSelectClass}
          aria-label="域名排序"
        >
          <option value="resources">按资源数</option>
          <option value="images">按图片数</option>
          <option value="references">按引用数</option>
          <option value="notes">按笔记数</option>
        </select>
        <span className="text-muted-foreground na-caption hidden shrink-0 lg:inline">
          域名 {domainCount} / 资源 {remoteResourceCount} / 图片 {imageLinkCount} / 引用 {referenceCount}
        </span>
      </div>
      {domains.length === 0 ? (
        <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center text-center">
          <Globe2 className="mb-3 size-7" />
          <span className="na-body">{domainCount === 0 ? "没有可统计的链接域名" : "没有匹配的域名"}</span>
        </div>
      ) : (
        <div className="border-border/50 min-w-0 overflow-x-auto border">
          <div className="border-border/50 bg-muted/20 text-muted-foreground na-label sticky top-0 grid min-w-[700px] grid-cols-[minmax(180px,1fr)_64px_repeat(6,52px)_64px_64px] items-center gap-2 border-b px-2 py-2">
            <span>域名</span>
            <span className="text-right">资源</span>
            <span className="text-right">图片</span>
            <span className="text-right">音频</span>
            <span className="text-right">视频</span>
            <span className="text-right">网站</span>
            <span className="text-right">下载</span>
            <span className="text-right">未知</span>
            <span className="text-right">引用</span>
            <span className="text-right">笔记</span>
          </div>
          <div className="divide-border/20 divide-y">
            {pagedDomains.map((item) => (
              <button
                key={item.domain}
                type="button"
                onClick={() => onSelectDomain(item.domain)}
                className="hover:bg-accent/40 na-caption grid h-10 w-full min-w-[700px] grid-cols-[minmax(180px,1fr)_64px_repeat(6,52px)_64px_64px] items-center gap-2 px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span className="na-body-strong flex min-w-0 items-center gap-2 truncate" title={item.domain}>
                  <Globe2 className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{item.domain}</span>
                </span>
                <span className="text-right tabular-nums">{item.total}</span>
                <span className="text-right tabular-nums">{item.image}</span>
                <span className="text-right tabular-nums">{item.audio}</span>
                <span className="text-right tabular-nums">{item.video}</span>
                <span className="text-right tabular-nums">{item.website}</span>
                <span className="text-right tabular-nums">{item.download}</span>
                <span className="text-right tabular-nums">{item.unknown}</span>
                <span className="text-right tabular-nums">{item.references}</span>
                <span className="text-right tabular-nums">{item.uniqueNotes}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Pagination
        page={domainPage}
        pageCount={domainPageCount}
        total={domains.length}
        onPageChange={onDomainPageChange}
      />
    </div>
  );
}
