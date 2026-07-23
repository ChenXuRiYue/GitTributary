import { PanelLeft } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIDEBAR_PREFERENCES,
  isSidebarItemVisible,
  moveSidebarItem,
  orderSidebarItems,
  parseSidebarPreferences,
  reorderSidebarItem,
  setSidebarItemVisible,
  type SidebarItemInfo,
} from "./sidebarPreferences";

const items: SidebarItemInfo[] = [
  {
    id: "git",
    name: "Git",
    description: "Git",
    icon: PanelLeft,
    group: "main",
    kind: "core",
    canHide: true,
  },
  {
    id: "flow",
    name: "Flow",
    description: "Flow",
    icon: PanelLeft,
    group: "main",
    kind: "core",
    canHide: true,
  },
  {
    id: "plugins",
    name: "插件",
    description: "插件",
    icon: PanelLeft,
    group: "system",
    kind: "function",
    canHide: true,
  },
  {
    id: "settings",
    name: "设置",
    description: "设置",
    icon: PanelLeft,
    group: "system",
    kind: "function",
    canHide: false,
  },
];

describe("sidebar preferences", () => {
  it("deduplicates persisted item ids while preserving their first position", () => {
    expect(parseSidebarPreferences({
      version: 1,
      order: ["flow", "git", "flow"],
      hidden: ["git", "git"],
    })).toEqual({ version: 1, order: ["flow", "git"], hidden: ["git"] });
  });

  it.each([
    null,
    [],
    {},
    { version: 2, order: [], hidden: [] },
    { version: 1, order: "git", hidden: [] },
    { version: 1, order: [], hidden: [1] },
  ])("rejects malformed persisted state %#", (value) => {
    expect(parseSidebarPreferences(value)).toBeNull();
  });

  it("orders known items and appends newly available items in registry order", () => {
    const preferences = {
      version: 1 as const,
      order: ["uninstalled-plugin", "flow", "plugins"],
      hidden: [],
    };
    expect(orderSidebarItems(items, preferences).map((item) => item.id))
      .toEqual(["flow", "plugins", "git", "settings"]);
    expect(items.map((item) => item.id)).toEqual(["git", "flow", "plugins", "settings"]);
  });

  it("moves items only inside their navigation group and stops at group boundaries", () => {
    const moved = moveSidebarItem(DEFAULT_SIDEBAR_PREFERENCES, items, "flow", "up");
    expect(orderSidebarItems(items, moved).map((item) => item.id))
      .toEqual(["flow", "git", "plugins", "settings"]);

    const unchanged = moveSidebarItem(moved, items, "flow", "up");
    expect(unchanged).toBe(moved);
  });

  it("moves downward without discarding unavailable or hidden item state", () => {
    const preferences = {
      version: 1 as const,
      order: ["flow", "uninstalled-plugin", "git", "plugins", "settings"],
      hidden: ["flow"],
    };
    expect(moveSidebarItem(preferences, items, "flow", "down")).toEqual({
      version: 1,
      order: ["git", "flow", "plugins", "settings", "uninstalled-plugin"],
      hidden: ["flow"],
    });
    expect(moveSidebarItem(preferences, items, "missing", "down")).toBe(preferences);
  });

  it("supports drag reordering and ignores cross-group drops", () => {
    const reordered = reorderSidebarItem(DEFAULT_SIDEBAR_PREFERENCES, items, "git", "flow");
    expect(orderSidebarItems(items, reordered).map((item) => item.id))
      .toEqual(["flow", "git", "plugins", "settings"]);
    expect(reorderSidebarItem(reordered, items, "git", "plugins")).toBe(reordered);
  });

  it("ignores self and unavailable drag targets without creating new state", () => {
    expect(reorderSidebarItem(DEFAULT_SIDEBAR_PREFERENCES, items, "git", "git"))
      .toBe(DEFAULT_SIDEBAR_PREFERENCES);
    expect(reorderSidebarItem(DEFAULT_SIDEBAR_PREFERENCES, items, "missing", "git"))
      .toBe(DEFAULT_SIDEBAR_PREFERENCES);
    expect(reorderSidebarItem(DEFAULT_SIDEBAR_PREFERENCES, items, "git", "missing"))
      .toBe(DEFAULT_SIDEBAR_PREFERENCES);
  });

  it("hides and restores configurable items without changing the original state", () => {
    const hidden = setSidebarItemVisible(DEFAULT_SIDEBAR_PREFERENCES, items[0], false);
    expect(isSidebarItemVisible(items[0], hidden)).toBe(false);
    expect(DEFAULT_SIDEBAR_PREFERENCES.hidden).toEqual([]);

    const restored = setSidebarItemVisible(hidden, items[0], true);
    expect(restored.hidden).toEqual([]);
    expect(isSidebarItemVisible(items[0], restored)).toBe(true);
  });

  it("keeps non-configurable entries visible even when persisted state says otherwise", () => {
    const malformedPreference = { version: 1 as const, order: [], hidden: ["settings"] };
    expect(isSidebarItemVisible(items[3], malformedPreference)).toBe(true);
    const unchanged = setSidebarItemVisible(malformedPreference, items[3], false);
    expect(unchanged).toBe(malformedPreference);
    expect(isSidebarItemVisible(items[3], unchanged)).toBe(true);
  });
});
