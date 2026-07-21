import { describe, expect, it, vi } from "vitest";

import type { SiteRunRecord } from "./types";
import {
  SITE_RUN_HISTORY_LIMIT,
  defaultTitleFromRepo,
  formatDuration,
  isRunRecordInProgress,
  legacySitePublishKey,
  parseSiteActiveRepoState,
  parseSiteBuildUiState,
  parseSiteWorkspaceConfigState,
  shortPath,
  siteStateKey,
  stableHash,
  upsertRunRecord,
} from "./state";

describe("site state persistence", () => {
  it("creates deterministic, namespace-specific repository keys", () => {
    expect(stableHash("/fixtures/notes")).toBe(stableHash("/fixtures/notes"));
    expect(stableHash("/fixtures/notes")).not.toBe(stableHash("/fixtures/other"));
    expect(siteStateKey("/fixtures/notes")).toMatch(/^build\./);
    expect(legacySitePublishKey("/fixtures/notes")).toMatch(/^publish\./);
  });

  it("accepts valid active-repository state and rejects malformed values", () => {
    expect(parseSiteActiveRepoState({
      version: 1,
      repoPath: "/fixtures/notes",
      updatedAt: 100,
    })).toEqual({ version: 1, repoPath: "/fixtures/notes", updatedAt: 100 });
    expect(parseSiteActiveRepoState({ version: 1, repoPath: "", updatedAt: 100 })).toBeNull();
    expect(parseSiteActiveRepoState({ version: 2, repoPath: "/repo", updatedAt: 100 })).toBeNull();
    expect(parseSiteActiveRepoState(null)).toBeNull();
  });

  it("migrates version-one build UI defaults without inventing selection state", () => {
    expect(parseSiteBuildUiState({
      version: 1,
      repoPath: "/fixtures/notes",
      outputDir: ".site",
      siteTitle: "Notes",
      include: ["docs"],
      theme: "typora-light",
      withSearch: true,
      copyAssets: true,
      updatedAt: 100,
    })).toMatchObject({
      version: 1,
      hasSelectionState: true,
      captureViewMode: "tree",
      openPaths: null,
    });
    expect(parseSiteBuildUiState({
      version: 1,
      repoPath: "/fixtures/notes",
      outputDir: ".site",
      siteTitle: "Notes",
      include: [1],
      theme: "typora-light",
      withSearch: true,
      copyAssets: true,
      updatedAt: 100,
    })).toBeNull();
  });

  it("filters invalid nested workspace records and repairs a missing active group", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const parsed = parseSiteWorkspaceConfigState({
      version: 1,
      activeGroupId: "missing",
      updatedAt: 100,
      groups: [
        {
          id: "docs",
          name: "Docs",
          sourceRepoPath: "/fixtures/notes",
          documentScope: ["README.md", 1],
          target: null,
          env: [
            { id: "valid", key: "BASE_URL", value: "/", enabled: true },
            { id: "invalid", key: "BROKEN" },
          ],
          runHistory: [
            { id: "run-1", kind: "build", status: "succeeded", message: "ok", startedAt: 10, durationMs: 5 },
            { id: "run-2", kind: "build", status: "running", message: "working", startedAt: 20, durationMs: 0 },
            { bad: true },
          ],
          updatedAt: 100,
        },
        { id: "", name: "invalid", sourceRepoPath: "", env: [], updatedAt: 100 },
      ],
    });

    expect(parsed?.activeGroupId).toBe("docs");
    expect(parsed?.groups).toHaveLength(1);
    expect(parsed?.groups[0]?.documentScope).toEqual(["README.md"]);
    expect(parsed?.groups[0]?.env).toHaveLength(1);
    expect(parsed?.groups[0]?.runHistory).toHaveLength(2);
    expect(parsed?.groups[0]?.runHistory[1]).toMatchObject({ status: "failed" });
    vi.useRealTimers();
  });
});

describe("site state presentation helpers", () => {
  const record = (id: string): SiteRunRecord => ({
    id,
    kind: "build",
    status: "succeeded",
    message: id,
    startedAt: 1,
    durationMs: 2,
  });

  it("upserts records by id and enforces the history limit", () => {
    const history = Array.from({ length: SITE_RUN_HISTORY_LIMIT }, (_, index) => record(`run-${index}`));
    const next = upsertRunRecord(history, record("run-5"));
    expect(next).toHaveLength(SITE_RUN_HISTORY_LIMIT);
    expect(next[0]?.id).toBe("run-5");
    expect(next.filter((item) => item.id === "run-5")).toHaveLength(1);
  });

  it("recognizes in-progress records and formats compact labels", () => {
    expect(isRunRecordInProgress({ ...record("queued"), status: "queued" })).toBe(true);
    expect(isRunRecordInProgress(record("done"))).toBe(false);
    expect(shortPath("a/b/c/d/e.md")).toBe(".../c/d/e.md");
    expect(shortPath("README.md")).toBe("README.md");
    expect(defaultTitleFromRepo("C:\\notes\\docs")).toBe("docs");
    expect(defaultTitleFromRepo("", "Fallback")).toBe("Fallback");
    expect(formatDuration(999)).toBe("999 ms");
    expect(formatDuration(1_250)).toBe("1.3 s");
  });
});
