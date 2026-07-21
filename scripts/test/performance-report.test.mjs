import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = process.cwd();

test("baseline regressions gate budgeted metrics but keep observations informational", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "gittributary-perf-report-"));
  const output = path.join(directory, "report");
  const modelPath = path.join(directory, "model.json");
  const baselinePath = path.join(directory, "baseline.json");
  const currentPath = path.join(directory, "current.json");
  const environment = { runnerClass: "test-runner" };
  const metric = (id, value) => ({
    id,
    name: id,
    framework: "RED",
    unit: "ms",
    statistic: "p95",
    p95: value,
  });

  writeFileSync(modelPath, JSON.stringify({
    modelVersion: "test",
    frameworks: { RED: { label: "RED", color: "#000000" } },
    environmentMatch: ["runnerClass"],
    regression: {
      latencyPercent: 20,
      throughputPercent: 10,
      resourcePercent: 15,
      minimumBudgetDeltaPercent: 10,
      errorRateAbsolutePoints: 0.1,
      minimumAbsoluteDelta: { ms: 1 },
    },
    measurement: { minimumSamples: 20, referenceSamples: 30 },
    budgets: [{
      id: "gated",
      framework: "RED",
      label: "Gated latency",
      statistic: "p95",
      operator: "<=",
      value: 100,
      unit: "ms",
      regressionClass: "latency",
    }],
  }));
  writeFileSync(baselinePath, JSON.stringify({
    environment,
    metrics: [metric("observed", 10), metric("gated", 10)],
  }));

  try {
    writeFileSync(currentPath, JSON.stringify({
      environment,
      metrics: [metric("observed", 20), metric("gated", 11)],
    }));
    const observedRegression = render(modelPath, baselinePath, currentPath, output);
    assert.equal(observedRegression.status, 0);
    const observedReport = readFileSync(path.join(output, "report.md"), "utf8");
    assert.match(observedReport, /\| observed \| RED \| p95 \| 20 ms \| - \| 10 ms \| 100\.0% \| OBSERVE \|/);

    writeFileSync(currentPath, JSON.stringify({
      environment,
      metrics: [metric("observed", 20), metric("gated", 19)],
    }));
    const belowNoiseFloor = render(modelPath, baselinePath, currentPath, output);
    assert.equal(belowNoiseFloor.status, 0);
    const noiseFloorReport = readFileSync(path.join(output, "report.md"), "utf8");
    assert.match(noiseFloorReport, /\| gated \| RED \| p95 \| 19 ms \| <= 100 ms \| 10 ms \| 90\.0% \| PASS \|/);

    writeFileSync(currentPath, JSON.stringify({
      environment,
      metrics: [metric("observed", 20), metric("gated", 20)],
    }));
    const gatedRegression = render(modelPath, baselinePath, currentPath, output);
    assert.equal(gatedRegression.status, 1);
    const gatedReport = readFileSync(path.join(output, "report.md"), "utf8");
    assert.match(gatedReport, /\| gated \| RED \| p95 \| 20 ms \| <= 100 ms \| 10 ms \| 100\.0% \| FAIL \|/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function render(modelPath, baselinePath, currentPath, output) {
  return spawnSync(process.execPath, [
    "scripts/perf/render-report.mjs",
    "--input", currentPath,
    "--baseline", baselinePath,
    "--model", modelPath,
    "--output", output,
  ], { cwd: ROOT, encoding: "utf8" });
}
