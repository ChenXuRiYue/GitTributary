import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyPerformanceVerdict,
  buildReport,
  parseArgs,
  parsePerformanceResult,
  parsePlaywrightResult,
  parseRustOutput,
  parseVitestResult,
  renderHtml,
  renderMarkdown,
  usage,
  validateOutputPath,
} from "./report-lib.mjs";

test("parseArgs supports profiles, selectors, merge metadata, and repeated mappings", () => {
  const args = parseArgs([
    "--profile=ci", "--only", "frontend,rust", "--only", "e2e", "--skip=performance",
    "--coverage", "--output", "out", "--merge-dir=parts", "--rust-runner", "cargo",
    "--expect", "types,frontend,rust", "--job-status", "frontend=success,rust=failure",
    "--job-status=e2e=cancelled", "--external-status", "rust-coverage=success", "--list",
  ]);
  assert.deepEqual(args.only, ["frontend", "rust", "e2e"]);
  assert.deepEqual(args.skip, ["performance"]);
  assert.deepEqual(args.expect, ["types", "frontend", "rust"]);
  assert.deepEqual(args.jobStatuses, { frontend: "success", rust: "failure", e2e: "cancelled" });
  assert.deepEqual(args.externalStatuses, { "rust-coverage": "success" });
  assert.equal(args.profile, "ci");
  assert.equal(args.coverage, true);
  assert.equal(args.output, "out");
  assert.equal(args.mergeDir, "parts");
  assert.equal(args.rustRunner, "cargo");
  assert.equal(args.list, true);
  assert.match(usage(), /--job-status/);
});

test("validateOutputPath rejects destructive roots and paths outside allowed directories", () => {
  assert.equal(validateOutputPath("/repo/test-reports/latest", ["/repo/test-reports"]), "/repo/test-reports/latest");
  assert.throws(() => validateOutputPath("/repo", ["/repo/test-reports"]), /Unsafe --output path/);
  assert.throws(() => validateOutputPath("/repo/test-reports", ["/repo/test-reports"]), /Unsafe --output path/);
  assert.throws(() => validateOutputPath("/repo/escape", ["/repo/test-reports"]), /Unsafe --output path/);
});

