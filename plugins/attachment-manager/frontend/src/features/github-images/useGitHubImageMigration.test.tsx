import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachment, scanReport } from "../../test/fixtures";
import type { GitHubImageLibrary, GitHubImageMigrationReport } from "../../types";
import { useGitHubImageMigration } from "./useGitHubImageMigration";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const report = scanReport([
  attachment({ path: "assets/one.png" }),
  attachment({ path: "assets/two.png", references: [{ notePath: "guide.md", line: 2 }] }),
  attachment({ path: "assets/orphan.png", references: [] }),
  attachment({ path: "audio/theme.mp3", kind: "audio", mimeType: "audio/mpeg" }),
]);
const library: GitHubImageLibrary = {
  id: "library",
  name: "文档图库",
  remote: {
    repoPath: "/fixtures/notes",
    name: "image-cloud",
    url: "https://github.com/octocat/images.git",
  },
  branch: "main",
  directory: "images",
};
const migrationReport: GitHubImageMigrationReport = {
  migrated: [{
    localPath: "assets/one.png",
    remotePath: "images/hash.png",
    url: "https://raw.githubusercontent.com/octocat/images/main/images/hash.png",
    uploaded: true,
  }],
  failed: [],
  failedNotes: [],
  changedNotes: 2,
  replacedReferences: 2,
  durationMs: 25,
};

beforeEach(() => mockedInvoke.mockResolvedValue(null as never));

describe("useGitHubImageMigration", () => {
  it("selects referenced images and supports bulk and individual toggles", async () => {
    const { result, rerender } = renderHook(
      ({ currentReport }) => useGitHubImageMigration(currentReport, library, vi.fn()),
      { initialProps: { currentReport: report } },
    );
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
    expect(result.current.candidates.map((item) => item.path)).toEqual(["assets/one.png", "assets/two.png"]);
    act(() => result.current.selectAll(false));
    expect(result.current.selectedCount).toBe(0);
    act(() => result.current.togglePath("assets/one.png"));
    expect([...result.current.selectedPaths]).toEqual(["assets/one.png"]);

    rerender({ currentReport: { ...report, repoPath: "/fixtures/other" } });
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
  });

  it("migrates through the bound Git remote and rescans", async () => {
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "attachments_migrate_github_images") return migrationReport as never;
      return null as never;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderHook(() => useGitHubImageMigration(report, library, onCompleted));
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
    await act(() => result.current.migrate());

    expect(mockedInvoke).toHaveBeenCalledWith("attachments_migrate_github_images", {
      repoPath: report.repoPath,
      imagePaths: ["assets/one.png", "assets/two.png"],
      config: {
        remote: library.remote,
        branch: "main",
        directory: "images",
      },
    });
    expect(result.current.result).toEqual(migrationReport);
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it("stops when the library has no Git remote binding", async () => {
    const unbound = { ...library, remote: null };
    const { result } = renderHook(() => useGitHubImageMigration(report, unbound, vi.fn()));
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
    await act(() => result.current.migrate());
    expect(result.current.error).toContain("Git 远程不可用");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
