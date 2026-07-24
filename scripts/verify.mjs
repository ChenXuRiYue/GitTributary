#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VERIFY_STEPS = Object.freeze([
  { id: "quality", label: "Quality gates", script: "quality:full" },
  { id: "report-self-test", label: "Test report infrastructure", script: "test:report:self" },
  { id: "plugin-host", label: "Plugin host preparation", script: "plugin:host:prepare" },
  { id: "plugin-bundle", label: "Bundled plugin preparation", script: "plugin:bundle:prepare" },
  { id: "build", label: "Production frontend build", script: "build" },
  { id: "tests", label: "Full test and performance suites", script: "test:all" },
]);

export function runVerification({
  steps = VERIFY_STEPS,
  spawn = spawnSync,
  stdout = process.stdout,
  stderr = process.stderr,
  cwd = ROOT,
  env = process.env,
  platform = process.platform,
} = {}) {
  const command = platform === "win32" ? "npm.cmd" : "npm";

  for (const [index, step] of steps.entries()) {
    stdout.write(`\n[verify] ${index + 1}/${steps.length} ${step.label}\n`);
    stdout.write(`[verify] npm run ${step.script}\n`);
    const result = spawn(command, ["run", step.script], {
      cwd,
      env,
      stdio: "inherit",
    });

    if (result.error) {
      stderr.write(`[verify] ${step.id} could not start: ${result.error.message}\n`);
      return 1;
    }
    if (result.status !== 0) {
      stderr.write(`[verify] ${step.id} failed with exit code ${result.status ?? "unknown"}\n`);
      return result.status || 1;
    }
  }

  stdout.write(`\n[verify] PASS: ${steps.length}/${steps.length} stages completed\n`);
  return 0;
}

export function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    process.stdout.write("Usage: npm run verify\n       npm run verify -- --list\n");
    return 0;
  }
  if (args.includes("--list")) {
    for (const step of VERIFY_STEPS) {
      process.stdout.write(`${step.id}\tnpm run ${step.script}\n`);
    }
    return 0;
  }
  if (args.length > 0) {
    process.stderr.write(`[verify] unknown argument: ${args[0]}\n`);
    return 2;
  }
  return runVerification();
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
