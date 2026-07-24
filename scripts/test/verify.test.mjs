import assert from "node:assert/strict";
import test from "node:test";

import { runVerification, VERIFY_STEPS } from "../verify.mjs";

function memoryStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    read() { return value; },
  };
}

test("verification entrypoint covers every local acceptance stage", () => {
  assert.deepEqual(
    VERIFY_STEPS.map((step) => step.script),
    [
      "quality:full",
      "test:report:self",
      "plugin:host:prepare",
      "plugin:bundle:prepare",
      "build",
      "test:all",
    ],
  );
});

test("verification stops at the first failed stage and reports its id", () => {
  const calls = [];
  const stdout = memoryStream();
  const stderr = memoryStream();
  const status = runVerification({
    steps: VERIFY_STEPS.slice(0, 3),
    spawn(command, args) {
      calls.push([command, ...args]);
      return { status: calls.length === 2 ? 7 : 0 };
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    platform: "linux",
  });

  assert.equal(status, 7);
  assert.deepEqual(calls, [
    ["npm", "run", "quality:full"],
    ["npm", "run", "test:report:self"],
  ]);
  assert.match(stderr.read(), /report-self-test failed with exit code 7/);
  assert.doesNotMatch(stdout.read(), /Plugin host preparation/);
});

test("verification reports success after all stages pass", () => {
  const stdout = memoryStream();
  const status = runVerification({
    steps: VERIFY_STEPS.slice(0, 2),
    spawn() { return { status: 0 }; },
    stdout: stdout.stream,
    stderr: memoryStream().stream,
    platform: "win32",
  });

  assert.equal(status, 0);
  assert.match(stdout.read(), /PASS: 2\/2 stages completed/);
});
