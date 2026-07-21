import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(root, "../../..");
const pluginSource = path.resolve(root, "src");

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@tauri-apps/api/core", replacement: path.resolve(pluginSource, "tauri-core.ts") },
      { find: "@tauri-apps/plugin-opener", replacement: path.resolve(pluginSource, "tauri-opener.ts") },
      { find: /^@\//, replacement: `${path.resolve(workspaceRoot, "src")}/` },
    ],
  },
  test: {
    name: "plugin:site-publisher",
    root,
    environment: "jsdom",
    globals: true,
    setupFiles: ["../../../packages/plugin-testkit/src/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true
  }
});
