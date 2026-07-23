import { hostMethodCase } from "@noteaura/plugin-testkit";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invokeHost } from "./bridge";
import { invoke } from "./tauri-core";

vi.mock("./bridge", () => ({ invokeHost: vi.fn() }));

const mockedInvokeHost = vi.mocked(invokeHost);

beforeEach(() => {
  mockedInvokeHost.mockReset();
  mockedInvokeHost.mockResolvedValue(null);
});

describe("site publisher host command mapping", () => {
  it.each([
    ["store_get", "store.get"],
    ["store_set", "store.set"],
    ["store_delete", "store.delete"],
    ["get_remote_configs", "repositories.configs"],
    ["get_workspace_info", "workspace.info"],
    ["site_open_output", "shell.openPath"],
  ])("maps %s to the published %s contract", async (command, method) => {
    const payload = hostMethodCase(`${method}.${method === "workspace.info" ? "active" : method === "repositories.configs" ? "empty" : method === "shell.openPath" ? "file" : "value"}`).payload;
    await invoke(command, payload);
    expect(mockedInvokeHost).toHaveBeenCalledWith(method, payload);
  });

  it("wraps site backend methods in backend.invoke", async () => {
    await invoke("site_scan", { repoPath: "/fixtures/notes" });
    await invoke("site_build", { config: { repoPath: "/fixtures/notes" } });
    expect(mockedInvokeHost.mock.calls).toEqual([
      ["backend.invoke", { method: "site.scan", payload: { repoPath: "/fixtures/notes" } }],
      ["backend.invoke", { method: "site.build", payload: { config: { repoPath: "/fixtures/notes" } } }],
    ]);
  });

  it("orchestrates publish through the bounded host operation sequence", async () => {
    mockedInvokeHost
      .mockResolvedValueOnce({ targetRepoPath: "/fixtures/site", publishPathspec: "docs" })
      .mockResolvedValueOnce({ operationId: "operation-test" })
      .mockResolvedValueOnce({
        build: { pageCount: 2 },
        artifactPath: "/fixtures/artifact",
        publishDir: "docs",
        publishPath: "/fixtures/site/docs",
        pagesUrl: "https://octocat.github.io/docs/",
        commitMessage: "docs: publish",
      })
      .mockResolvedValueOnce({ copiedFileCount: 3 })
      .mockResolvedValueOnce({
        targetRepoPath: "/fixtures/site",
        branch: "pages",
        remoteName: "origin",
        changedCount: 3,
        commit: "0123456789abcdef",
        pushed: true,
        credentialMode: "repo_token",
        credentialRef: "credential://site",
      });
    const request = {
      buildConfig: { repoPath: "/fixtures/notes" },
      target: {
        targetLocalPath: "/fixtures/site",
        targetBranch: "pages",
        publishDir: "docs",
        remoteName: "origin",
        credentialRef: "credential://site",
        pagesUrl: "https://octocat.github.io/docs/",
        autoCommitMessage: "docs: publish",
      },
    };
    const result = await invoke<Record<string, unknown>>("site_publish_pages", { request });
    expect(mockedInvokeHost.mock.calls.map(([method]) => method)).toEqual([
      "backend.invoke",
      "git.pathUpdate.prepare",
      "backend.invoke",
      "files.replaceTree",
      "git.pathUpdate.commit",
    ]);
    expect(result).toMatchObject({ copiedFileCount: 3, changedCount: 3, pushed: true });
  });

  it("rejects incomplete publish targets before calling the host", async () => {
    await expect(invoke("site_publish_pages", { request: { target: {} } })).rejects.toThrow("发布请求缺少 Git 目标信息");
    expect(mockedInvokeHost).not.toHaveBeenCalled();
  });

  it("adds actionable guidance to authentication failures", async () => {
    mockedInvokeHost.mockRejectedValue(new Error("401 authentication failed"));
    const request = {
      buildConfig: {},
      target: {
        targetLocalPath: "/fixtures/site",
        targetBranch: "pages",
        publishDir: "docs",
        remoteName: "origin",
      },
    };
    let message = "";
    try {
      await invoke("site_publish_pages", { request });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("fine-grained token");
  });
});
