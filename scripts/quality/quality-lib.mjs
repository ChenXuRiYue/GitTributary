import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const DEFAULT_POLICY = Object.freeze({
  maxFileLines: 500,
  largeFileWarningLines: 300,
  maxTotalLineGrowth: 1500,
  maxFileGrowth: 20,
  allowedOversizedFileGrowth: 0,
});

const CODE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".rs", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "quality-reports",
  "target",
  "test-reports",
  "test-results",
]);
const IGNORED_PATH_PREFIXES = [
  "src-tauri/binaries/",
  "src-tauri/gen/",
  "src-tauri/resources/",
];
const EXCEPTION_MARKERS = [
  { id: "todo", pattern: /\bTODO\b/g },
  { id: "fixme", pattern: /\bFIXME\b/g },
  { id: "hack", pattern: /\bHACK\b/g },
  { id: "eslint-disable", pattern: /eslint-disable/g },
  { id: "typescript-suppression", pattern: /@ts-(?:ignore|nocheck|expect-error)/g },
  { id: "clippy-allow", pattern: /#\s*\[\s*allow\s*\(\s*clippy::/g },
];

export function collectCodeFiles(root) {
  const files = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(root, absolutePath));
      if (IGNORED_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !CODE_EXTENSIONS.has(path.extname(entry.name))) continue;

      const source = readFileSync(absolutePath, "utf8");
      files.push({
        path: relativePath,
        lines: countLines(source),
        source,
        test: isDedicatedTest(relativePath),
        zone: classifyZone(relativePath),
      });
    }
  }

  visit(root);
  return files;
}

export function buildSnapshot(root, policy = DEFAULT_POLICY) {
  const files = collectCodeFiles(root);
  const zones = {};
  const oversizedFiles = {};
  const exceptionMarkers = {};

  for (const file of files) {
    zones[file.zone] ??= { files: 0, lines: 0, testFiles: 0, testLines: 0 };
    zones[file.zone].files += 1;
    zones[file.zone].lines += file.lines;
    if (file.test) {
      zones[file.zone].testFiles += 1;
      zones[file.zone].testLines += file.lines;
    }

    if (file.lines > policy.maxFileLines) oversizedFiles[file.path] = file.lines;
    if (!file.test && !file.path.startsWith("scripts/quality/")) {
      const markers = countExceptionMarkers(file.source);
      if (Object.keys(markers).length > 0) exceptionMarkers[file.path] = markers;
    }
  }

  const testFiles = files.filter((file) => file.test);
  const fileSummaries = files
    .map(({ path: filePath, lines, test, zone }) => ({ path: filePath, lines, test, zone }))
    .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));
  return {
    totals: {
      files: files.length,
      lines: sum(files, "lines"),
      testFiles: testFiles.length,
      testLines: sum(testFiles, "lines"),
    },
    zones: sortObject(zones),
    oversizedFiles: sortObject(oversizedFiles),
    exceptionMarkers: sortObject(exceptionMarkers),
    largestFiles: fileSummaries.slice(0, 20),
    watchFiles: fileSummaries.filter((file) => (
      file.lines > policy.largeFileWarningLines && file.lines <= policy.maxFileLines
    )),
  };
}

export function evaluateSnapshot(current, baseline) {
  validateBaseline(baseline);
  const policy = baseline.policy;
  const previous = baseline.snapshot;
  const violations = [];
  const improvements = [];

  const lineGrowth = current.totals.lines - previous.totals.lines;
  const fileGrowth = current.totals.files - previous.totals.files;
  if (lineGrowth > policy.maxTotalLineGrowth) {
    violations.push({
      code: "total-line-growth",
      message: `Code grew by ${lineGrowth} lines; review window is ${policy.maxTotalLineGrowth}.`,
    });
  }
  if (fileGrowth > policy.maxFileGrowth) {
    violations.push({
      code: "file-count-growth",
      message: `Code file count grew by ${fileGrowth}; review window is ${policy.maxFileGrowth}.`,
    });
  }

  for (const [filePath, lines] of Object.entries(current.oversizedFiles)) {
    const previousLines = previous.oversizedFiles[filePath];
    if (previousLines === undefined) {
      violations.push({
        code: "new-oversized-file",
        path: filePath,
        message: `New oversized file has ${lines} lines; limit is ${policy.maxFileLines}.`,
      });
      continue;
    }
    if (lines > previousLines + policy.allowedOversizedFileGrowth) {
      violations.push({
        code: "oversized-file-grew",
        path: filePath,
        message: `Oversized file grew from ${previousLines} to ${lines} lines.`,
      });
    } else if (lines < previousLines) {
      improvements.push({ path: filePath, message: `Oversized file shrank by ${previousLines - lines} lines.` });
    }
  }
  for (const [filePath, previousLines] of Object.entries(previous.oversizedFiles)) {
    if (current.oversizedFiles[filePath] === undefined) {
      improvements.push({ path: filePath, message: `File is no longer above ${policy.maxFileLines} lines (was ${previousLines}).` });
    }
  }

  for (const [filePath, markers] of Object.entries(current.exceptionMarkers)) {
    const previousMarkers = previous.exceptionMarkers[filePath] ?? {};
    for (const [marker, count] of Object.entries(markers)) {
      const previousCount = previousMarkers[marker] ?? 0;
      if (count > previousCount) {
        violations.push({
          code: "exception-marker-growth",
          path: filePath,
          message: `${marker} markers grew from ${previousCount} to ${count}.`,
        });
      } else if (count < previousCount) {
        improvements.push({ path: filePath, message: `${marker} markers decreased by ${previousCount - count}.` });
      }
    }
  }
  for (const [filePath, markers] of Object.entries(previous.exceptionMarkers)) {
    const currentMarkers = current.exceptionMarkers[filePath] ?? {};
    for (const [marker, previousCount] of Object.entries(markers)) {
      if ((currentMarkers[marker] ?? 0) === 0 && previousCount > 0) {
        improvements.push({ path: filePath, message: `Removed all ${marker} markers (${previousCount}).` });
      }
    }
  }

  const warnings = (current.watchFiles ?? current.largestFiles)
    .map((file) => ({
      path: file.path,
      message: `${file.lines} lines; watch threshold is ${policy.largeFileWarningLines}.`,
    }));

  return {
    status: violations.length === 0 ? "PASS" : "FAIL",
    changes: { files: fileGrowth, lines: lineGrowth },
    violations,
    improvements: deduplicate(improvements),
    warnings,
    zoneChanges: compareZones(current.zones, previous.zones),
  };
}

