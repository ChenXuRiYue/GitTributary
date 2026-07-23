import type { LucideIcon } from "lucide-react";

export const SIDEBAR_PREFERENCES_NAMESPACE = "ui-state";
export const SIDEBAR_PREFERENCES_KEY = "app.sidebar.preferences";

export type SidebarItemGroup = "main" | "system";
export type SidebarItemKind = "core" | "plugin" | "function";
export type SidebarMoveDirection = "up" | "down";

export interface SidebarItemInfo {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  group: SidebarItemGroup;
  kind: SidebarItemKind;
  canHide: boolean;
}

export interface SidebarPreferences {
  version: 1;
  order: string[];
  hidden: string[];
}

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  version: 1,
  order: [],
  hidden: [],
};

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return [...new Set(value)];
}

export function parseSidebarPreferences(value: unknown): SidebarPreferences | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SidebarPreferences>;
  const order = uniqueStrings(state.order);
  const hidden = uniqueStrings(state.hidden);
  if (state.version !== 1 || !order || !hidden) return null;
  return { version: 1, order, hidden };
}

export function orderSidebarItems<T extends { id: string }>(
  items: readonly T[],
  preferences: SidebarPreferences,
): T[] {
  const rank = new Map(preferences.order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(item.id) }))
    .sort((left, right) => {
      if (left.rank === undefined && right.rank === undefined) return left.index - right.index;
      if (left.rank === undefined) return 1;
      if (right.rank === undefined) return -1;
      return left.rank - right.rank;
    })
    .map(({ item }) => item);
}

export function isSidebarItemVisible(
  item: Pick<SidebarItemInfo, "id" | "canHide">,
  preferences: SidebarPreferences,
): boolean {
  return !item.canHide || !preferences.hidden.includes(item.id);
}

export function setSidebarItemVisible(
  preferences: SidebarPreferences,
  item: Pick<SidebarItemInfo, "id" | "canHide">,
  visible: boolean,
): SidebarPreferences {
  if (!item.canHide) return preferences;
  const hidden = new Set(preferences.hidden);
  if (visible) hidden.delete(item.id);
  else hidden.add(item.id);
  return { ...preferences, hidden: [...hidden] };
}

export function moveSidebarItem(
  preferences: SidebarPreferences,
  items: readonly SidebarItemInfo[],
  id: string,
  direction: SidebarMoveDirection,
): SidebarPreferences {
  const ordered = orderSidebarItems(items, preferences);
  const item = ordered.find((candidate) => candidate.id === id);
  if (!item) return preferences;

  const groupItems = ordered.filter((candidate) => candidate.group === item.group);
  const currentIndex = groupItems.findIndex((candidate) => candidate.id === id);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  const target = groupItems[targetIndex];
  if (!target) return preferences;

  const knownOrder = ordered.map((candidate) => candidate.id);
  const currentOrderIndex = knownOrder.indexOf(id);
  const targetOrderIndex = knownOrder.indexOf(target.id);
  [knownOrder[currentOrderIndex], knownOrder[targetOrderIndex]] = [
    knownOrder[targetOrderIndex],
    knownOrder[currentOrderIndex],
  ];

  const knownIds = new Set(knownOrder);
  const unavailableIds = preferences.order.filter((candidate) => !knownIds.has(candidate));
  return { ...preferences, order: [...knownOrder, ...unavailableIds] };
}

export function reorderSidebarItem(
  preferences: SidebarPreferences,
  items: readonly SidebarItemInfo[],
  sourceId: string,
  targetId: string,
): SidebarPreferences {
  if (sourceId === targetId) return preferences;
  const ordered = orderSidebarItems(items, preferences);
  const source = ordered.find((item) => item.id === sourceId);
  const target = ordered.find((item) => item.id === targetId);
  if (!source || !target || source.group !== target.group) return preferences;

  const knownOrder = ordered.map((item) => item.id);
  const sourceIndex = knownOrder.indexOf(sourceId);
  const targetIndex = knownOrder.indexOf(targetId);
  knownOrder.splice(sourceIndex, 1);
  knownOrder.splice(targetIndex, 0, sourceId);

  const knownIds = new Set(knownOrder);
  const unavailableIds = preferences.order.filter((candidate) => !knownIds.has(candidate));
  return { ...preferences, order: [...knownOrder, ...unavailableIds] };
}
