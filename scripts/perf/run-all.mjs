#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = path.resolve(ROOT, process.env.GT_PERF_OUTPUT ?? "performance/reports/latest");
const metricsPath = path.join(outputDirectory, "metrics.json");
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const tasks = [
  {
    id: "static-contracts",
    command: process.execPath,
    args: ["scripts/check_git_performance_contract.mjs"],
  },
  {
    id: "git-fixtures",
    command: "cargo",
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "-p", "gt-git", "--release", "--test", "performance_test", "--", "--ignored", "--nocapture", "--test-threads=1"],
  },
  {
    id: "attachment-fixture",
    command: "cargo",
    args: ["test", "--manifest-path", "plugins/attachment-manager/backend/Cargo.toml", "--release", "classifies_large_link_inventory_within_budget", "--", "--ignored", "--nocapture", "--test-threads=1"],
  },
  {
    id: "plugin-ipc",
    command: process.execPath,
    args: ["scripts/perf/run-ipc.mjs", "--output", path.relative(ROOT, metricsPath)],
  },
];

const executions = [];
for (const task of tasks) {
  process.stdout.write(`\n[perf] ${task.id}\n`);
  const started = process.hrtime.bigint();
  const execution = spawnSync(task.command, task.args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (execution.stdout) process.stdout.write(execution.stdout);
  if (execution.stderr) process.stderr.write(execution.stderr);
  executions.push({
    ...task,
    durationMs,
    status: execution.status,
    signal: execution.signal,
    error: execution.error?.message ?? null,
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? "",
  });
}

let report = {};
try {
  report = JSON.parse(readFileSync(metricsPath, "utf8"));
} catch (error) {
  report = {
    schemaVersion: 1,
    suite: "gittributary-performance",
    generatedAt: new Date().toISOString(),
    environment: {},
    scenarios: {},
    metrics: [],
    collectionError: error instanceof Error ? error.message : String(error),
  };
}

report.suite = "gittributary-performance";
report.gates = executions.map((execution) => ({
  id: execution.id,
  command: [execution.command, ...execution.args].join(" "),
  durationMs: execution.durationMs,
  status: execution.status === 0 ? "pass" : "fail",
  exitCode: execution.status,
  signal: execution.signal,
  error: execution.error,
  summary: summarizeOutput(execution.stdout, execution.stderr),
}));
report.metrics ??= [];
report.metrics.push(...parseGitMetrics(executions.find((item) => item.id === "git-fixtures")?.stdout ?? ""));
report.metrics.push(...parseAttachmentMetrics(executions.find((item) => item.id === "attachment-fixture")?.stdout ?? ""));
writeFileSync(metricsPath, `${JSON.stringify(report, null, 2)}\n`);

const renderArgs = [
  "scripts/perf/render-report.mjs",
  "--input", metricsPath,
  "--model", path.join(ROOT, "performance/model.json"),
  "--output", outputDirectory,
];
if (process.env.GT_PERF_BASELINE) {
  renderArgs.push("--baseline", path.resolve(ROOT, process.env.GT_PERF_BASELINE));
}
const render = spawnSync(process.execPath, renderArgs, {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (render.stdout) process.stdout.write(render.stdout);
if (render.stderr) process.stderr.write(render.stderr);

const failedTasks = executions.filter((execution) => execution.status !== 0);
if (failedTasks.length > 0 || render.status !== 0) {
  process.stderr.write(`[perf] failed gates: ${failedTasks.map((task) => task.id).join(", ") || "report budget"}\n`);
  process.exitCode = 1;
}

function parseGitMetrics(output) {
  return perfRecords(output)
    .filter((record) => record.fixture && record.operation)
    .map((record) => ({
      id: `core.git.${record.fixture}.${record.operation}`,
      name: `Git ${record.fixture} ${record.operation}`,
      framework: "RAIL",
      layer: "core",
      statistic: "p95",
      unit: "ms",
      statistics: numericStatistics(record),
      sampleCount: number(record.samples),
      rows: number(record.rows),
      estimatedBytes: number(record.estimated_bytes),
      inlineBudget: { operator: "<=", value: number(record.budget_ms), unit: "ms" },
    }));
}

function parseAttachmentMetrics(output) {
  return perfRecords(output)
    .filter((record) => record.fixture === "attachment-links")
    .map((record) => ({
      id: "core.attachments.link_scan",
      name: "附件 5,000 链接扫描",
      framework: "RAIL",
      layer: "core",
      statistic: "p95",
      unit: "ms",
      statistics: numericStatistics(record),
      sampleCount: number(record.samples),
      rows: number(record.links),
      inlineBudget: { operator: "<=", value: number(record.budget_ms), unit: "ms" },
    }));
}

function perfRecords(output) {
  return output.split(/\r?\n/)
    .filter((line) => line.includes("PERF "))
    .map((line) => Object.fromEntries([...line.matchAll(/([a-zA-Z0-9_]+)=([^\s]+)/g)].map((match) => [match[1], match[2]])));
}

function numericStatistics(record) {
  return {
    min: number(record.min_ms),
    p50: number(record.p50_ms),
    p95: number(record.p95_ms),
    p99: number(record.p99_ms),
    max: number(record.max_ms),
  };
}

function number(value) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeOutput(stdout, stderr) {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const important = lines.filter((line) => /^(PERF |PASS |All |test result:|Wrote )/.test(line));
  return (important.length > 0 ? important : lines).slice(-20);
}
