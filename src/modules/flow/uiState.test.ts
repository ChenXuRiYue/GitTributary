import { describe, expect, it } from "vitest";

import { parseFlowEventUiState, parseFlowNodeUiState, parseFlowUiState } from "./uiState";

const workspaceState = {
  version: 1, section: "flows", selection: null, mode: "read", listMode: "list",
  fileListWidth: 320, editor: null, updatedAt: 42,
} as const;

describe("flow persisted UI state", () => {
  it("accepts a focused section and an unsaved YAML draft", () => {
    expect(parseFlowUiState({
      ...workspaceState, section: "nodes",
      selection: { type: "flow", id: "publish" },
      mode: "operate", listMode: "tree", fileListWidth: 360,
      editor: { flowId: "publish", folder: "release", yaml: "name: publish\n" },
    })).toMatchObject({
      section: "nodes",
      selection: { type: "flow", id: "publish" },
      editor: { yaml: "name: publish\n" },
    });
  });

  it("rejects malformed selections and drafts", () => {
    expect(parseFlowUiState({
      ...workspaceState, selection: { type: "flow", id: 4 },
    })).toBeNull();
    expect(parseFlowUiState({
      ...workspaceState,
      editor: { flowId: null, folder: "drafts", yaml: 7 },
    })).toBeNull();
  });

  it("parses event and node catalog focus independently", () => {
    expect(parseFlowEventUiState({
      version: 1, query: "push", domainFilter: "git", stabilityFilter: "stable",
      filterabilityFilter: "filterable", selectedType: "git.push", updatedAt: 42,
    })).toMatchObject({ selectedType: "git.push", query: "push" });
    expect(parseFlowNodeUiState({
      version: 1, query: "publish", typeFilter: "action", sourceFilter: "plugin",
      usageFilter: "used", schemaFilter: "input", selectedUses: "plugin.publish", updatedAt: 42,
    })).toMatchObject({ selectedUses: "plugin.publish", sourceFilter: "plugin" });
  });
});
