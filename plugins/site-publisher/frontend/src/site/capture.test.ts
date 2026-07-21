import { describe, expect, it } from "vitest";

import {
  buildCaptureTree,
  collectNodeCandidates,
  collectOpenNodePaths,
  filterKnownPaths,
  flattenCaptureTree,
  isDirectoryNode,
  orderedCandidates,
  pathName,
  splitPath,
} from "./capture";
import type { SitePathCandidate } from "./types";

function candidate(path: string, kind: "file" | "dir" = "file"): SitePathCandidate {
  return {
    path,
    kind,
    score: 1,
    reason: [],
    markdownCount: kind === "file" ? 1 : 0,
    selectedByDefault: true,
  };
}

describe("site capture tree", () => {
  const candidates = [
    candidate("README.md"),
    candidate("docs" , "dir"),
    candidate("docs/guide.md"),
    candidate("docs/reference/api.md"),
  ];

  it("normalizes path separators and extracts names", () => {
    expect(splitPath("docs\\reference/api.md")).toEqual(["docs", "reference", "api.md"]);
    expect(splitPath("///")).toEqual([]);
    expect(pathName("docs/guide.md")).toBe("guide.md");
    expect(pathName("")).toBe("");
  });

  it("builds a sorted hierarchy and round-trips candidates", () => {
    const tree = buildCaptureTree(candidates);
    expect(tree.map((node) => node.name)).toEqual(["docs", "README.md"]);
    expect(isDirectoryNode(tree[0])).toBe(true);
    expect(flattenCaptureTree(tree).map((item) => item.path)).toEqual([
      "docs",
      "docs/reference/api.md",
      "docs/guide.md",
      "README.md",
    ]);
    expect(orderedCandidates(candidates)).toEqual(flattenCaptureTree(tree));
  });

  it("collects subtree candidates and open directory paths", () => {
    const tree = buildCaptureTree(candidates);
    expect(collectNodeCandidates(tree[0]).map((item) => item.path)).toEqual([
      "docs",
      "docs/reference/api.md",
      "docs/guide.md",
    ]);
    expect([...collectOpenNodePaths(tree)]).toEqual(["docs", "docs/reference"]);
  });

  it("drops persisted open paths that no longer exist", () => {
    expect(filterKnownPaths(["docs", "removed"], new Set(["docs", "reference"]))).toEqual(["docs"]);
  });
});
