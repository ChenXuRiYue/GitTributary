import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flowApi } from "@/core/flow/api";
import {
  installPlugin,
  listMarketPlugins,
  marketErrorMessage,
  notifyExtensionsChanged,
  uninstallPlugin,
} from "@/core/plugin-manager/api";
import {
  callExtension,
  extensionErrorMessage,
  listExtensionContributions,
} from "@/extensions/api";
import { EXTENSIONS_CHANGED_EVENT } from "@/extensions/events";
import { useExtensionContributions } from "@/extensions/useExtensionContributions";
import { useStoreKey } from "@/hooks/useStoreKey";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockResolvedValue(undefined as never);
});

describe("Flow Tauri command contracts", () => {
  it("uses parameter-free catalog and list commands", async () => {
    await flowApi.list();
    await flowApi.listFolders();
    await flowApi.eventCatalog();
    await flowApi.nodeCatalog();

    expect(mockedInvoke.mock.calls).toEqual([
      ["flow_list"],
      ["flow_list_folders"],
      ["flow_event_catalog"],
      ["flow_node_catalog"],
    ]);
  });

  it("passes flow identifiers through the expected command envelope", async () => {
    await flowApi.nodes("flow.publish");
    await flowApi.get("flow.publish");
    await flowApi.setEnabled("flow.publish", false);
    await flowApi.delete("flow.publish");

    expect(mockedInvoke.mock.calls).toEqual([
      ["flow_nodes", { id: "flow.publish" }],
      ["flow_get", { id: "flow.publish" }],
      ["flow_set_enabled", { id: "flow.publish", enabled: false }],
      ["flow_delete", { id: "flow.publish" }],
    ]);
  });

  it("keeps validate, save, and run request DTOs stable", async () => {
    await flowApi.validate("name: test");
    await flowApi.save("name: test", "手动");
    await flowApi.run("flow.publish");

    expect(mockedInvoke.mock.calls).toEqual([
      ["flow_validate", { workflow: "name: test" }],
      ["flow_save", { request: { workflow: "name: test", folder: "手动" } }],
      ["flow_run", {
        id: "flow.publish",
        request: { intent: null, inputs: {} },
      }],
    ]);
  });

  it("passes normalized folder paths without client-side rewriting", async () => {
    await flowApi.createFolder("release/daily");
    await flowApi.deleteFolder("release/daily");
    expect(mockedInvoke.mock.calls).toEqual([
      ["flow_create_folder", { path: "release/daily" }],
      ["flow_delete_folder", { path: "release/daily" }],
    ]);
  });
});

describe("extension API compatibility contracts", () => {
  it("normalizes flattened camelCase and snake_case responses", async () => {
    mockedInvoke.mockResolvedValueOnce([
      {
        pluginId: "com.example.flat",
        pluginName: "Flat plugin",
        pluginVersion: "1.0.0",
        viewId: "main",
        title: "Main",
        description: "Flat view",
        entryUrl: "plugin://flat/index.html",
        iconUrl: "plugin://flat/icon.png",
      },
      {
        plugin_id: "com.example.snake",
        plugin_name: "Snake plugin",
        plugin_version: "2.0.0",
        view_id: "settings",
        name: "Settings",
        entry_url: "plugin://snake/index.html",
      },
    ] as never);

    await expect(listExtensionContributions()).resolves.toEqual([
      {
        pluginId: "com.example.flat",
        pluginName: "Flat plugin",
        pluginVersion: "1.0.0",
        viewId: "main",
        title: "Main",
        description: "Flat view",
        entryUrl: "plugin://flat/index.html",
        iconUrl: "plugin://flat/icon.png",
      },
      {
        pluginId: "com.example.snake",
        pluginName: "Snake plugin",
        pluginVersion: "2.0.0",
        viewId: "settings",
        title: "Settings",
        description: "插件扩展页面",
        entryUrl: "plugin://snake/index.html",
        iconUrl: null,
      },
    ]);
    expect(mockedInvoke).toHaveBeenCalledWith("extension_list");
  });

  it("normalizes manifest-shaped responses and ignores disabled or invalid views", async () => {
    mockedInvoke.mockResolvedValueOnce({
      extensions: [
        {
          status: "active",
          manifest: {
            id: "com.example.publisher",
            name: "Publisher",
            version: "3.1.4",
            contributes: {
              views: [
                { id: "site", title: "Site", entry: "plugin://publisher/site.html" },
                { id: "broken", title: "Broken without entry" },
                null,
              ],
            },
          },
        },
        {
          enabled: false,
          pluginId: "com.example.disabled",
          viewId: "main",
          title: "Disabled",
          entryUrl: "plugin://disabled/index.html",
        },
        { unexpected: true },
      ],
    } as never);

    await expect(listExtensionContributions()).resolves.toEqual([{
      pluginId: "com.example.publisher",
      pluginName: "Publisher",
      pluginVersion: "3.1.4",
      viewId: "site",
      title: "Site",
      description: "插件扩展页面",
      entryUrl: "plugin://publisher/site.html",
      iconUrl: null,
    }]);
  });

  it("returns an empty list for unknown response shapes", async () => {
    mockedInvoke.mockResolvedValueOnce({ plugins: [] } as never);
    await expect(listExtensionContributions()).resolves.toEqual([]);
  });

  it("binds extension identity outside the untrusted payload", async () => {
    await callExtension({
      pluginId: "com.example.publisher",
      method: "site.build",
      payload: { pluginId: "attempted-override", source: "/tmp/notes" },
    });
    expect(mockedInvoke).toHaveBeenCalledWith("extension_call", {
      pluginId: "com.example.publisher",
      method: "site.build",
      payload: { pluginId: "attempted-override", source: "/tmp/notes" },
    });
  });

  it.each([
    [new Error("boom"), "boom"],
    ["plain failure", "plain failure"],
    [{ message: "structured failure" }, "structured failure"],
    [{ error: "fallback field" }, "fallback field"],
    [{ message: "  " }, "扩展运行时暂时不可用"],
    [null, "扩展运行时暂时不可用"],
  ])("normalizes extension error %#", (error, expected) => {
    expect(extensionErrorMessage(error)).toBe(expected);
  });
});

