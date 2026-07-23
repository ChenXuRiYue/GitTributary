import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HostDriver, measureRequest } from "./host-driver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const hostPath = path.resolve(ROOT, args.host ?? "src-tauri/target/release/na-plugin-host");
const pluginPath = path.resolve(
  ROOT,
  args.plugin ?? defaultSitePluginPath(),
);
const counts = {
  cold: positiveInteger(args.cold, 20),
  warm: positiveInteger(args.warm, 200),
  payload: positiveInteger(args.payloadSamples, 50),
  plugin: positiveInteger(args.pluginSamples, 30),
};

const report = {
  schemaVersion: 1,
  suite: "noteaura-plugin-ipc",
  generatedAt: new Date().toISOString(),
  environment: environmentInfo(),
  configuration: {
    hostPath,
    pluginPath,
    counts,
    payloadBytes: [0, 1024, 64 * 1024, 1024 * 1024],
  },
  artifacts: {},
  scenarios: {},
};

report.artifacts.host = await artifactInfo(hostPath);
report.artifacts.sitePlugin = await artifactInfo(pluginPath);
report.scenarios.coldHello = await capture(() => coldHello(counts.cold));
report.scenarios.warmPing = await capture(() => warmPing(counts.warm));
report.scenarios.payloadScaling = await capture(() => payloadScaling(counts.payload));
report.scenarios.plugin = await capture(() => pluginMeasurements(counts.plugin));
report.metrics = normalizedMetrics(report);

const encoded = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) {
  const output = path.resolve(ROOT, args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, encoded);
  process.stderr.write(`Wrote IPC performance report to ${output}\n`);
} else {
  process.stdout.write(encoded);
}

const failedScenarios = Object.entries(report.scenarios)
  .filter(([, scenario]) => scenario.status !== "ok")
  .map(([name, scenario]) => `${name}:${scenario.status}`);
const missingArtifacts = Object.entries(report.artifacts)
  .filter(([, artifact]) => !artifact.exists)
  .map(([name]) => name);
if (failedScenarios.length > 0 || missingArtifacts.length > 0) {
  process.stderr.write(
    `IPC performance collection incomplete; scenarios=${failedScenarios.join(",") || "none"}; missingArtifacts=${missingArtifacts.join(",") || "none"}\n`,
  );
  process.exitCode = 1;
}

async function coldHello(sampleCount) {
  const samplesMs = [];
  const rssSamples = [];
  let hello = null;
  for (let index = 0; index < sampleCount; index += 1) {
    const driver = new HostDriver(hostPath, { cwd: ROOT });
    try {
      hello = await driver.start();
      samplesMs.push(driver.helloElapsedMs);
      rssSamples.push(await driver.rssSample());
    } finally {
      await driver.close();
    }
  }
  return {
    status: "ok",
    layer: "process",
    scope: "plugin_host",
    budgetKey: "ipc.coldHello.p95Ms",
    metric: "spawn_to_hello",
    hello,
    latency: summarize(samplesMs),
    rssBytes: summarize(
      rssSamples.filter((sample) => sample?.status === "ok").map((sample) => sample.bytes),
      "bytes",
    ),
    rssSamples,
  };
}

async function warmPing(sampleCount) {
  const driver = new HostDriver(hostPath, { cwd: ROOT });
  try {
    await driver.start();
    for (let index = 0; index < 20; index += 1) await driver.request("ping", {});
    const samplesMs = [];
    for (let index = 0; index < sampleCount; index += 1) {
      samplesMs.push((await measureRequest(driver, "ping", {})).elapsedMs);
    }
    return {
      status: "ok",
      layer: "transport",
      scope: "host_ndjson_round_trip",
      budgetKey: "ipc.warmPing.p95Ms",
      metric: "ndjson_ping_round_trip",
      latency: summarize(samplesMs),
      rssBytes: { after: await driver.rssSample() },
    };
  } finally {
    await driver.close();
  }
}

async function payloadScaling(sampleCount) {
  const driver = new HostDriver(hostPath, { cwd: ROOT, timeoutMs: 30_000 });
  try {
    await driver.start();
    const series = [];
    for (const payloadBytes of report.configuration.payloadBytes) {
      const params = payloadBytes === 0 ? {} : { padding: "x".repeat(payloadBytes) };
      for (let index = 0; index < 5; index += 1) await driver.request("ping", params);
      const samplesMs = [];
      for (let index = 0; index < sampleCount; index += 1) {
        samplesMs.push((await measureRequest(driver, "ping", params, 30_000)).elapsedMs);
      }
      const latency = summarize(samplesMs);
      series.push({
        payloadBytes,
        direction: "request_only",
        latency,
        throughputMiBPerSecondAtP50: payloadBytes === 0
          ? null
          : (payloadBytes / 1024 / 1024) / (latency.p50Ms / 1000),
      });
    }
    return {
      status: "ok",
      layer: "transport",
      scope: "host_ndjson_request_scaling",
      budgetKey: "ipc.payloadScaling.p95Ms",
      metric: "ping_with_request_payload",
      note: "The ping response is fixed-size; this measures request serialization, pipe transfer and parsing scaling.",
      series,
      rssBytes: { after: await driver.rssSample() },
    };
  } finally {
    await driver.close();
  }
}

