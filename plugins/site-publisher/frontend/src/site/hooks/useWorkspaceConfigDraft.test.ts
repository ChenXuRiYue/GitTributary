import { describe, expect, it } from "vitest";
import type { SiteWorkspaceGroup } from "../types";
import { makeWorkspaceEditorUiState, parseWorkspaceEditorUiState } from "./useWorkspaceConfigDraft";

const group: SiteWorkspaceGroup = {
  id: "site.docs",
  name: "Docs",
  sourceRepoPath: "/fixtures/docs",
  documentScope: ["README.md"],
  target: null,
  env: [{ id: "env.1", key: "BASE_URL", value: "/docs", enabled: true }],
  runHistory: [{ id: "run.1", kind: "build", status: "running", message: "building", startedAt: 10, durationMs: 20 }],
  updatedAt: 42,
};

describe("site workspace editor UI state", () => {
  it("persists editable fields without document scope or execution state", () => {
    const state = makeWorkspaceEditorUiState(group.id, group, 100);
    expect(state.draft).toMatchObject({ id: group.id, name: "Docs", env: group.env });
    expect(state.draft).not.toHaveProperty("documentScope");
    expect(state.draft).not.toHaveProperty("runHistory");
  });

  it("sanitizes legacy editor records that included runtime fields", () => {
    const parsed = parseWorkspaceEditorUiState({
      version: 1,
      viewingGroupId: group.id,
      draft: group,
      updatedAt: 100,
    });
    expect(parsed?.draft).not.toHaveProperty("documentScope");
    expect(parsed?.draft).not.toHaveProperty("runHistory");
  });
});
