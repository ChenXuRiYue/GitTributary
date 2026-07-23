import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("runner rejects an empty fine-grained selection and still writes reports", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "noteaura-report-test-"));
  const output = path.join(directory, "report");
  try {
    const result = spawnSync(process.execPath, [
      "scripts/test/run-report.mjs",
      "--only", "types",
      "--skip", "types",
      "--output", output,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(readFileSync(path.join(output, "report.md"), "utf8"), /No test suites selected/);
    assert.match(readFileSync(path.join(output, "report.html"), "utf8"), /INFRA_ERROR/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
