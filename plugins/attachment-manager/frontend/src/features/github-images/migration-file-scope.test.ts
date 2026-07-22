import { describe, expect, it } from "vitest";

import { attachment } from "../../test/fixtures";
import {
  allMigrationFolders,
  buildMigrationContentFiles,
  buildMigrationFolderTree,
  resolveMigrationFileScope,
  uniqueMigrationImages,
} from "./migration-file-scope";

const candidates = [
  attachment({
    path: "assets/one.png",
    references: [
      { notePath: "README.md", line: 1 },
      { notePath: "docs/chapter-1.md", line: 2 },
    ],
  }),
  attachment({
    path: "assets/two.png",
    references: [{ notePath: "docs/chapter-2.md", line: 3 }],
  }),
  attachment({
    path: "assets/generated.png",
    references: [{ notePath: "docs/generated/result.md", line: 4 }],
  }),
];

describe("migration file scope", () => {
  it("builds content files and deduplicates images shared by notes", () => {
    const files = buildMigrationContentFiles(candidates);

    expect(files.map((file) => file.path)).toEqual([
      "docs/chapter-1.md",
      "docs/chapter-2.md",
      "docs/generated/result.md",
      "README.md",
    ]);
    expect(uniqueMigrationImages(files)).toHaveLength(3);
  });

  it("builds selectable folders from content-file paths", () => {
    const files = buildMigrationContentFiles(candidates);
    const tree = buildMigrationFolderTree(files);

    expect(tree.totalFileCount).toBe(4);
    expect(tree.children[0].path).toBe("docs");
    expect(allMigrationFolders(files)).toEqual(["", "docs", "docs/generated"]);
  });

  it("supports exact manual folders and gitignore-compatible rules", () => {
    const files = buildMigrationContentFiles(candidates);

    expect(resolveMigrationFileScope(files, {
      mode: "manual",
      manualFolders: ["docs"],
      rules: "",
    }).files.map((file) => file.path)).toEqual([
      "docs/chapter-1.md",
      "docs/chapter-2.md",
    ]);

    expect(resolveMigrationFileScope(files, {
      mode: "rules",
      manualFolders: null,
      rules: "docs/*.md\n!docs/chapter-2.md\n/docs/generated/",
    }).files.map((file) => file.path)).toEqual([
      "docs/chapter-2.md",
      "README.md",
    ]);
  });
});
