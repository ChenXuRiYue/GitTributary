import { File, HardDrive, Image as ImageIcon, Link2, Music, Unlink } from "lucide-react";

import type { AttachmentItem, AttachmentKind, LinkKind } from "../../types";

export type Filter = "all" | "orphan" | AttachmentKind;
export type LinkFilter = "all" | LinkKind;
export type ViewMode = "grid" | "list";
export type SortMode = "name" | "size" | "references";

export const filters: { id: Filter; label: string; icon: typeof File }[] = [
  { id: "all", label: "全部附件", icon: HardDrive },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "audio", label: "音频", icon: Music },
  { id: "link", label: "链接", icon: Link2 },
  { id: "orphan", label: "孤立附件", icon: Unlink },
];

export const linkFilters: { id: LinkFilter; label: string }[] = [
  { id: "all", label: "全部链接" },
  { id: "image", label: "图片链接" },
  { id: "audio", label: "音频链接" },
  { id: "video", label: "视频链接" },
  { id: "website", label: "网站" },
  { id: "download", label: "下载" },
  { id: "unknown", label: "未知" },
];

export function countAttachments(items: AttachmentItem[]): Record<Filter, number> {
  const counts: Record<Filter, number> = {
    all: items.length,
    image: 0,
    audio: 0,
    link: 0,
    orphan: 0,
  };
  for (const item of items) {
    counts[item.kind] += 1;
    if (item.references.length === 0) counts.orphan += 1;
  }
  return counts;
}

export function countLinks(items: AttachmentItem[]): Record<LinkFilter, number> {
  const counts: Record<LinkFilter, number> = {
    all: 0,
    image: 0,
    audio: 0,
    video: 0,
    website: 0,
    download: 0,
    unknown: 0,
  };
  for (const item of items) {
    if (item.kind !== "link") continue;
    counts.all += 1;
    counts[item.linkKind ?? "unknown"] += 1;
  }
  return counts;
}

export function filterAndSortAttachments(
  items: AttachmentItem[],
  filter: Filter,
  linkFilter: LinkFilter,
  query: string,
  sort: SortMode,
): AttachmentItem[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = items.filter((item) => {
    const filterMatches = filter === "all"
      || (filter === "orphan" ? item.references.length === 0 : item.kind === filter);
    const linkFilterMatches = filter !== "link"
      || linkFilter === "all"
      || (item.linkKind ?? "unknown") === linkFilter;
    const queryMatches = !needle
      || item.name.toLocaleLowerCase().includes(needle)
      || item.path.toLocaleLowerCase().includes(needle)
      || item.url?.toLocaleLowerCase().includes(needle)
      || item.domain?.toLocaleLowerCase().includes(needle);
    return filterMatches && linkFilterMatches && queryMatches;
  });
  return matches.sort((left, right) => {
    if (sort === "size") return right.size - left.size || left.path.localeCompare(right.path);
    if (sort === "references") {
      return right.references.length - left.references.length || left.path.localeCompare(right.path);
    }
    return left.name.localeCompare(right.name, "zh-CN") || left.path.localeCompare(right.path);
  });
}
