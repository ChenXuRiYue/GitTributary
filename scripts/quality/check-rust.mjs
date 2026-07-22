#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFESTS = [
  "src-tauri/Cargo.toml",
  "plugins/site-publisher/backend/Cargo.toml",
  "plugins/attachment-manager/backend/Cargo.toml",
];
const tasks = MANIFESTS.flatMap((manifest) => [
  {
    label: `rustfmt ${manifest}`,
    command: "cargo-fmt",
    args: ["--manifest-path", manifest, "--all", "--", "--check"],
  },
  {
    label: `clippy ${manifest}`,
    command: "cargo-clippy",
    args: ["clippy", "--manifest-path", manifest, "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings"],
  },
]);

let failed = false;
for (const task of tasks) {
  process.stdout.write(`\n[quality:rust] ${task.label}\n`);
  const result = spawnSync(task.command, task.args, { cwd: ROOT, env: process.env, stdio: "inherit" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`[quality:rust] failed: ${task.label}\n`);
  }
}

if (failed) process.exitCode = 1;
