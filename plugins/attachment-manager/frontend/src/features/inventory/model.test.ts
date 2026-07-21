import { describe, expect, it } from "vitest";

import { attachment } from "../../test/fixtures";
import {
  countAttachments,
  countLinks,
  filterAndSortAttachments,
} from "./model";

const items = [
  attachment({ path: "assets/zeta.png", name: "zeta.png", size: 30 }),
  attachment({
    path: "assets/orphan.mp3",
    name: "orphan.mp3",
    extension: "mp3",
    kind: "audio",
    mimeType: "audio/mpeg",
    size: 20,
    references: [],
  }),
  attachment({
    path: "https://example.com/docs",
    name: "Example docs",
    extension: "",
    kind: "link",
    linkKind: "website",
    mimeType: "text/html",
    size: 0,
    url: "https://example.com/docs",
    domain: "example.com",
    references: [{ notePath: "guide.md", line: 3, role: "navigation" }],
  }),
  attachment({
    path: "https://cdn.example.com/unknown",
    name: "Unknown",
    extension: "",
    kind: "link",
    linkKind: null,
    mimeType: "application/octet-stream",
    size: 0,
    url: "https://cdn.example.com/unknown",
    domain: "cdn.example.com",
  }),
];

describe("inventory model", () => {
  it("counts attachment, orphan, and link classifications", () => {
    expect(countAttachments(items)).toEqual({
      all: 4,
      image: 1,
      audio: 1,
      link: 2,
      orphan: 1,
    });
    expect(countLinks(items)).toEqual({
      all: 2,
      image: 0,
      audio: 0,
      video: 0,
      website: 1,
      download: 0,
      unknown: 1,
    });
  });

  it("filters orphan attachments and link subtypes", () => {
    expect(filterAndSortAttachments(items, "orphan", "all", "", "name").map((item) => item.name))
      .toEqual(["orphan.mp3"]);
    expect(filterAndSortAttachments(items, "link", "website", "", "name").map((item) => item.name))
      .toEqual(["Example docs"]);
    expect(filterAndSortAttachments(items, "link", "unknown", "", "name").map((item) => item.name))
      .toEqual(["Unknown"]);
  });

  it("searches names, paths, URLs, and domains case-insensitively", () => {
    expect(filterAndSortAttachments(items, "all", "all", "ZETA", "name")).toHaveLength(1);
    expect(filterAndSortAttachments(items, "all", "all", "cdn.example", "name")).toHaveLength(1);
    expect(filterAndSortAttachments(items, "all", "all", "/docs", "name")).toHaveLength(1);
    expect(filterAndSortAttachments(items, "all", "all", "missing", "name")).toEqual([]);
  });

  it("sorts by size, references, and localized name with stable path tie breakers", () => {
    const duplicates = [
      attachment({ path: "b/same.png", name: "same.png", size: 10, references: [] }),
      attachment({ path: "a/same.png", name: "same.png", size: 10, references: [] }),
      attachment({ path: "large.png", name: "large.png", size: 99, references: [{ notePath: "a.md", line: 1 }] }),
    ];
    expect(filterAndSortAttachments(duplicates, "all", "all", "", "size").map((item) => item.path))
      .toEqual(["large.png", "a/same.png", "b/same.png"]);
    expect(filterAndSortAttachments(duplicates, "all", "all", "", "references")[0]?.path)
      .toBe("large.png");
    expect(filterAndSortAttachments(duplicates, "all", "all", "", "name").slice(1).map((item) => item.path))
      .toEqual(["a/same.png", "b/same.png"]);
  });
});
