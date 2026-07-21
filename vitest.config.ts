import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    allowOnly: false,
    restoreMocks: true,
    clearMocks: true,
    pool: "threads",
    fileParallelism: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/types.ts",
        "src/**/types/**",
        "src/components/ui/**",
        "src/main.tsx",
      ],
      thresholds: {
        statements: 27,
        branches: 27,
        functions: 27,
        lines: 27,
        "src/components/{DiffPanel,DiffViewer,FileTree,IconNav,ResizeHandle}.tsx": {
          statements: 80,
          branches: 75,
          functions: 85,
          lines: 85,
        },
        "src/core/flow/utils/*.ts": {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
        "src/core/store/utils.ts": {
          statements: 95,
          branches: 85,
          functions: 100,
          lines: 95,
        },
        "src/extensions/{api,bridge}.ts": {
          statements: 90,
          branches: 85,
          functions: 100,
          lines: 95,
        },
        "src/extensions/ExtensionFrame.tsx": {
          statements: 85,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
