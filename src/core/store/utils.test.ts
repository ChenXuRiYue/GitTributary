import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { STORE_DOMAIN_MIN_WIDTH } from "./constants";
import type { KvEntry } from "./types";
import {
  buildJsonGroups,
  buildKeyTree,
  domainLabel,
  formatPrimitive,
  isConfigCenterUrl,
  isExpandable,
  isL0Key,
  parseStoredWidth,
  parseStorePanelUiState,
  primitiveClassName,
  repoNameFromUrl,
  sortedChildren,
  sortedObjectEntries,
  stringifyValue,
  valueKind,
} from "./utils";

describe("store security and persisted UI state", () => {
  it.each([
    "git.access_token",
    "git.ssh_passphrase",
    "data_center.config_repo.token",
    "project.notes.token",
  ])("classifies %s as an L0 secret", (key) => {
    expect(isL0Key(key)).toBe(true);
  });

  it.each(["git.username", "project.notes.token.extra", "private.token"])(
    "does not over-classify %s as an L0 secret",
    (key) => expect(isL0Key(key)).toBe(false),
  );

  it("accepts only trimmed HTTPS config-center URLs", () => {
    expect(isConfigCenterUrl("  https://example.test/config.git  ")).toBe(true);
    expect(isConfigCenterUrl("http://example.test/config.git")).toBe(false);
    expect(isConfigCenterUrl("ssh://git@example.test/config.git")).toBe(false);
  });

  it("parses only the current complete UI-state schema", () => {
    expect(parseStorePanelUiState({
      version: 1,
      namespace: "workspace",
      viewMode: "tree",
      updatedAt: 42,
      ignored: true,
    })).toEqual({ version: 1, namespace: "workspace", viewMode: "tree", updatedAt: 42 });

    for (const invalid of [
      null,
      [],
      { version: 2, namespace: "workspace", viewMode: "tree", updatedAt: 42 },
      { version: 1, namespace: "", viewMode: "tree", updatedAt: 42 },
      { version: 1, namespace: "workspace", viewMode: "table", updatedAt: 42 },
      { version: 1, namespace: "workspace", viewMode: "tree", updatedAt: Infinity },
    ]) {
      expect(parseStorePanelUiState(invalid)).toBeNull();
    }
  });

  it("clamps every finite persisted width to the domain minimum", () => {
    fc.assert(fc.property(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      (width) => {
        expect(parseStoredWidth(width)).toBe(Math.max(STORE_DOMAIN_MIN_WIDTH, width));
      },
    ));
    expect(parseStoredWidth("208")).toBeNull();
    expect(parseStoredWidth(Number.NaN)).toBeNull();
  });
});

describe("store value presentation", () => {
  it("serializes values and safely falls back for circular objects", () => {
    expect(stringifyValue({ b: 2 }, 2)).toBe('{\n  "b": 2\n}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(stringifyValue(circular)).toBe("[object Object]");
  });

  it.each([
    [null, "null"],
    [[1, 2], "array:2"],
    [{ a: 1 }, "object:1"],
    ["value", "string"],
    [false, "boolean"],
  ])("describes %# as %s", (value, expected) => {
    expect(valueKind(value)).toBe(expected);
  });

  it("formats primitives for JSON and conservative YAML scalars", () => {
    expect(formatPrimitive("hello", "json")).toBe('"hello"');
    expect(formatPrimitive("hello/world", "yaml")).toBe("hello/world");
    expect(formatPrimitive("hello world", "yaml")).toBe('"hello world"');
    expect(formatPrimitive(12)).toBe("12");
    expect(formatPrimitive(false)).toBe("false");
    expect(formatPrimitive(null)).toBe("null");
  });

  it("uses stable visual classes by primitive kind", () => {
    expect(primitiveClassName(null)).toContain("muted");
    expect(primitiveClassName("text")).toContain("emerald");
    expect(primitiveClassName(1)).toContain("sky");
    expect(primitiveClassName(true)).toContain("violet");
    expect(primitiveClassName(undefined)).toBe("text-foreground");
  });

  it("detects only non-empty expandable values", () => {
    expect(isExpandable([1])).toBe(true);
    expect(isExpandable({ a: 1 })).toBe(true);
    expect(isExpandable([])).toBe(false);
    expect(isExpandable({})).toBe(false);
    expect(isExpandable(null)).toBe(false);
  });

  it("sorts object entries without mutating the input", () => {
    const input = { z: 1, a: 2 };
    expect(sortedObjectEntries(input)).toEqual([["a", 2], ["z", 1]]);
    expect(Object.keys(input)).toEqual(["z", "a"]);
  });
});

describe("store repository labels", () => {
  it.each([
    ["https://github.com/org/repo.git", "org/repo"],
    ["git@github.com:org/repo.git", "org/repo"],
    ["ssh://git@github.com/org/repo", "org/repo"],
    [" /tmp/org/repo/ ", "org/repo"],
    ["repo", "repo"],
  ])("derives %s as %s", (url, expected) => {
    expect(repoNameFromUrl(url)).toBe(expected);
  });

  it("removes only the private namespace prefix", () => {
    expect(domainLabel("private.workspace")).toBe("workspace");
    expect(domainLabel("workspace")).toBe("workspace");
  });
});

describe("store JSON and key-tree projections", () => {
  const entries: KvEntry[] = [
    { key: "app.theme", value: "dark" },
    { key: "app.locale", value: "zh-CN" },
    { key: "git.access_token", value: "must-not-leak" },
    { key: "project.blog.token", value: "also-secret" },
    { key: "workspace.repo.active", value: "/tmp/notes" },
  ];

  it("groups, sorts, nests, counts, and masks entries", () => {
    expect(buildJsonGroups(entries)).toEqual([
      { name: "app", value: { locale: "zh-CN", theme: "dark" }, count: 2 },
      { name: "git", value: { access_token: "••••••••" }, count: 1 },
      { name: "project", value: { blog: { token: "••••••••" } }, count: 1 },
      { name: "workspace", value: { repo: { active: "/tmp/notes" } }, count: 1 },
    ]);
  });

  it("preserves a value when one key is also another key's parent", () => {
    expect(buildJsonGroups([
      { key: "app", value: "root-value" },
      { key: "app.theme", value: "dark" },
    ])).toEqual([{
      name: "app",
      value: { $value: "root-value", theme: "dark" },
      count: 2,
    }]);
  });

  it("builds a sorted navigable key tree and keeps leaf entries", () => {
    const root = buildKeyTree(entries);
    expect(sortedChildren(root).map((node) => node.name)).toEqual([
      "app", "git", "project", "workspace",
    ]);
    const app = root.children.get("app");
    expect(app).toBeDefined();
    expect(sortedChildren(app!).map((node) => node.name)).toEqual(["locale", "theme"]);
    expect(app!.children.get("theme")?.entry).toEqual(entries[0]);
  });

  it("creates one leaf for every unique dotted key", () => {
    fc.assert(fc.property(
      fc.uniqueArray(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 4 })
          .map((parts) => parts.join(".")),
        { maxLength: 100 },
      ),
      (keys) => {
        const root = buildKeyTree(keys.map((key) => ({ key, value: key })));
        let leaves = 0;
        const visit = (node: ReturnType<typeof buildKeyTree>) => {
          if (node.entry) leaves += 1;
          node.children.forEach(visit);
        };
        visit(root);
        expect(leaves).toBe(keys.length);
      },
    ));
  });
});
