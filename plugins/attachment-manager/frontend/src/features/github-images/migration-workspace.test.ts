import { describe, expect, it } from "vitest";

import type { ImageMigrationTaskRecord } from "../../types";
import {
  defaultMigrationSettings,
  emptyMigrationWorkspace,
  MIGRATION_HISTORY_LIMIT,
  parseMigrationWorkspace,
  upsertMigrationTask,
} from "./migration-workspace";

const task: ImageMigrationTaskRecord = {
  id: "task-1",
  status: "running",
  repoPath: "/repos/notes",
  settings: defaultMigrationSettings("library"),
  library: {
    id: "library",
    name: "文档图库",
    config: {
      remote: { repoPath: "/repos/notes", name: "image-cloud", url: "https://github.com/example/images.git" },
      branch: "main",
      directory: "images",
    },
  },
  imagePaths: ["assets/one.png"],
  noteCount: 1,
  startedAt: 100,
};

describe("migration workspace state", () => {
  it("recovers unfinished tasks as interrupted", () => {
    const state = parseMigrationWorkspace({
      version: 1,
      drafts: { "/repos/notes": task.settings },
      history: [task],
      updatedAt: 100,
    }, 500);

    expect(state.drafts["/repos/notes"]).toEqual(task.settings);
    expect(state.history[0]).toMatchObject({ status: "interrupted", finishedAt: 500 });
  });

  it("rejects malformed state and limits history", () => {
    expect(parseMigrationWorkspace({ version: 2 })).toMatchObject({ version: 1, history: [] });
    let state = emptyMigrationWorkspace(0);
    for (let index = 0; index < MIGRATION_HISTORY_LIMIT + 4; index += 1) {
      state = upsertMigrationTask(state, { ...task, id: `task-${index}` }, index);
    }
    expect(state.history).toHaveLength(MIGRATION_HISTORY_LIMIT);
    expect(state.history[0].id).toBe(`task-${MIGRATION_HISTORY_LIMIT + 3}`);
  });

  it("preserves file scope and accepts drafts created before it existed", () => {
    const legacy = { version: 1 as const, targetLibraryId: "library", localFilePolicy: "keep" as const };
    const scoped = {
      ...legacy,
      fileScope: {
        mode: "rules" as const,
        manualFolders: ["docs"],
        rules: "/docs/generated/",
      },
    };
    const state = parseMigrationWorkspace({
      version: 1,
      drafts: { legacy, scoped },
      history: [],
      updatedAt: 100,
    });

    expect(state.drafts.legacy).toEqual(legacy);
    expect(state.drafts.scoped).toEqual(scoped);
  });
});
