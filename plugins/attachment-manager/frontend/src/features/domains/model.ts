import type { AttachmentItem } from "../../types";

export type DomainSort = "resources" | "images" | "references" | "notes";

export interface DomainStats {
  domain: string;
  items: AttachmentItem[];
  total: number;
  image: number;
  audio: number;
  video: number;
  website: number;
  download: number;
  unknown: number;
  references: number;
  uniqueNotes: number;
  embed: number;
  navigation: number;
}

export function buildDomainStats(items: AttachmentItem[]): DomainStats[] {
  const groups = new Map<string, { items: AttachmentItem[]; notes: Set<string> }>();
  for (const item of items) {
    if (item.kind !== "link" || !item.domain) continue;
    const group = groups.get(item.domain) ?? { items: [], notes: new Set<string>() };
    group.items.push(item);
    for (const reference of item.references) group.notes.add(reference.notePath);
    groups.set(item.domain, group);
  }

  return [...groups.entries()].map(([domain, group]) => {
    const stats: DomainStats = {
      domain,
      items: group.items,
      total: group.items.length,
      image: 0,
      audio: 0,
      video: 0,
      website: 0,
      download: 0,
      unknown: 0,
      references: 0,
      uniqueNotes: group.notes.size,
      embed: 0,
      navigation: 0,
    };
    for (const item of group.items) {
      stats[item.linkKind ?? "unknown"] += 1;
      stats.references += item.references.length;
      for (const reference of item.references) {
        if (reference.role === "embed") stats.embed += 1;
        if (reference.role === "navigation") stats.navigation += 1;
      }
    }
    return stats;
  });
}

export function filterAndSortDomains(
  domains: DomainStats[],
  query: string,
  sort: DomainSort,
): DomainStats[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? domains.filter((item) => item.domain.toLocaleLowerCase().includes(needle))
    : [...domains];
  return matches.sort((left, right) => {
    const difference = sort === "images"
      ? right.image - left.image
      : sort === "references"
        ? right.references - left.references
        : sort === "notes"
          ? right.uniqueNotes - left.uniqueNotes
          : right.total - left.total;
    return difference || left.domain.localeCompare(right.domain);
  });
}