async function pluginMeasurements(sampleCount) {
  const plugin = await artifactInfo(pluginPath);
  if (!plugin.exists) {
    return {
      status: "skipped",
      layer: "plugin_runtime",
      scope: "site_publisher",
      budgetKey: "ipc.plugin.loadAndInvoke.p95Ms",
      reason: "site plugin release library does not exist",
    };
  }
  const fixture = await mkdtemp(path.join(tmpdir(), "na-ipc-perf-"));
  await writeFile(path.join(fixture, "README.md"), "# IPC benchmark\n");
  const driver = new HostDriver(hostPath, { cwd: ROOT, timeoutMs: 30_000 });
  try {
    const coldLoadSamplesMs = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const coldDriver = new HostDriver(hostPath, { cwd: ROOT, timeoutMs: 30_000 });
      try {
        await coldDriver.start();
        coldLoadSamplesMs.push(
          (await measureRequest(coldDriver, "load_plugin", { path: pluginPath })).elapsedMs,
        );
      } finally {
        await coldDriver.close();
      }
    }
    await driver.start();
    const rssBeforeLoad = await driver.rssSample();
    const loadSamplesMs = [];
    const invokeSamplesMs = [];
    const loadInvokeSamplesMs = [];

    for (let index = 0; index < sampleCount; index += 1) {
      loadSamplesMs.push((await measureRequest(driver, "load_plugin", { path: pluginPath })).elapsedMs);
      await driver.request("unload_plugin", {});
    }
    await driver.request("load_plugin", { path: pluginPath });
    const rssAfterLoad = await driver.rssSample();
    for (let index = 0; index < 5; index += 1) {
      await driver.request("invoke", {
        method: "site.scan",
        payload: { repoPath: fixture },
      }, 30_000);
    }
    for (let index = 0; index < sampleCount; index += 1) {
      invokeSamplesMs.push((await measureRequest(driver, "invoke", {
        method: "site.scan",
        payload: { repoPath: fixture },
      }, 30_000)).elapsedMs);
    }
    for (let index = 0; index < sampleCount; index += 1) {
      const started = process.hrtime.bigint();
      await driver.request("load_plugin", { path: pluginPath }, 30_000);
      await driver.request("invoke", {
        method: "site.scan",
        payload: { repoPath: fixture },
      }, 30_000);
      loadInvokeSamplesMs.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    }
    return {
      status: "ok",
      layer: "plugin_runtime",
      scope: "site_publisher_small_scan_fixture",
      budgetKey: "ipc.plugin.loadAndInvoke.p95Ms",
      pluginPath,
      loadLatency: summarize(coldLoadSamplesMs),
      warmLoadLatency: summarize(loadSamplesMs),
      warmInvokeLatency: summarize(invokeSamplesMs),
      loadAndInvokeLatency: summarize(loadInvokeSamplesMs),
      rssBytes: {
        beforeLoad: rssBeforeLoad,
        afterLoad: rssAfterLoad,
        afterMeasurements: await driver.rssSample(),
      },
    };
  } finally {
    await driver.close();
    await rm(fixture, { recursive: true, force: true });
  }
}

async function capture(operation) {
  try {
    return await operation();
  } catch (error) {
    return {
      status: "error",
      error: {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        code: error?.code ?? null,
        stack: error?.stack ?? null,
      },
    };
  }
}

