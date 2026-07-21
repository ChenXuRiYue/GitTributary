import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverPluginBackends } from "./plugin-backends.mjs";

test("discovers plugin backend manifests and preserves stable suite identifiers", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "gittributary-plugin-backends-"));
  try {
    for (const plugin of ["attachment-manager", "future-plugin", "site-publisher"]) {
      const backend = path.join(root, "plugins", plugin, "backend");
      mkdirSync(backend, { recursive: true });
      writeFileSync(path.join(backend, "Cargo.toml"), "[package]\n");
    }
    mkdirSync(path.join(root, "plugins", "frontend-only", "frontend"), { recursive: true });

    assert.deepEqual(discoverPluginBackends(root), [
      {
        directory: "attachment-manager",
        id: "plugins-attachment",
        label: "Attachment manager plugin",
        manifest: "plugins/attachment-manager/backend/Cargo.toml",
      },
      {
        directory: "future-plugin",
        id: "plugins-future-plugin",
        label: "future-plugin plugin",
        manifest: "plugins/future-plugin/backend/Cargo.toml",
      },
      {
        directory: "site-publisher",
        id: "plugins-site",
        label: "Site publisher plugins",
        manifest: "plugins/site-publisher/backend/Cargo.toml",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("returns no backends when the plugins directory is absent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "gittributary-plugin-backends-empty-"));
  try {
    assert.deepEqual(discoverPluginBackends(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
