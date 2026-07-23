import { describe, expect, it } from "vitest";
import { parseGalleryUiState } from "./gallery-ui-state";

describe("gallery persisted UI state", () => {
  it("restores a non-sensitive unsaved library draft", () => {
    const state = parseGalleryUiState({
      version: 1,
      page: {
        id: "repository", existing: false,
        library: {
          id: "draft", name: "文档图库", remote: null, branch: "preview", directory: "assets",
        },
      },
      updatedAt: 42,
    });
    expect(state?.page).toMatchObject({
      id: "repository",
      library: { name: "文档图库", branch: "preview", directory: "assets" },
    });
  });

  it("rejects arbitrary page identifiers", () => {
    expect(parseGalleryUiState({ version: 1, page: { id: "token" }, updatedAt: 42 })).toBeNull();
  });
});
