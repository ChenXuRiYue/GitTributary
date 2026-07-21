#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GROUPS = ["types", "frontend", "rust", "plugins", "e2e", "performance"];
const PROFILES = {
  quick: ["types", "frontend", "rust"],
  standard: ["types", "frontend", "rust", "plugins", "e2e"],
  full: GROUPS,
  ci: GROUPS,
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n\n${usage()}`);
  process.exit(2);
}

if (options.help) {
  process.stdout.write(`${usage()}\nProfiles:\n  quick     types, frontend, rust\n  standard  quick + plugins + e2e\n  full      standard + performance\n  ci        full with CI-oriented runners\n`);
  process.exit(0);
}
if (options.list) {
  process.stdout.write(`Suites: ${GROUPS.join(", ")}\nProfiles:\n${Object.entries(PROFILES).map(([name, suites]) => `  ${name}: ${suites.join(", ")}`).join("\n")}\n`);
  process.exit(0);
}

let outputDirectory;
try {
  outputDirectory = validateOutputPath(path.resolve(ROOT, options.output), [path.join(ROOT, "test-reports"), os.tmpdir(), "/tmp", "/private/tmp"]);
} catch (error) {
  process.stderr.write(`[test-report] ${error.message}\n`);
  process.exit(2);
}
try {
  if (options.mergeDir) {
    const mergeDirectory = path.resolve(ROOT, options.mergeDir);
    if (mergeDirectory === outputDirectory || isStrictChild(mergeDirectory, outputDirectory) || isStrictChild(outputDirectory, mergeDirectory)) {
      throw new Error("--output and --merge-dir must not contain each other");
    }
    mergeReports(mergeDirectory, outputDirectory, options);
  } else {
    await runSelected(outputDirectory, options);
  }
} catch (error) {
  const report = buildReport({
    profile: options.profile,
    selection: { only: options.only, skip: options.skip, coverage: options.coverage },
    suites: [{
      id: "report-runner",
      label: "Test report runner",
      status: "INFRA_ERROR",
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      details: { reason: error instanceof Error ? error.message : String(error) },
    }],
    startedAt: new Date(),
    finishedAt: new Date(),
  });
  writeReport(outputDirectory, report);
  process.stderr.write(`[test-report] ${report.suites[0].details.reason}\n`);
  process.exitCode = 1;
}

async function runSelected(outputDir, args) {
  const selected = selectGroups(args);
  const startedAt = new Date();
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(path.join(outputDir, "logs"), { recursive: true });
  mkdirSync(path.join(outputDir, "raw"), { recursive: true });

  const needsRust = selected.includes("rust") || selected.includes("plugins");
  const rustRunner = needsRust ? chooseRustRunner(args.rustRunner) : "not-selected";
  const tasks = createTasks(selected, args, outputDir, rustRunner);
  const suites = [];
  process.stdout.write(`[test-report] profile=${args.profile} suites=${selected.join(",")} rust=${rustRunner}\n`);
  for (const task of tasks) {
    suites.push(await executeTask(task, outputDir));
  }

  const report = buildReport({
    profile: args.profile,
    selection: { only: selected, skip: args.skip, coverage: args.coverage },
    suites,
    startedAt,
    finishedAt: new Date(),
  });
  writeReport(outputDir, report);
  process.stdout.write(`[test-report] ${report.status}: ${report.counts.passed}/${report.counts.total} passed\n`);
  process.stdout.write(`[test-report] ${path.relative(ROOT, path.join(outputDir, "report.md"))}\n`);
  if (report.status === "FAIL" || report.suites.some((suite) => suite.status === "NOT_RUN")) process.exitCode = 1;
}

function selectGroups(args) {
  const requested = args.only.length > 0 ? args.only : PROFILES[args.profile];
  for (const name of [...requested, ...args.skip]) {
    if (!GROUPS.includes(name)) throw new Error(`Unknown suite: ${name}. Use --list to inspect valid suites.`);
  }
  const skipped = new Set(args.skip);
  const selected = requested.filter((name) => !skipped.has(name));
  if (selected.length === 0) throw new Error("No test suites selected after applying --only and --skip");
  return selected;
}

function chooseRustRunner(requested) {
  if (requested === "cargo") return "cargo";
  const available = spawnSync("cargo", ["nextest", "--version"], { cwd: ROOT, stdio: "ignore" }).status === 0;
  if (available) return "nextest";
  if (requested === "nextest") {
    throw new Error("cargo-nextest is required by --rust-runner nextest but is not installed");
  }
  process.stdout.write("[test-report] cargo-nextest unavailable; falling back to cargo test\n");
  return "cargo";
}

function createTasks(selected, args, outputDir, rustRunner) {
  const tasks = [];
  if (selected.includes("types")) {
    tasks.push(commandTask("types", "TypeScript type check", "npm", ["run", "test:types"], genericParser));
  }
  if (selected.includes("frontend")) {
    const jsonPath = path.join(outputDir, "raw", "vitest.json");
    const vitestArgs = ["vitest", "run", "--reporter=default", "--reporter=json", `--outputFile.json=${jsonPath}`];
    if (args.coverage) vitestArgs.push("--coverage");
    tasks.push(commandTask("frontend", "Frontend unit/property tests", "npx", vitestArgs, ({ execution }) => {
      const suite = parseStructured(jsonPath, parseVitestResult, execution, "Vitest JSON report was not generated");
      if (args.coverage) suite.details.coverage = readCoverageSummary(path.join(ROOT, "coverage", "coverage-summary.json"));
      return suite;
    }));
  }
  if (selected.includes("rust")) {
    tasks.push(rustTask("rust", "Rust core workspace", "src-tauri/Cargo.toml", ["--workspace", "--all-targets"], rustRunner));
  }
  if (selected.includes("plugins")) {
    tasks.push(rustTask("plugins-site", "Site publisher plugins", "plugins/site-publisher/backend/Cargo.toml", ["--workspace", "--all-targets"], rustRunner));
    tasks.push(rustTask("plugins-attachment", "Attachment manager plugin", "plugins/attachment-manager/backend/Cargo.toml", ["--all-targets"], rustRunner));
  }
  if (selected.includes("e2e")) {
    const jsonPath = path.join(outputDir, "raw", "playwright.json");
    tasks.push({
      ...commandTask("e2e", "Playwright user journeys", "npx", ["playwright", "test"], ({ execution }) => parseStructured(
        jsonPath, parsePlaywrightResult, execution, "Playwright JSON report was not generated",
      )),
      env: { GT_PLAYWRIGHT_JSON_OUTPUT: jsonPath },
    });
  }
  if (selected.includes("performance")) {
    const perfOutput = path.join(outputDir, "raw", "performance");
    const metricsPath = path.join(perfOutput, "metrics.json");
    tasks.push({
      ...commandTask("performance", "Performance contracts and budgets", process.execPath, ["scripts/perf/run-all.mjs"], ({ execution }) => {
        let suite = parseStructured(metricsPath, parsePerformanceResult, execution, "Performance metrics were not generated");
        const detailedMarkdown = path.join(perfOutput, "report.md");
        if (existsSync(detailedMarkdown)) {
          suite = applyPerformanceVerdict(suite, readFileSync(detailedMarkdown, "utf8"));
          if (suite.status === "INCOMPLETE") suite.details.reason = "The performance model still contains uncollected budgets";
          if (suite.status === "FAIL") suite.details.reason = "One or more performance budgets failed";
        }
        if (existsSync(path.join(perfOutput, "report.html"))) suite.details.reportPath = "raw/performance/report.html";
        return suite;
      }),
      env: { GT_PERF_OUTPUT: perfOutput },
    });
  }
  return tasks;
}

function commandTask(id, label, command, commandArgs, parser) {
  return { id, label, command, args: commandArgs, parser, env: {} };
}

function rustTask(id, label, manifest, extraArgs, runner) {
  const args = runner === "nextest"
    ? ["nextest", "run", "--manifest-path", manifest, ...extraArgs, ...(process.env.CI ? ["--profile", "ci"] : [])]
    : ["test", "--manifest-path", manifest, ...extraArgs];
  return commandTask(id, label, "cargo", args, ({ output, execution }) => {
    const suite = parseRustOutput(output);
    return withExecutionStatus(suite, execution, "Rust runner produced no test summary");
  });
}

async function executeTask(task, outputDir) {
  const logFile = path.join(outputDir, "logs", `${task.id}.log`);
  const log = createWriteStream(logFile, { encoding: "utf8" });
  const started = process.hrtime.bigint();
  process.stdout.write(`\n[test-report] ${task.label}\n`);
  const execution = await spawnTask(task, log);
  log.end();
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  let suite;
  try {
    suite = task.parser({ execution, output: execution.output });
  } catch (error) {
    suite = {
      id: task.id,
      label: task.label,
      status: "INFRA_ERROR",
      counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      details: { reason: error.message },
    };
  }
  suite.id = task.id;
  suite.label = task.label;
  suite.durationMs = durationMs;
  suite.command = formatCommand(task.command, task.args);
  suite.logPath = `logs/${task.id}.log`;
  suite.details = { ...suite.details, exitCode: execution.exitCode, signal: execution.signal };
  process.stdout.write(`[test-report] ${task.id}: ${suite.status}\n`);
  return suite;
}

function spawnTask(task, log) {
  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, {
      cwd: ROOT,
      env: { ...process.env, ...task.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let bufferedBytes = 0;
    const capture = (chunk, target) => {
      target.write(chunk);
      log.write(chunk);
      if (bufferedBytes < 8 * 1024 * 1024) {
        chunks.push(chunk);
        bufferedBytes += chunk.length;
      }
    };
    child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
    child.on("error", (error) => resolve({ exitCode: null, signal: null, error: error.message, output: Buffer.concat(chunks).toString("utf8") }));
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal, error: null, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

function parseStructured(file, parser, execution, missingReason) {
  if (!existsSync(file)) return infrastructureSuite(missingReason, execution);
  const suite = parser(readFileSync(file, "utf8"));
  return withExecutionStatus(suite, execution, missingReason);
}

function genericParser({ execution }) {
  const passed = execution.exitCode === 0;
  return {
    id: "generic",
    label: "Command",
    status: passed ? "PASS" : "INFRA_ERROR",
    counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
    details: passed ? {} : { reason: execution.error ?? `Command exited with code ${execution.exitCode}` },
  };
}

function readCoverageSummary(file) {
  if (!existsSync(file)) return null;
  const total = JSON.parse(readFileSync(file, "utf8")).total ?? {};
  return Object.fromEntries(["statements", "branches", "functions", "lines"].map((key) => [key, total[key]?.pct ?? null]));
}

function withExecutionStatus(suite, execution, missingReason) {
  if (execution.exitCode === 0) return suite;
  if (suite.counts?.failed > 0) return { ...suite, status: "FAIL" };
  return {
    ...suite,
    status: "INFRA_ERROR",
    details: { ...suite.details, reason: execution.error ?? `${missingReason}; exit code ${execution.exitCode}` },
  };
}

function infrastructureSuite(reason, execution) {
  return {
    id: "unknown",
    label: "Unknown suite",
    status: "INFRA_ERROR",
    counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
    details: { reason: execution.error ?? reason },
  };
}

function mergeReports(partsDir, outputDir, args) {
  const files = findFiles(partsDir, "results.json").filter((file) => path.resolve(file) !== path.join(outputDir, "results.json"));
  const fragments = files.map((file) => ({ file, report: JSON.parse(readFileSync(file, "utf8")) }));
  const suites = [];
  for (const { file, report } of fragments) {
    for (const suite of report.suites ?? []) {
      const logPath = suite.logPath
        ? path.relative(outputDir, path.resolve(path.dirname(file), suite.logPath)).split(path.sep).join("/")
        : null;
      const reportPath = suite.details?.reportPath
        ? path.relative(outputDir, path.resolve(path.dirname(file), suite.details.reportPath)).split(path.sep).join("/")
        : null;
      suites.push({
        ...suite,
        logPath,
        details: reportPath ? { ...suite.details, reportPath } : suite.details,
      });
    }
  }
  const uniqueSuites = [...new Map(suites.map((suite) => [suite.id, suite])).values()];
  uniqueSuites.push(...Object.entries(args.externalStatuses).map(([id, status]) => externalSuite(id, status)));
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const report = buildReport({
    profile: args.profile,
    selection: { only: args.only, skip: args.skip, coverage: args.coverage },
    suites: uniqueSuites,
    startedAt: earliest(fragments.map(({ report: item }) => item.startedAt)),
    finishedAt: latest(fragments.map(({ report: item }) => item.finishedAt)),
    expect: args.expect,
    jobStatuses: args.jobStatuses,
  });
  writeReport(outputDir, report);
  process.stdout.write(`[test-report] merged ${fragments.length} fragments: ${report.status}\n`);
  const missingFragment = report.suites.some((suite) => suite.status === "NOT_RUN" && suite.details?.reason === "Expected report fragment was not found");
  if (report.status === "FAIL" || fragments.length === 0 || missingFragment) process.exitCode = 1;
}

function externalSuite(id, jobStatus) {
  const status = String(jobStatus).toLowerCase();
  const passed = ["success", "neutral"].includes(status);
  return {
    id,
    label: id === "rust-coverage" ? "Rust coverage collection" : id,
    status: passed ? "PASS" : status === "skipped" ? "NOT_RUN" : "INFRA_ERROR",
    counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
    details: { reason: passed ? null : `CI job ended with status: ${jobStatus}` },
  };
}

function writeReport(outputDir, report) {
  mkdirSync(outputDir, { recursive: true });
  const enriched = {
    ...report,
    environment: {
      os: os.platform(),
      arch: os.arch(),
      node: process.version,
      ci: Boolean(process.env.CI),
      gitSha: process.env.GITHUB_SHA ?? null,
    },
  };
  writeFileSync(path.join(outputDir, "results.json"), `${JSON.stringify(enriched, null, 2)}\n`);
  writeFileSync(path.join(outputDir, "report.md"), renderMarkdown(enriched));
  writeFileSync(path.join(outputDir, "report.html"), renderHtml(enriched));
}

function findFiles(directory, basename) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? findFiles(file, basename) : entry.name === basename ? [file] : [];
  });
}

function earliest(values) {
  return values.filter(Boolean).sort().at(0) ?? null;
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function formatCommand(command, args) {
  return [command, ...args].map((value) => /\s/.test(value) ? JSON.stringify(value) : value).join(" ");
}

function isStrictChild(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
