import { describe, expect, it } from "vitest";

import { parseAttachmentUiState } from "./ui-state";

const validState = {
  version: 1, activeModule: "domains",
  inventory: {
    selectedPath: "assets/logo.png", query: "logo", filter: "image", linkFilter: "all",
    viewMode: "list", sortMode: "references", page: 2,
  },
  domains: {
    selectedDomain: "example.com", selectedPath: "https://example.com/logo.png",
    query: "example", sort: "references", domainPage: 1, resourcePage: 2, resourceKind: "image",
  },
  migration: {
    selectedTaskId: "task-1", selectedPaths: ["assets/logo.png"],
    query: "logo", expandedFiles: ["README.md"],
  },
  layout: { inventoryWidth: 240, detailWidth: 360 },
  updatedAt: 42,
} as const;

describe("attachment persisted UI state", () => {
  it("keeps independent focus for every secondary page", () => {
    expect(parseAttachmentUiState(validState)).toEqual(validState);
  });

  it("rejects unknown routes and invalid page values", () => {
    expect(parseAttachmentUiState({ ...validState, activeModule: "unknown" })).toBeNull();
    expect(parseAttachmentUiState({
      ...validState, inventory: { ...validState.inventory, page: -1 },
    })).toBeNull();
  });
});
