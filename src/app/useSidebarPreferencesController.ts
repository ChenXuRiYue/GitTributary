import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { SidebarPreferencesController } from "./SidebarPreferencesContext";
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  isSidebarItemVisible,
  moveSidebarItem,
  orderSidebarItems,
  parseSidebarPreferences,
  reorderSidebarItem,
  setSidebarItemVisible,
  SIDEBAR_PREFERENCES_KEY,
  SIDEBAR_PREFERENCES_NAMESPACE,
  type SidebarItemInfo,
  type SidebarPreferences,
} from "./sidebarPreferences";

export function useSidebarPreferencesController<T extends SidebarItemInfo>(items: T[]) {
  const [preferences, setPreferences] = useState<SidebarPreferences>(DEFAULT_SIDEBAR_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const orderedItems = useMemo(() => orderSidebarItems(items, preferences), [items, preferences]);
  const sidebarItems = useMemo<SidebarItemInfo[]>(() => orderedItems.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon,
    group: item.group,
    kind: item.kind,
    canHide: item.canHide,
  })), [orderedItems]);
  const visibleItems = useMemo(
    () => orderedItems.filter((item) => isSidebarItemVisible(item, preferences)),
    [orderedItems, preferences],
  );

  useEffect(() => {
    let cancelled = false;
    void invoke<unknown>("store_get", {
      namespace: SIDEBAR_PREFERENCES_NAMESPACE,
      key: SIDEBAR_PREFERENCES_KEY,
    }).then((raw) => {
      if (!cancelled) {
        setPreferences(parseSidebarPreferences(raw) ?? DEFAULT_SIDEBAR_PREFERENCES);
        setLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void invoke("store_set", {
      namespace: SIDEBAR_PREFERENCES_NAMESPACE,
      key: SIDEBAR_PREFERENCES_KEY,
      value: preferences,
    }).catch(() => {
      // Persistence failure should not block sidebar changes in the current session.
    });
  }, [loaded, preferences]);

  const controller = useMemo<SidebarPreferencesController>(() => ({
    items: sidebarItems,
    isVisible: (id) => {
      const item = sidebarItems.find((candidate) => candidate.id === id);
      return item ? isSidebarItemVisible(item, preferences) : false;
    },
    setVisible: (id, visible) => {
      const item = sidebarItems.find((candidate) => candidate.id === id);
      if (item) setPreferences((current) => setSidebarItemVisible(current, item, visible));
    },
    move: (id, direction) => {
      setPreferences((current) => moveSidebarItem(current, sidebarItems, id, direction));
    },
    reorder: (sourceId, targetId) => {
      setPreferences((current) => reorderSidebarItem(current, sidebarItems, sourceId, targetId));
    },
    reset: () => setPreferences(DEFAULT_SIDEBAR_PREFERENCES),
  }), [preferences, sidebarItems]);

  return { controller, orderedItems, visibleItems };
}
