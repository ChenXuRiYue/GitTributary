#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_POLICY,
  buildSnapshot,
  createBaseline,
  evaluateSnapshot,
  renderMarkdownReport,
} from "./quality-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE_PATH = path.join(ROOT, "scripts/quality/quality-baseline.json");
const REPORT_DIRECTORY = path.join(ROOT, "quality-reports/latest");
const args = new Set(process.argv.slice(2));
const update = args.delete("--update");

if (args.size > 0) {
  process.stderr.write(`Unknown arguments: ${[...args].join(", ")}\n`);
  process.exit(2);
}

const existing = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : null;
const policy = existing?.policy ?? DEFAULT_POLICY;
const current = buildSnapshot(ROOT, policy);

if (update) {
  const baseline = createBaseline(current, policy);
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  writeReport(current, baseline, evaluateSnapshot(current, baseline));
  process.stdout.write(`[quality] baseline updated: ${path.relative(ROOT, BASELINE_PATH)}\n`);
  process.stdout.write(`[quality] ${current.totals.files} files / ${current.totals.lines} lines\n`);
} else {
  if (!existing) {
    process.stderr.write("[quality] baseline is missing; run npm run quality:baseline:update\n");
    process.exit(2);
  }
  const evaluation = evaluateSnapshot(current, existing);
  writeReport(current, existing, evaluation);
  process.stdout.write(`[quality] ${evaluation.status}: ${current.totals.files} files / ${current.totals.lines} lines`);
  process.stdout.write(` (${formatDelta(evaluation.changes.files)} files / ${formatDelta(evaluation.changes.lines)} lines)\n`);
  process.stdout.write(`[quality] report: ${path.relative(ROOT, path.join(REPORT_DIRECTORY, "report.md"))}\n`);
  for (const violation of evaluation.violations) {
    process.stderr.write(`[quality] ${violation.code}${violation.path ? ` ${violation.path}` : ""}: ${violation.message}\n`);
  }
  if (evaluation.status === "FAIL") process.exitCode = 1;
}

function writeReport(current, baseline, evaluation) {
  mkdirSync(REPORT_DIRECTORY, { recursive: true });
  writeFileSync(path.join(REPORT_DIRECTORY, "results.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseline: { capturedAt: baseline.capturedAt, policy: baseline.policy },
    current,
    evaluation,
  }, null, 2)}\n`);
  writeFileSync(path.join(REPORT_DIRECTORY, "report.md"), renderMarkdownReport(current, baseline, evaluation));
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : String(value);
}
