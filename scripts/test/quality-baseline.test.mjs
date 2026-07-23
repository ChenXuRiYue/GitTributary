import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POLICY,
  createBaseline,
  evaluateSnapshot,
  isDedicatedTest,
} from "../quality/quality-lib.mjs";

const policy = DEFAULT_POLICY;

test("quality baseline rejects new and growing oversized files", () => {
  const baseline = createBaseline(snapshot({
    lines: 1000,
    files: 10,
    oversizedFiles: { "src/legacy.ts": 600 },
  }), policy, "2026-07-22T00:00:00.000Z");
  const current = snapshot({
    lines: 1200,
    files: 12,
    oversizedFiles: { "src/legacy.ts": 601, "src/new.ts": 700 },
  });

  const evaluation = evaluateSnapshot(current, baseline);
  assert.equal(evaluation.status, "FAIL");
  assert.deepEqual(evaluation.violations.map((item) => item.code), [
    "oversized-file-grew",
    "new-oversized-file",
  ]);
});

test("quality baseline reports total growth without gating it", () => {
  const baseline = createBaseline(snapshot({
    lines: 1000,
    files: 10,
  }), policy, "2026-07-22T00:00:00.000Z");
  const current = snapshot({
    lines: 101000,
    files: 1010,
  });

  const evaluation = evaluateSnapshot(current, baseline);
  assert.equal(evaluation.status, "PASS");
  assert.deepEqual(evaluation.changes, { lines: 100000, files: 1000 });
  assert.deepEqual(evaluation.violations, []);
});

test("quality baseline still rejects exception-marker growth", () => {
  const baseline = createBaseline(snapshot({
    lines: 1000,
    files: 10,
    exceptionMarkers: { "src/legacy.ts": { todo: 1 } },
  }), policy, "2026-07-22T00:00:00.000Z");
  const current = snapshot({
    lines: 101000,
    files: 1010,
    exceptionMarkers: { "src/legacy.ts": { todo: 2 } },
  });

  const evaluation = evaluateSnapshot(current, baseline);
  assert.equal(evaluation.status, "FAIL");
  assert.deepEqual(evaluation.violations.map((item) => item.code), ["exception-marker-growth"]);
});

test("quality baseline records debt reduction without forcing a baseline update", () => {
  const baseline = createBaseline(snapshot({
    lines: 1000,
    files: 10,
    oversizedFiles: { "src/legacy.ts": 600 },
    exceptionMarkers: { "src/legacy.ts": { todo: 2 } },
  }), policy, "2026-07-22T00:00:00.000Z");
  const current = snapshot({
    lines: 900,
    files: 10,
    oversizedFiles: { "src/legacy.ts": 550 },
    exceptionMarkers: { "src/legacy.ts": { todo: 1 } },
  });

  const evaluation = evaluateSnapshot(current, baseline);
  assert.equal(evaluation.status, "PASS");
  assert.ok(evaluation.improvements.some((item) => item.message.includes("shrank by 50")));
  assert.ok(evaluation.improvements.some((item) => item.message.includes("decreased by 1")));
});

test("quality baseline recognizes extracted Rust test modules", () => {
  assert.equal(isDedicatedTest("src/application/plugins/host/tests.rs"), true);
  assert.equal(isDedicatedTest("src/application/plugins/host/runtime.rs"), false);
});

function snapshot({ lines, files, oversizedFiles = {}, exceptionMarkers = {} }) {
  return {
    totals: { files, lines, testFiles: 0, testLines: 0 },
    zones: { sample: { files, lines, testFiles: 0, testLines: 0 } },
    oversizedFiles,
    exceptionMarkers,
    largestFiles: Object.entries(oversizedFiles).map(([path, fileLines]) => ({
      path,
      lines: fileLines,
      test: false,
      zone: "sample",
    })),
  };
}