test("validateOutputPath rejects symbolic links that escape an allowed root", { skip: process.platform === "win32" }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "gittributary-path-test-"));
  const allowed = path.join(directory, "allowed");
  const outside = path.join(directory, "outside");
  mkdirSync(allowed);
  mkdirSync(outside);
  symlinkSync(outside, path.join(allowed, "link"));
  try {
    assert.throws(() => validateOutputPath(path.join(allowed, "link", "report"), [allowed]), /symbolic link component/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("parseArgs rejects unknown values and malformed job status", () => {
  assert.throws(() => parseArgs(["--profile", "huge"]), /Invalid --profile/);
  assert.throws(() => parseArgs(["--job-status", "frontend"]), /Invalid --job-status mapping/);
  assert.throws(() => parseArgs(["--wat"]), /Unknown argument/);
});

test("parseArgs defaults to automatic Rust selection and accepts standard profile", () => {
  assert.equal(parseArgs([]).rustRunner, "auto");
  assert.equal(parseArgs(["--profile", "standard"]).profile, "standard");
  assert.match(usage(), /scripts\/test\/run-report\.mjs/);
});

test("parseVitestResult reads the native JSON summary", () => {
  const suite = parseVitestResult({
    success: false,
    numTotalTests: 4,
    numPassedTests: 2,
    numFailedTests: 1,
    numPendingTests: 1,
    numTotalTestSuites: 2,
    numFailedTestSuites: 1,
    testResults: [{ startTime: 10, endTime: 35, assertionResults: [] }],
  });
  assert.equal(suite.status, "FAIL");
  assert.deepEqual(suite.counts, { total: 4, passed: 2, failed: 1, skipped: 1 });
  assert.equal(suite.durationMs, 25);
});

test("parsePlaywrightResult handles expected, flaky, skipped, and unexpected", () => {
  const suite = parsePlaywrightResult({
    stats: { expected: 2, unexpected: 1, flaky: 1, skipped: 1, duration: 456 },
    suites: [{ specs: [{ tests: [{ projectName: "desktop" }, { projectName: "compact" }] }] }],
  });
  assert.equal(suite.status, "FAIL");
  assert.deepEqual(suite.counts, { total: 5, passed: 3, failed: 1, skipped: 1 });
  assert.deepEqual(suite.details.projects, ["desktop", "compact"]);
});

test("parseRustOutput aggregates cargo summaries", () => {
  const suite = parseRustOutput(`test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.10s\ntest result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s`);
  assert.equal(suite.status, "FAIL");
  assert.deepEqual(suite.counts, { total: 6, passed: 4, failed: 1, skipped: 1 });
  assert.equal(suite.durationMs, 300);
});

test("parseRustOutput reads a nextest summary and includes skipped tests", () => {
  const suite = parseRustOutput("Summary [   1.25s] 4 tests run: 3 passed, 1 failed, 2 skipped");
  assert.equal(suite.status, "FAIL");
  assert.deepEqual(suite.counts, { total: 6, passed: 3, failed: 1, skipped: 2 });
  assert.equal(suite.durationMs, 1250);
  assert.equal(suite.details.runner, "nextest");
});

test("parseRustOutput recognizes infrastructure failures without test summaries", () => {
  const suite = parseRustOutput("error: could not compile `gt-git` due to 1 previous error");
  assert.equal(suite.status, "INFRA_ERROR");
  assert.equal(suite.counts.total, 0);
});

test("parsePerformanceResult summarizes gates and collection errors", () => {
  const failed = parsePerformanceResult({ gates: [{ status: "pass", durationMs: 10 }, { status: "fail", durationMs: 20 }], metrics: [{ id: "latency" }] });
  assert.equal(failed.status, "FAIL");
  assert.deepEqual(failed.counts, { total: 2, passed: 1, failed: 1, skipped: 0 });
  assert.equal(failed.details.metricCount, 1);
  assert.equal(parsePerformanceResult({ collectionError: "missing metrics", gates: [] }).status, "INFRA_ERROR");
});

test("applyPerformanceVerdict preserves budget failures and missing measurements", () => {
  const base = parsePerformanceResult({ gates: [{ status: "pass" }] });
  const failed = applyPerformanceVerdict(base, "结论: **FAIL** (15/16 项指标通过，4/4 项门禁通过，20 项未采集)");
  assert.equal(failed.status, "FAIL");
  assert.deepEqual(failed.counts, { total: 40, passed: 19, failed: 1, skipped: 20 });

  const incomplete = applyPerformanceVerdict(base, "结论: **INCOMPLETE** (16/16 项指标通过，4/4 项门禁通过，20 项未采集)");
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.deepEqual(incomplete.counts, { total: 40, passed: 20, failed: 0, skipped: 20 });
});

test("buildReport marks absent expected fragments as NOT_RUN or INFRA_ERROR", () => {
  const report = buildReport({
    profile: "ci",
    selection: {
      expect: ["frontend", "rust", "e2e"],
      jobStatuses: { frontend: "success", rust: "failure", e2e: "success" },
    },
    suites: [{ id: "frontend", label: "Frontend", status: "PASS", counts: { total: 3, passed: 3, failed: 0, skipped: 0 } }],
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:02Z",
  });
  assert.equal(report.status, "FAIL");
  assert.equal(report.suites.find((suite) => suite.id === "rust").status, "INFRA_ERROR");
  assert.equal(report.suites.find((suite) => suite.id === "e2e").status, "NOT_RUN");
  assert.equal(report.durationMs, 2000);
});

test("renderers escape untrusted test labels and expose status", () => {
  const report = buildReport({
    profile: "quick",
    suites: [{ id: "x", label: "bad <script>|name", status: "PASS", durationMs: 5, counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, logPath: "raw/a log.txt", details: { reportPath: "raw/detail.html" } }],
  });
  const markdown = renderMarkdown(report);
  const html = renderHtml(report);
  assert.match(markdown, /bad <script>\\\|name/);
  assert.match(markdown, /raw\/a%20log.txt/);
  assert.match(markdown, /raw\/detail.html/);
  assert.doesNotMatch(html, /bad <script>/);
  assert.match(html, /bad &lt;script&gt;\|name/);
  assert.match(html, />PASS</);
  assert.match(html, />详细报告</);
});

test("renderers include collected coverage percentages", () => {
  const report = buildReport({
    suites: [{
      id: "frontend",
      status: "PASS",
      counts: { total: 2, passed: 2, failed: 0, skipped: 0 },
      details: { coverage: { statements: 27.55, branches: 27.36, functions: 27.84, lines: 27.88 } },
    }],
  });
  assert.match(renderMarkdown(report), /27\.55%/);
  assert.match(renderHtml(report), />27\.88%</);
});
