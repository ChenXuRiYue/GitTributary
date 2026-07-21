import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    name: "plugin-testkit",
    root,
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true
  }
});
