import { defaultHostResult, hostMethodCase } from "@gittributary/plugin-testkit";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invokeHost } from "./bridge";
import { invoke } from "./tauri-core";

vi.mock("./bridge", () => ({ invokeHost: vi.fn() }));

const mockedInvokeHost = vi.mocked(invokeHost);

beforeEach(() => {
  mockedInvokeHost.mockImplementation(async (method) => defaultHostResult(method));
});

describe("attachment plugin host command mapping", () => {
  it.each([
    ["get_workspace_info", "workspace.info", {}],
    ["get_remote_configs", "repositories.configs", {}],
    ["add_remote", "repositories.addRemote", {
      name: "image-cloud",
      url: "https://github.com/octocat/images.git",
      token: "test-token",
    }],
    ["store_get", "store.get", { namespace: "plugin.dev.example.settings", key: "theme" }],
    ["store_set", "store.set", { namespace: "plugin.dev.example.settings", key: "theme", value: "dark" }],
  ])("maps %s to the published %s contract", async (command, method, payload) => {
    await invoke(command, payload);
    expect(mockedInvokeHost).toHaveBeenCalledWith(method, payload);
  });

  it("wraps backend calls in the declared backend.invoke envelope", async () => {
    const example = hostMethodCase("backend.invoke.echo");
    await invoke("attachments_scan", { repoPath: "/fixtures/notes" });
    expect(mockedInvokeHost).toHaveBeenCalledWith("backend.invoke", {
      method: "attachments.scan",
      payload: { repoPath: "/fixtures/notes" },
    });
    expect(example.payload).toHaveProperty("method");
  });

  it("rejects commands that are not part of the plugin adapter", async () => {
    await expect(invoke("unknown_command")).rejects.toThrow("不支持的宿主命令");
    expect(mockedInvokeHost).not.toHaveBeenCalled();
  });
});
