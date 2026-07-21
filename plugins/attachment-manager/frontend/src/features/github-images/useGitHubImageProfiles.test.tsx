import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRemoteBinding, GitRemoteConfigEntry } from "../../types";
import { remoteBinding, SETTINGS_KEY } from "./model";
import { useImageLibraries } from "./useImageLibraries";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const remote: GitRemoteConfigEntry = {
  name: "image-cloud",
  url: "https://github.com/octocat/images.git",
  push_url: null,
  repo_path: "/fixtures/notes",
  source: "local_git_config",
  purpose: ["current_repo_remote"],
  credential_mode: "repo_token",
  credential_ref: "repo:/fixtures/notes",
  commit_name: null,
  commit_email: null,
  verify_status: "unverified",
  capabilities: "unknown",
};

beforeEach(() => {
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "get_remote_configs") return [remote] as never;
    if (command === "store_get") return { version: 3, libraries: [] } as never;
    return null as never;
  });
});

describe("GitHub image libraries", () => {
  it("persists a library as a Git remote binding without a token", async () => {
    const { result } = renderHook(() => useImageLibraries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const created = {
      ...result.current.createLibrary(),
      name: "博客图库",
      remote: remoteBinding(remote),
    };
    await act(() => result.current.saveLibrary(created));

    const save = [...mockedInvoke.mock.calls]
      .reverse()
      .find(([command]) => command === "store_set");
    expect(save?.[1]).toMatchObject({
      key: SETTINGS_KEY,
      value: {
        version: 3,
        libraries: [expect.objectContaining({ name: "博客图库", remote: remoteBinding(remote) })],
      },
    });
    expect(JSON.stringify(save?.[1])).not.toContain("token");
  });

  it("auto-binds a migrated v2 library to a matching Git remote", async () => {
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "get_remote_configs") return [remote] as never;
      if (command === "store_get" && (args as { key?: string }).key === "github-images.v2") {
        return {
          version: 2,
          profiles: [{
            id: "old",
            name: "旧图库",
            owner: "octocat",
            repository: "images",
            branch: "main",
            directory: "images",
            token: "must-not-migrate",
            rememberToken: true,
          }],
        } as never;
      }
      return null as never;
    });
    const { result } = renderHook(() => useImageLibraries());

    await waitFor(() => expect(result.current.libraries).toHaveLength(1));
    expect(result.current.libraries[0].remote).toEqual(remoteBinding(remote));
    expect(JSON.stringify(result.current.libraries)).not.toContain("must-not-migrate");
  });

  it("adds a repository through the Git module and returns its binding", async () => {
    let listed = 0;
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "store_get") return { version: 3, libraries: [] } as never;
      if (command === "get_remote_configs") {
        listed += 1;
        return (listed > 1 ? [remote] : []) as never;
      }
      return null as never;
    });
    const { result } = renderHook(() => useImageLibraries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let binding: GitRemoteBinding | undefined;
    await act(async () => {
      binding = await result.current.addRemote({
        name: "image-cloud",
        url: remote.url,
        token: "secret",
      });
    });
    expect(mockedInvoke).toHaveBeenCalledWith("add_remote", {
      name: "image-cloud",
      url: remote.url,
      token: "secret",
      commitName: null,
      commitEmail: null,
    });
    expect(binding).toEqual(remoteBinding(remote));
  });

  it("reports settings write failures", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_remote_configs") return [remote] as never;
      if (command === "store_get") return { version: 3, libraries: [] } as never;
      if (command === "store_set") throw new Error("settings_write_failed");
      return null as never;
    });
    const { result } = renderHook(() => useImageLibraries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const created = { ...result.current.createLibrary(), remote: remoteBinding(remote) };

    await act(async () => {
      await result.current.saveLibrary(created).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).toBe("settings_write_failed"));
  });
});