export function createBaseline(snapshot, policy = DEFAULT_POLICY, capturedAt = new Date().toISOString()) {
  return {
    version: 1,
    capturedAt,
    policy: { ...policy },
    snapshot,
  };
}

export function renderMarkdownReport(current, baseline, evaluation) {
  const lines = [
    "# GitTributary code quality baseline",
    "",
    `> Status: **${evaluation.status}**`,
    `> Baseline: ${baseline.capturedAt}`,
    `> Current: ${current.totals.files} files / ${current.totals.lines} lines`,
    `> Delta: ${signed(evaluation.changes.files)} files / ${signed(evaluation.changes.lines)} lines`,
    "",
    "## Quality gates",
    "",
    `- New files must not exceed ${baseline.policy.maxFileLines} lines.`,
    "- Existing oversized files must not grow.",
    `- Baseline review is required after ${baseline.policy.maxTotalLineGrowth} added lines or ${baseline.policy.maxFileGrowth} added files.`,
    "- Exception markers such as TODO, lint suppressions, and clippy allows must not increase.",
    "",
    "## Violations",
    "",
  ];
  lines.push(...renderItems(evaluation.violations, "None."));
  lines.push("", "## Improvements", "");
  lines.push(...renderItems(evaluation.improvements, "None."));
  lines.push("", "## Zone changes", "", "| Zone | Files | Lines | Delta files | Delta lines |", "| --- | ---: | ---: | ---: | ---: |");
  for (const zone of evaluation.zoneChanges) {
    lines.push(`| ${zone.zone} | ${zone.files} | ${zone.lines} | ${signed(zone.fileDelta)} | ${signed(zone.lineDelta)} |`);
  }
  lines.push("", "## Largest files", "", "| File | Lines | Zone | Test |", "| --- | ---: | --- | --- |");
  for (const file of current.largestFiles) {
    lines.push(`| \`${file.path}\` | ${file.lines} | ${file.zone} | ${file.test ? "yes" : "no"} |`);
  }
  lines.push("", "## Watch list", "");
  lines.push(...renderItems(evaluation.warnings, "None."));
  return `${lines.join("\n")}\n`;
}

function countLines(source) {
  if (source.length === 0) return 0;
  const newlineCount = source.match(/\n/g)?.length ?? 0;
  return newlineCount + (source.endsWith("\n") ? 0 : 1);
}

function isDedicatedTest(filePath) {
  return filePath.startsWith("e2e/")
    || filePath.startsWith("tests/")
    || filePath.includes("/tests/")
    || filePath.includes("/test/")
    || filePath.includes(".test.")
    || filePath.includes(".spec.");
}

function classifyZone(filePath) {
  if (filePath.startsWith("src-tauri/crates/")) return "core-rust-crates";
  if (filePath.startsWith("src-tauri/")) return "tauri-application";
  if (/^plugins\/[^/]+\/frontend\//.test(filePath)) return "plugin-frontends";
  if (/^plugins\/[^/]+\/backend\//.test(filePath)) return "plugin-backends";
  if (filePath.startsWith("src/")) return "core-frontend";
  if (filePath.startsWith("packages/")) return "packages";
  if (filePath.startsWith("scripts/")) return "tooling";
  if (filePath.startsWith("e2e/") || filePath.startsWith("tests/")) return "end-to-end-tests";
  return "root-config";
}

function countExceptionMarkers(source) {
  return Object.fromEntries(EXCEPTION_MARKERS.flatMap(({ id, pattern }) => {
    const count = source.match(pattern)?.length ?? 0;
    return count > 0 ? [[id, count]] : [];
  }));
}

function compareZones(current, previous) {
  const zones = [...new Set([...Object.keys(current), ...Object.keys(previous)])].sort();
  return zones.map((zone) => ({
    zone,
    files: current[zone]?.files ?? 0,
    lines: current[zone]?.lines ?? 0,
    fileDelta: (current[zone]?.files ?? 0) - (previous[zone]?.files ?? 0),
    lineDelta: (current[zone]?.lines ?? 0) - (previous[zone]?.lines ?? 0),
  }));
}

function validateBaseline(baseline) {
  if (baseline?.version !== 1 || !baseline.policy || !baseline.snapshot) {
    throw new Error("Unsupported or invalid quality baseline");
  }
  for (const key of Object.keys(DEFAULT_POLICY)) {
    if (!Number.isFinite(baseline.policy[key]) || baseline.policy[key] < 0) {
      throw new Error(`Invalid baseline policy value: ${key}`);
    }
  }
}

function renderItems(items, empty) {
  if (items.length === 0) return [empty];
  return items.map((item) => `- ${item.path ? `\`${item.path}\`: ` : ""}${item.message}`);
}

function deduplicate(items) {
  return [...new Map(items.map((item) => [`${item.path ?? ""}:${item.message}`, item])).values()];
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function sum(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
