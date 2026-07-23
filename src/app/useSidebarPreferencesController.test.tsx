import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { PanelLeft } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_PREFERENCES_KEY,
  SIDEBAR_PREFERENCES_NAMESPACE,
  type SidebarItemInfo,
} from "./sidebarPreferences";
import { useSidebarPreferencesController } from "./useSidebarPreferencesController";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

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

beforeEach(() => {
  mockedInvoke.mockResolvedValue(undefined as never);
});

describe("sidebar preferences controller", () => {
  it("restores persisted order and visibility before writing the current state", async () => {
    const persisted = {
      version: 1 as const,
      order: ["flow", "git", "plugins", "settings"],
      hidden: ["git"],
    };
    mockedInvoke.mockResolvedValueOnce(persisted as never);

    const { result } = renderHook(() => useSidebarPreferencesController(items));

    await waitFor(() => {
      expect(result.current.orderedItems.map((item) => item.id))
        .toEqual(["flow", "git", "plugins", "settings"]);
      expect(result.current.visibleItems.map((item) => item.id))
        .toEqual(["flow", "plugins", "settings"]);
    });
    expect(result.current.controller.isVisible("git")).toBe(false);
    expect(result.current.controller.isVisible("missing")).toBe(false);
    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "store_get", {
      namespace: SIDEBAR_PREFERENCES_NAMESPACE,
      key: SIDEBAR_PREFERENCES_KEY,
    });
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("store_set", {
      namespace: SIDEBAR_PREFERENCES_NAMESPACE,
      key: SIDEBAR_PREFERENCES_KEY,
      value: persisted,
    }));
  });

  it("persists visibility, ordering, and reset changes through the shared store key", async () => {
    mockedInvoke.mockResolvedValueOnce(null as never);
    const { result } = renderHook(() => useSidebarPreferencesController(items));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("store_set", expect.objectContaining({
      value: DEFAULT_SIDEBAR_PREFERENCES,
    })));
    mockedInvoke.mockClear();

    act(() => result.current.controller.setVisible("git", false));
    await waitFor(() => expect(result.current.controller.isVisible("git")).toBe(false));
    await waitFor(() => expect(mockedInvoke).toHaveBeenLastCalledWith("store_set", expect.objectContaining({
      value: { version: 1, order: [], hidden: ["git"] },
    })));

    act(() => result.current.controller.move("flow", "up"));
    await waitFor(() => expect(result.current.orderedItems.map((item) => item.id))
      .toEqual(["flow", "git", "plugins", "settings"]));
    await waitFor(() => expect(mockedInvoke).toHaveBeenLastCalledWith("store_set", expect.objectContaining({
      value: {
        version: 1,
        order: ["flow", "git", "plugins", "settings"],
        hidden: ["git"],
      },
    })));

    act(() => result.current.controller.reorder("settings", "plugins"));
    await waitFor(() => expect(result.current.orderedItems.map((item) => item.id))
      .toEqual(["flow", "git", "settings", "plugins"]));
    await waitFor(() => expect(mockedInvoke).toHaveBeenLastCalledWith("store_set", expect.objectContaining({
      value: {
        version: 1,
        order: ["flow", "git", "settings", "plugins"],
        hidden: ["git"],
      },
    })));

    act(() => result.current.controller.reset());
    await waitFor(() => expect(result.current.visibleItems.map((item) => item.id))
      .toEqual(["git", "flow", "plugins", "settings"]));
    await waitFor(() => expect(mockedInvoke).toHaveBeenLastCalledWith("store_set", expect.objectContaining({
      value: DEFAULT_SIDEBAR_PREFERENCES,
    })));
  });

  it("falls back to defaults when persisted preferences cannot be read", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("store unavailable"));
    const { result } = renderHook(() => useSidebarPreferencesController(items));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("store_set", {
      namespace: SIDEBAR_PREFERENCES_NAMESPACE,
      key: SIDEBAR_PREFERENCES_KEY,
      value: DEFAULT_SIDEBAR_PREFERENCES,
    }));
    expect(result.current.visibleItems).toEqual(items);
  });

  it("keeps in-memory changes usable when persistence writes fail", async () => {
    mockedInvoke
      .mockResolvedValueOnce(null as never)
      .mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useSidebarPreferencesController(items));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("store_set", expect.anything()));

    act(() => result.current.controller.setVisible("flow", false));
    await waitFor(() => expect(result.current.visibleItems.map((item) => item.id))
      .toEqual(["git", "plugins", "settings"]));
  });

  it("ignores a late store response after the consumer unmounts", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    const read = new Promise<unknown>((resolve) => { resolveRead = resolve; });
    mockedInvoke.mockReturnValueOnce(read as never);
    const { unmount } = renderHook(() => useSidebarPreferencesController(items));

    unmount();
    await act(async () => {
      resolveRead({ version: 1, order: ["flow"], hidden: ["git"] });
      await read;
    });

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("store_get", {
      namespace: SIDEBAR_PREFERENCES_NAMESPACE,
      key: SIDEBAR_PREFERENCES_KEY,
    });
  });
});