function summarize(values, unit = "ms") {
  const samples = values.filter(Number.isFinite);
  const suffix = unit === "bytes" ? "Bytes" : "Ms";
  if (samples.length === 0) return { sampleCount: 0, [`samples${suffix}`]: [] };
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  return {
    sampleCount: sorted.length,
    [`min${suffix}`]: sorted[0],
    [`mean${suffix}`]: mean,
    [`p50${suffix}`]: percentile(sorted, 0.50),
    [`p95${suffix}`]: percentile(sorted, 0.95),
    [`p99${suffix}`]: percentile(sorted, 0.99),
    [`max${suffix}`]: sorted.at(-1),
    [`samples${suffix}`]: values,
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

async function artifactInfo(filePath) {
  try {
    const details = await stat(filePath);
    return { path: filePath, exists: details.isFile(), bytes: details.size };
  } catch (error) {
    if (error?.code === "ENOENT") return { path: filePath, exists: false, bytes: null };
    throw error;
  }
}

function environmentInfo() {
  const gitStatus = commandVersion("git", ["status", "--porcelain"]);
  const cpu = cpus()[0]?.model ?? commandVersion("uname", ["-m"]);
  return {
    os: process.platform,
    platform: process.platform,
    arch: process.arch,
    release: process.release,
    nodeVersion: process.version,
    rustcVersion: commandVersion("rustc", ["--version"]),
    osVersion: commandVersion("uname", ["-srv"]),
    cpu,
    gitCommit: commandVersion("git", ["rev-parse", "HEAD"]),
    gitDirty: gitStatus === null ? null : gitStatus.length > 0,
    buildProfile: "release",
    buildMode: "release",
    fixtureVersion: "ipc-v1",
    ipcFixtureVersion: "ipc-v1",
    gitFixtureVersion: "git-fixtures-v1",
    attachmentFixtureVersion: "attachment-links-v1",
    budgetVersion: "2026.07.2",
    runnerClass: process.env.NA_PERF_RUNNER_CLASS
      ?? process.env.RUNNER_ENVIRONMENT
      ?? (process.env.CI ? "ci-unspecified" : "local"),
    ci: Boolean(process.env.CI),
  };
}

function normalizedMetrics(result) {
  const metrics = [];
  const cold = result.scenarios.coldHello;
  const ping = result.scenarios.warmPing;
  const payload = result.scenarios.payloadScaling;
  const plugin = result.scenarios.plugin;

  if (cold.status === "ok") {
    metrics.push(latencyMetric({
      id: "desktop.host.cold_ready",
      name: "Plugin Host cold ready",
      framework: "DESKTOP",
      budgetId: "desktop.host.cold_ready",
      summary: cold.latency,
    }));
    metrics.push(valueMetric({
      id: "observed.host.rss_after_hello",
      name: "Plugin Host RSS after hello",
      framework: "USE",
      value: cold.rssBytes.p95Bytes ?? null,
      unit: "bytes",
    }));
  }
  if (ping.status === "ok") {
    metrics.push(latencyMetric({
      id: "red.ipc.stdio",
      name: "Plugin Host stdio round trip",
      framework: "RED",
      budgetId: "red.ipc.stdio",
      summary: ping.latency,
    }));
  }
  if (payload.status === "ok") {
    for (const point of payload.series) {
      metrics.push(latencyMetric({
        id: `observed.ipc.request_payload_${point.payloadBytes}`,
        name: `IPC request payload ${point.payloadBytes} bytes`,
        framework: "RED",
        summary: point.latency,
      }));
    }
    metrics.push({
      id: "observed.ipc.payload_scaling",
      name: "IPC request payload scaling (p95)",
      framework: "RED",
      unit: "ms",
      statistic: "p95",
      statistics: statisticsOf(payload.series.at(-1).latency),
      samples: payload.series.at(-1).latency.samplesMs,
      series: payload.series.map((point) => ({
        x: point.payloadBytes,
        y: point.latency.p95Ms,
        payloadBytes: point.payloadBytes,
        p95Ms: point.latency.p95Ms,
      })),
    });
  }
  if (plugin.status === "ok") {
    metrics.push(latencyMetric({
      id: "desktop.plugin.library_load",
      name: "Site plugin library load in fresh host",
      framework: "DESKTOP",
      budgetId: "desktop.plugin.library_load",
      summary: plugin.loadLatency,
    }));
    metrics.push(latencyMetric({
      id: "observed.plugin.warm_invoke",
      name: "Site plugin warm invoke (small scan fixture)",
      framework: "RED",
      summary: plugin.warmInvokeLatency,
    }));
    metrics.push(latencyMetric({
      id: "observed.plugin.load_and_invoke",
      name: "Plugin Host load and site scan invoke",
      framework: "RED",
      summary: plugin.loadAndInvokeLatency,
      stages: [
        { name: "warm library load", durationMs: plugin.warmLoadLatency.p50Ms },
        { name: "plugin invoke", durationMs: plugin.warmInvokeLatency.p50Ms },
      ],
    }));
    metrics.push(valueMetric({
      id: "observed.plugin.rss_after_load",
      name: "Plugin Host RSS after site plugin load",
      framework: "USE",
      value: plugin.rssBytes.afterLoad?.bytes ?? null,
      unit: "bytes",
    }));
  }
  for (const [name, artifact] of Object.entries(result.artifacts)) {
    metrics.push(valueMetric({
      id: `observed.artifact.${name}.size`,
      name: `${name} artifact size`,
      framework: "DESKTOP",
      value: artifact.bytes,
      unit: "bytes",
    }));
  }
  return metrics;
}

function latencyMetric({ id, name, framework, budgetId, summary, stages }) {
  return {
    id,
    name,
    framework,
    ...(budgetId ? { budgetId } : {}),
    unit: "ms",
    statistic: "p95",
    statistics: statisticsOf(summary),
    samples: summary.samplesMs,
    ...(stages ? { stages } : {}),
  };
}

function statisticsOf(summary) {
  return {
    min: summary.minMs,
    p50: summary.p50Ms,
    p95: summary.p95Ms,
    p99: summary.p99Ms,
    max: summary.maxMs,
  };
}

function valueMetric({ id, name, framework, value, unit }) {
  return { id, name, framework, value, unit, statistic: "value", samples: [] };
}

function commandVersion(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function defaultSitePluginPath() {
  const library = process.platform === "win32"
    ? "site_publisher_plugin.dll"
    : process.platform === "darwin"
      ? "libsite_publisher_plugin.dylib"
      : "libsite_publisher_plugin.so";
  return `plugins/site-publisher/backend/target/release/${library}`;
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`expected a positive integer, got ${value}`);
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}
