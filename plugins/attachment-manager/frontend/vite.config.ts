import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const workspaceRoot = path.resolve(__dirname, "../../..");
const pluginSource = path.resolve(__dirname, "src");

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@tauri-apps/api/core", replacement: path.resolve(pluginSource, "tauri-core.ts") },
      { find: "@tauri-apps/plugin-opener", replacement: path.resolve(pluginSource, "tauri-opener.ts") },
      { find: /^@\//, replacement: `${path.resolve(workspaceRoot, "src")}/` },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