describe("extension contribution hook", () => {
  it("loads contributions and reloads on the extension-changed event", async () => {
    mockedInvoke
      .mockResolvedValueOnce([{ pluginId: "one", viewId: "main", title: "One", entryUrl: "/one" }] as never)
      .mockResolvedValueOnce([{ pluginId: "two", viewId: "main", title: "Two", entryUrl: "/two" }] as never);

    const { result } = renderHook(() => useExtensionContributions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contributions[0].pluginId).toBe("one");

    act(() => window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT)));
    await waitFor(() => expect(result.current.contributions[0]?.pluginId).toBe("two"));
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it("clears stale contributions and exposes normalized errors", async () => {
    mockedInvoke.mockRejectedValueOnce({ message: "host unavailable" });
    const { result } = renderHook(() => useExtensionContributions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contributions).toEqual([]);
    expect(result.current.error).toBe("host unavailable");
  });
});

describe("plugin market API contracts", () => {
  it("uses stable market command names and pluginId parameters", async () => {
    await listMarketPlugins();
    await installPlugin("com.example.publisher");
    await uninstallPlugin("com.example.publisher");
    expect(mockedInvoke.mock.calls).toEqual([
      ["plugin_market_list"],
      ["plugin_install", { pluginId: "com.example.publisher" }],
      ["plugin_uninstall", { pluginId: "com.example.publisher" }],
    ]);
  });

  it("dispatches the shared invalidation event", () => {
    const listener = vi.fn();
    window.addEventListener(EXTENSIONS_CHANGED_EVENT, listener, { once: true });
    notifyExtensionsChanged();
    expect(listener).toHaveBeenCalledOnce();
  });

  it.each([
    [new Error("market error"), "market error"],
    ["plain error", "plain error"],
    [{ message: "hidden" }, "插件列表暂时不可用"],
  ])("normalizes market error %#", (error, expected) => {
    expect(marketErrorMessage(error)).toBe(expected);
  });
});

describe("store hooks", () => {
  it("loads and manually refreshes one namespaced key", async () => {
    mockedInvoke
      .mockResolvedValueOnce("/tmp/first" as never)
      .mockResolvedValueOnce("/tmp/second" as never);
    const { result } = renderHook(() => useStoreKey<string>("workspace", "repo.active"));
    await waitFor(() => expect(result.current[0]).toBe("/tmp/first"));

    await act(async () => {
      result.current[1]();
    });
    await waitFor(() => expect(result.current[0]).toBe("/tmp/second"));
    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "store_get", {
      namespace: "workspace",
      key: "repo.active",
    });
  });

  it("resets a stale value after a refresh failure", async () => {
    mockedInvoke
      .mockResolvedValueOnce("present" as never)
      .mockRejectedValueOnce(new Error("store down"));
    const { result } = renderHook(() => useStoreKey<string>("workspace", "repo.active"));
    await waitFor(() => expect(result.current[0]).toBe("present"));

    await act(async () => {
      result.current[1]();
    });
    await waitFor(() => expect(result.current[0]).toBeNull());
  });
});
