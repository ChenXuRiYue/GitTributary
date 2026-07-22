import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitHubImageMigrationReport } from "../../types";
import { defaultMigrationSettings } from "./migration-workspace";
import { useMigrationWorkspace } from "./useMigrationWorkspace";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const report: GitHubImageMigrationReport = {
  migrated: [{
    localPath: "assets/one.png",
    remotePath: "images/hash.png",
    url: "https://raw.githubusercontent.com/example/images/main/images/hash.png",
    uploaded: true,
  }],
  failed: [],
  failedNotes: [],
  failedDeletes: [],
  changedNotePaths: ["README.md"],
  deletedLocalPaths: [],
  changedNotes: 1,
  replacedReferences: 1,
  durationMs: 20,
};
const input = {
  repoPath: "/repos/notes",
  library: {
    id: "library",
    name: "文档图库",
    config: {
      remote: {
        repoPath: "/repos/notes",
        name: "image-cloud",
        url: "https://github.com/example/images.git",
      },
      branch: "main",
      directory: "images",
    },
  },
  settings: defaultMigrationSettings("library"),
  imagePaths: ["assets/one.png"],
  noteCount: 1,
};

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "store_get") return null as never;
    return null as never;
  });
});

describe("useMigrationWorkspace", () => {
  it("keeps a task running independently and persists its terminal result", async () => {
    let resolveMigration: (value: GitHubImageMigrationReport) => void = () => undefined;
    const migration = new Promise<GitHubImageMigrationReport>((resolve) => {
      resolveMigration = resolve;
    });
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "store_get") return null as never;
      if (command === "attachments_migrate_github_images") return migration as never;
      return null as never;
    });
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMigrationWorkspace(onCompleted));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let execution: Promise<void> = Promise.resolve();
    act(() => { execution = result.current.startMigration(input); });
    expect(result.current.history[0]).toMatchObject({
      status: "running",
      imagePaths: ["assets/one.png"],
      settings: input.settings,
    });

    resolveMigration(report);
    await act(() => execution);
    expect(result.current.history[0]).toMatchObject({ status: "succeeded", result: report });
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(mockedInvoke).toHaveBeenCalledWith("attachments_migrate_github_images", {
      repoPath: input.repoPath,
      imagePaths: input.imagePaths,
      config: input.library.config,
      localFilePolicy: "keep",
    });
    expect(mockedInvoke).toHaveBeenCalledWith("store_set", expect.objectContaining({
      key: "migration-workspace.v1",
    }));
  });

  it("classifies cleanup failures as a partial migration", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "store_get") return null as never;
      if (command === "attachments_migrate_github_images") {
        return {
          ...report,
          failedDeletes: [{ path: "assets/one.png", error: "permission_denied" }],
        } as never;
      }
      return null as never;
    });
    const { result } = renderHook(() => useMigrationWorkspace(vi.fn().mockResolvedValue(undefined)));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.startMigration(input));
    expect(result.current.history[0].status).toBe("partial");
  });
});
