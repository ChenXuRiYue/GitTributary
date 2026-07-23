import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

const VALID_PROFILES = new Set(["quick", "standard", "full", "ci"]);
const VALID_RUST_RUNNERS = new Set(["auto", "nextest", "cargo"]);
const FAILURE_STATUSES = new Set(["FAIL", "ERROR", "INFRA_ERROR"]);

export function parseArgs(argv) {
  const args = {
    profile: "quick",
    only: [],
    skip: [],
    coverage: false,
    output: "test-reports/latest",
    mergeDir: null,
    rustRunner: "auto",
    expect: [],
    jobStatuses: {},
    externalStatuses: {},
    help: false,
    list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [name, inlineValue] = splitOption(raw);
    const value = () => inlineValue ?? requireValue(argv, ++index, name);

    if (name === "--profile" || name === "-p") args.profile = value();
    else if (name === "--only") args.only.push(...csv(value()));
    else if (name === "--skip") args.skip.push(...csv(value()));
    else if (name === "--coverage") args.coverage = true;
    else if (name === "--no-coverage") args.coverage = false;
    else if (name === "--output" || name === "-o") args.output = value();
    else if (name === "--merge-dir") args.mergeDir = value();
    else if (name === "--rust-runner") args.rustRunner = value();
    else if (name === "--expect") args.expect.push(...csv(value()));
    else if (name === "--job-status") Object.assign(args.jobStatuses, parseMappings(value(), name));
    else if (name === "--external-status") Object.assign(args.externalStatuses, parseMappings(value(), name));
    else if (name === "--help" || name === "-h") args.help = true;
    else if (name === "--list") args.list = true;
    else throw new Error(`Unknown argument: ${raw}`);
  }

  if (!VALID_PROFILES.has(args.profile)) {
    throw new Error(`Invalid --profile: ${args.profile} (expected quick, standard, full, or ci)`);
  }
  if (!VALID_RUST_RUNNERS.has(args.rustRunner)) {
    throw new Error(`Invalid --rust-runner: ${args.rustRunner} (expected auto, nextest, or cargo)`);
  }
  args.only = unique(args.only);
  args.skip = unique(args.skip);
  args.expect = unique(args.expect);
  return args;
}

export function buildRustCommandArgs({ runner, manifest, extraArgs = [], profile = "quick", configFile }) {
  if (runner === "cargo") {
    return ["test", "--manifest-path", manifest, ...extraArgs];
  }
  if (runner !== "nextest") {
    throw new Error(`Unsupported Rust runner: ${runner}`);
  }
  if (!configFile) {
    throw new Error("A shared Nextest config file is required");
  }

  const args = [
    "nextest", "run",
    "--manifest-path", manifest,
    ...extraArgs,
    "--config-file", configFile,
  ];
  if (profile === "ci") args.push("--profile", "ci");
  return args;
}

export function usage() {
  return `Usage: node scripts/test/run-report.mjs [options]

Options:
  -p, --profile <quick|standard|full|ci> Select a predefined suite set (default: quick)
      --only <suite,...>          Run only named suites; repeatable
      --skip <suite,...>          Exclude named suites; repeatable
      --coverage                  Enable frontend coverage
      --no-coverage               Disable frontend coverage
  -o, --output <directory>        Report directory (default: test-reports/latest)
      --merge-dir <directory>     Merge CI report fragments without running tests
      --expect <suite,...>        Suites expected when merging CI fragments
      --job-status <id=status,...> Record upstream CI job status; repeatable
      --external-status <id=status,...> Add an external CI check to the report
      --rust-runner <auto|nextest|cargo> Select the Rust runner (default: auto)
      --list                      List suites and profiles
  -h, --help                      Show this help
`;
}

export function validateOutputPath(candidate, allowedRoots) {
  const resolved = path.resolve(candidate);
  const allowed = allowedRoots.map((root) => path.resolve(root));
  const matchedRoot = allowed.find((root) => isStrictChild(resolved, root));
  if (!matchedRoot) {
    throw new Error(`Unsafe --output path: ${resolved}. Use test-reports/<name> or a system temporary directory.`);
  }
  let current = matchedRoot;
  for (const segment of path.relative(matchedRoot, resolved).split(path.sep)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Unsafe --output path: symbolic link component ${current}`);
    }
  }
  return resolved;
}

export function parseVitestResult(input) {
  const result = json(input, "Vitest result");
  const assertions = (result.testResults ?? []).flatMap((suite) => suite.assertionResults ?? []);
  const fallback = countStatuses(assertions.map((test) => test.status));
  const counts = {
    total: numberOr(result.numTotalTests, fallback.total),
    passed: numberOr(result.numPassedTests, fallback.passed),
    failed: numberOr(result.numFailedTests, fallback.failed),
    skipped: numberOr(result.numPendingTests, fallback.skipped),
  };
  const durationMs = sum((result.testResults ?? []).map((suite) => suite.endTime != null && suite.startTime != null
    ? suite.endTime - suite.startTime
    : suite.perfStats?.runtime));
  return parsedSuite("frontend", "Frontend unit/property tests", counts, {
    status: result.success === false || counts.failed > 0 ? "FAIL" : counts.total > 0 ? "PASS" : "NOT_RUN",
    durationMs,
    details: {
      testFiles: result.numTotalTestSuites ?? result.testResults?.length ?? 0,
      failedFiles: result.numFailedTestSuites ?? 0,
    },
  });
}

export function parsePlaywrightResult(input) {
  const result = json(input, "Playwright result");
  const tests = collectPlaywrightTests(result.suites ?? []);
  const fallback = countStatuses(tests.map(playwrightStatus));
  const stats = result.stats ?? {};
  const counts = {
    total: numberOr(stats.expected, 0) + numberOr(stats.unexpected, 0)
      + numberOr(stats.flaky, 0) + numberOr(stats.skipped, 0) || fallback.total,
    passed: numberOr(stats.expected, fallback.passed) + numberOr(stats.flaky, 0),
    failed: numberOr(stats.unexpected, fallback.failed),
    skipped: numberOr(stats.skipped, fallback.skipped),
  };
  return parsedSuite("e2e", "Playwright user journeys", counts, {
    status: counts.failed > 0 ? "FAIL" : counts.total > 0 ? "PASS" : "NOT_RUN",
    durationMs: finite(stats.duration) ?? sum(tests.flatMap((test) => test.results ?? []).map((item) => item.duration)),
    details: {
      projects: unique(tests.map((test) => test.projectName).filter(Boolean)),
      flaky: numberOr(stats.flaky, 0),
    },
  });
}

export function parseRustOutput(text) {
  const output = stripAnsi(text);
  const ignoredTests = [...output.matchAll(/^test\s+(.+?)\s+\.\.\.\s+ignored(?:,\s*(.+))?$/gim)].map((match) => ({ name: match[1], reason: match[2]?.trim() || "未提供原因" }));
  const nextest = [...output.matchAll(/Summary\s+\[[^\]]+\]\s+(\d+)\s+tests? run:\s+(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?/gi)];
  let counts;
  let durationMs = 0;
  if (nextest.length > 0) {
    const match = nextest.at(-1);
    const discovered = Number(match[2]) + Number(match[3] ?? 0) + Number(match[4] ?? 0);
    counts = countsOf(Math.max(Number(match[1]), discovered), match[2], match[3], match[4]);
    const seconds = /Summary\s+\[\s*([\d.]+)s\]/i.exec(match[0]);
    durationMs = seconds ? Number(seconds[1]) * 1000 : 0;
  } else {
    const cargo = [...output.matchAll(/test result:\s+(ok|FAILED)\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored;\s+(\d+) measured;\s+(\d+) filtered out;\s+finished in ([\d.]+)s/gi)];
    counts = cargo.reduce((total, match) => addCounts(total, countsOf(
      Number(match[2]) + Number(match[3]) + Number(match[4]), match[2], match[3], match[4],
    )), emptyCounts());
    durationMs = sum(cargo.map((match) => Number(match[7]) * 1000));
  }

  const infrastructureFailure = /(^|\n)(error: (could not compile|failed to|no such command)|Caused by:|process didn't exit successfully)/i.test(output)
    && counts.total === 0;
  const delegatedTests = ignoredTests.filter((test) => /run through|performance fixture/i.test(test.reason));
  const delegatedCount = Math.min(counts.skipped, delegatedTests.length);
  counts = countsOf(counts.total - delegatedCount, counts.passed, counts.failed, counts.skipped - delegatedCount);
  const status = infrastructureFailure ? "INFRA_ERROR"
    : counts.failed > 0 || /test result:\s+FAILED/i.test(output) ? "FAIL"
      : counts.total > 0 ? "PASS" : "NOT_RUN";
  return parsedSuite("rust", "Rust tests", counts, {
    status,
    durationMs,
    details: { runner: nextest.length > 0 ? "nextest" : "cargo", summaries: nextest.length || undefined, ignoredTests: ignoredTests.filter((test) => !delegatedTests.includes(test)), delegatedTests },
  });
}

function stripAnsi(text) {
  return String(text ?? "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function parsePerformanceResult(input) {
  const result = json(input, "Performance result");
  const gates = normalizeGates(result.gates ?? []);
  const explicitMetrics = (result.metrics ?? []).filter((metric) =>
    metric.error || metric.pass != null || metric.status != null || metric.outcome != null);
  const outcomes = [
    ...gates.map((gate) => gate.pass ? "passed" : "failed"),
    ...explicitMetrics.map((metric) => metricPass(metric) ? "passed" : "failed"),
  ];
  const counts = countStatuses(outcomes);
  const infrastructureFailure = Boolean(result.collectionError);
  return parsedSuite("performance", "Performance gates", counts, {
    status: infrastructureFailure ? "INFRA_ERROR"
      : counts.failed > 0 ? "FAIL" : counts.total > 0 ? "PASS" : "NOT_RUN",
    durationMs: sum(gates.map((gate) => gate.durationMs)),
    details: {
      metricCount: result.metrics?.length ?? 0,
      collectionError: result.collectionError ?? null,
      generatedAt: result.generatedAt ?? null,
    },
  });
}

export function applyPerformanceVerdict(suite, markdown) {
  const text = String(markdown ?? "");
  const verdict = /结论:\s*\*\*(PASS|FAIL|INCOMPLETE)\*\*/i.exec(text)?.[1]?.toUpperCase();
  if (!verdict) return suite;
  const metrics = /(\d+)\/(\d+)\s*项指标通过/.exec(text);
  const gates = /(\d+)\/(\d+)\s*项门禁通过/.exec(text);
  const missing = /(\d+)\s*项未采集/.exec(text);
  if (!metrics && !gates) return { ...suite, status: verdict };
  const passed = Number(metrics?.[1] ?? 0) + Number(gates?.[1] ?? 0);
  const assessed = Number(metrics?.[2] ?? 0) + Number(gates?.[2] ?? 0);
  const missingBudgets = Number(missing?.[1] ?? 0);
  return {
    ...suite,
    status: verdict === "INCOMPLETE" ? "PASS" : verdict,
    counts: { total: assessed, passed, failed: Math.max(0, assessed - passed), skipped: 0 },
    details: { ...suite.details, modelStatus: verdict, missingBudgets, countInSummary: false },
  };
}

export function buildReport({ profile = "quick", selection = {}, suites = [], startedAt, finishedAt, expect, jobStatuses } = {}) {
  const selected = normalizeSelection(selection, expect, jobStatuses);
  const byId = new Map(suites.map((suite) => [suite.id, normalizeSuite(suite)]));
  for (const id of selected.expect) {
    if (byId.has(id)) continue;
    const jobStatus = selected.jobStatuses[id];
    const infra = jobStatus && !["success", "skipped", "neutral"].includes(jobStatus.toLowerCase());
    byId.set(id, normalizeSuite({
      id,
      label: id,
      status: infra ? "INFRA_ERROR" : "NOT_RUN",
      details: { reason: infra ? `CI job ended with status: ${jobStatus}` : "Expected report fragment was not found" },
    }));
  }

  const normalizedSuites = [...byId.values()];
  const counts = normalizedSuites.filter((suite) => suite.details.countInSummary !== false).reduce((total, suite) => addCounts(total, suite.counts), emptyCounts());
  const start = iso(startedAt);
  const finish = iso(finishedAt);
  const status = normalizedSuites.some((suite) => FAILURE_STATUSES.has(suite.status)) ? "FAIL"
    : normalizedSuites.some((suite) => ["NOT_RUN", "INCOMPLETE"].includes(suite.status)) ? "INCOMPLETE"
      : normalizedSuites.length > 0 ? "PASS" : "INCOMPLETE";
  return {
    schemaVersion: 1,
    suite: "noteaura-tests",
    profile,
    selection: selected,
    startedAt: start,
    finishedAt: finish,
    durationMs: start && finish ? Math.max(0, Date.parse(finish) - Date.parse(start)) : sum(normalizedSuites.map((suite) => suite.durationMs)),
    status,
    counts,
    suites: normalizedSuites,
  };
}

export function renderMarkdown(report) {
  const rows = report.suites.map((suite) => `| ${md(suite.label)} | ${suite.status} | ${suite.counts.total} | ${suite.counts.passed} | ${suite.counts.failed} | ${suite.counts.skipped} | ${formatDuration(suite.durationMs)} | ${markdownLinks(suite)} |`).join("\n");
  const failures = report.suites.filter((suite) => suite.status !== "PASS");
  const ignored = ignoredTestsOf(report), delegated = delegatedTestsOf(report), missingBudgets = sum(report.suites.map((suite) => suite.details?.missingBudgets));
  const ignoredSection = ignored.length ? `\n## 有意忽略的用例\n\n${ignored.map((test) => `- \`${md(test.name)}\`：${md(test.reason)}（${md(test.suite)}）`).join("\n")}\n` : "";
  const delegatedSection = delegated.length ? `\n## 委托专项门禁\n\n${delegated.map((test) => `- \`${md(test.name)}\`：${md(test.reason)}（${md(test.suite)}）`).join("\n")}\n` : "";
  const performanceNote = missingBudgets > 0 ? `  \n> 性能模型: ${missingBudgets} 项尚未自动采集，不计入测试用例或跳过数。` : "";
  const coverage = report.suites.filter((suite) => suite.details?.coverage).map((suite) => `| ${md(suite.label)} | ${percent(suite.details.coverage.statements)} | ${percent(suite.details.coverage.branches)} | ${percent(suite.details.coverage.functions)} | ${percent(suite.details.coverage.lines)} |`).join("\n");
  const coverageSection = coverage ? `\n## 覆盖率\n\n| 套件 | Statements | Branches | Functions | Lines |\n| --- | ---: | ---: | ---: | ---: |\n${coverage}\n` : "";
  return `# NoteAura 测试报告\n\n> 结论: **${report.status}**  \n> Profile: \`${md(report.profile)}\`  \n> 用例: ${report.counts.passed}/${report.counts.total} 通过，${report.counts.failed} 失败，${report.counts.skipped} 跳过/忽略  \n> 耗时: ${formatDuration(report.durationMs)}${performanceNote}\n\n## 测试套件\n\n| 套件 | 状态 | 总数 | 通过 | 失败 | 跳过/忽略 | 耗时 | 日志 |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |\n${rows || "| - | NOT_RUN | 0 | 0 | 0 | 0 | 0 ms | - |"}\n${ignoredSection}${delegatedSection}${coverageSection}\n## 异常与未运行\n\n${failures.length ? failures.map((suite) => `- **${md(suite.label)}**: ${suite.status}${suite.details?.reason ? ` - ${md(suite.details.reason)}` : ""}`).join("\n") : "无。"}\n`;
}

export function renderHtml(report) {
  const rows = report.suites.map((suite) => `<tr><td><strong>${html(suite.label)}</strong><small>${html(suite.id)}</small></td><td><span class="badge ${statusClass(suite.status)}">${html(suite.status)}</span></td><td>${suite.counts.total}</td><td>${suite.counts.passed}</td><td>${suite.counts.failed}</td><td>${suite.counts.skipped}</td><td>${html(formatDuration(suite.durationMs))}</td><td>${htmlLinks(suite)}</td></tr>`).join("");
  const coverageRows = report.suites.filter((suite) => suite.details?.coverage).map((suite) => `<tr><td>${html(suite.label)}</td><td>${percent(suite.details.coverage.statements)}</td><td>${percent(suite.details.coverage.branches)}</td><td>${percent(suite.details.coverage.functions)}</td><td>${percent(suite.details.coverage.lines)}</td></tr>`).join("");
  const coverageSection = coverageRows ? `<h2>覆盖率</h2><div class="table-wrap"><table><thead><tr><th>套件</th><th>Statements</th><th>Branches</th><th>Functions</th><th>Lines</th></tr></thead><tbody>${coverageRows}</tbody></table></div>` : "";
  const ignored = ignoredTestsOf(report), delegated = delegatedTestsOf(report), missingBudgets = sum(report.suites.map((suite) => suite.details?.missingBudgets));
  const transparencySection = ignored.length || delegated.length || missingBudgets ? `<h2>透明度说明</h2><ul>${[...ignored, ...delegated].map((test) => `<li><code>${html(test.name)}</code>: ${html(test.reason)} (${html(test.suite)})</li>`).join("")}${missingBudgets ? `<li>${missingBudgets} 项性能模型指标尚未自动采集，不计入测试用例或跳过数。</li>` : ""}</ul>` : "";
  const issues = report.suites.filter((suite) => suite.status !== "PASS").map((suite) => `<li><strong>${html(suite.label)}</strong>: ${html(suite.status)}${suite.details?.reason ? ` - ${html(suite.details.reason)}` : ""}</li>`).join("");
  const issueSection = issues ? `<h2>异常与未运行</h2><ul>${issues}</ul>` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NoteAura 测试报告</title><style>:root{color-scheme:light;--ink:#172033;--muted:#667085;--line:#d0d5dd;--paper:#fff;--wash:#f2f4f7;--pass:#067647;--fail:#b42318;--warn:#b54708}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1080px;min-height:100vh;margin:auto;padding:36px 42px;background:var(--paper)}h1{margin:0;font-size:30px;letter-spacing:0}h2{margin-top:28px}.meta{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0}.tile{border:1px solid var(--line);border-radius:6px;padding:12px}.tile b{display:block;font-size:22px}table{width:100%;border-collapse:collapse}th,td{padding:9px;text-align:left;border-bottom:1px solid var(--line)}th{background:var(--wash)}td small{display:block;color:var(--muted)}.badge{font-size:11px;font-weight:700;padding:2px 6px;border-radius:3px}.pass{color:var(--pass);background:#dcfae6}.fail{color:var(--fail);background:#fee4e2}.warn{color:var(--warn);background:#fef0c7}a{color:#175cd3}@media(max-width:720px){main{padding:24px 14px}.summary{grid-template-columns:1fr 1fr}.table-wrap{overflow:auto}}</style></head><body><main><h1>NoteAura 测试报告</h1><p class="meta">Profile: ${html(report.profile)} · ${html(report.startedAt ?? "时间未知")} · ${html(formatDuration(report.durationMs))}</p><div class="summary"><div class="tile">总体判定<b class="${statusClass(report.status)}">${html(report.status)}</b></div><div class="tile">总用例<b>${report.counts.total}</b></div><div class="tile">通过<b>${report.counts.passed}</b></div><div class="tile">失败<b>${report.counts.failed}</b></div></div><h2>测试套件</h2><div class="table-wrap"><table><thead><tr><th>套件</th><th>状态</th><th>总数</th><th>通过</th><th>失败</th><th>跳过/忽略</th><th>耗时</th><th>日志</th></tr></thead><tbody>${rows || '<tr><td colspan="8">没有测试结果。</td></tr>'}</tbody></table></div>${transparencySection}${coverageSection}${issueSection}</main></body></html>`;
}

function parsedSuite(id, label, counts, options) {
  return normalizeSuite({ id, label, counts, command: null, logPath: null, ...options });
}

function ignoredTestsOf(report) { return testsWithSuite(report, "ignoredTests"); }
function delegatedTestsOf(report) { return testsWithSuite(report, "delegatedTests"); }
function testsWithSuite(report, key) { return report.suites.flatMap((suite) => (suite.details?.[key] ?? []).map((test) => ({ ...test, suite: suite.label }))); }

function normalizeSuite(suite) {
  const suppliedCounts = suite.counts ?? {};
  const passed = finite(suppliedCounts.passed) ?? 0;
  const failed = finite(suppliedCounts.failed) ?? 0;
  const skipped = finite(suppliedCounts.skipped) ?? 0;
  const counts = countsOf(Math.max(finite(suppliedCounts.total) ?? 0, passed + failed + skipped), passed, failed, skipped);
  return {
    id: String(suite.id),
    label: suite.label ?? suite.id,
    status: normalizeStatus(suite.status),
    durationMs: finite(suite.durationMs) ?? 0,
    counts,
    command: suite.command ?? null,
    logPath: suite.logPath ?? null,
    details: suite.details ?? {},
  };
}

function normalizeSelection(selection, expect, jobStatuses) {
  const value = Array.isArray(selection) ? { only: selection } : selection ?? {};
  return {
    only: unique(value.only ?? []),
    skip: unique(value.skip ?? []),
    coverage: Boolean(value.coverage),
    expect: unique(expect ?? value.expect ?? []),
    jobStatuses: { ...(value.jobStatuses ?? {}), ...(jobStatuses ?? {}) },
  };
}

function normalizeStatus(status) {
  const value = String(status ?? "NOT_RUN").toUpperCase().replaceAll("-", "_");
  if (["PASS", "PASSED", "SUCCESS", "OK"].includes(value)) return "PASS";
  if (["FAIL", "FAILED", "FAILURE"].includes(value)) return "FAIL";
  if (["ERROR", "INFRA_ERROR", "TIMED_OUT", "CANCELLED"].includes(value)) return "INFRA_ERROR";
  if (["SKIP", "SKIPPED", "NOT_RUN"].includes(value)) return "NOT_RUN";
  if (value === "INCOMPLETE") return value;
  return "NOT_RUN";
}

function collectPlaywrightTests(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests ?? []),
    ...collectPlaywrightTests(suite.suites ?? []),
  ]);
}

function playwrightStatus(test) {
  const outcome = test.status ?? test.outcome;
  if (outcome) return outcome;
  const final = test.results?.at(-1)?.status;
  return final === "passed" ? "passed" : final === "skipped" ? "skipped" : "failed";
}

function countStatuses(statuses) {
  const counts = emptyCounts();
  for (const status of statuses) {
    const value = String(status ?? "").toLowerCase();
    counts.total += 1;
    if (["passed", "pass", "expected", "flaky", "ok"].includes(value)) counts.passed += 1;
    else if (["skipped", "skip", "pending", "disabled", "todo"].includes(value)) counts.skipped += 1;
    else counts.failed += 1;
  }
  return counts;
}

function normalizeGates(gates) {
  const values = Array.isArray(gates) ? gates : Object.entries(gates).map(([id, value]) => ({ id, ...(typeof value === "object" ? value : { status: value }) }));
  return values.map((gate) => ({ ...gate, pass: typeof gate.pass === "boolean" ? gate.pass : metricPass(gate) }));
}

function metricPass(value) {
  if (value.error) return false;
  if (typeof value.pass === "boolean") return value.pass;
  return ["pass", "passed", "success", "ok"].includes(String(value.status ?? value.outcome ?? "").toLowerCase());
}

function splitOption(value) {
  if (!value.startsWith("--") || !value.includes("=")) return [value, undefined];
  const index = value.indexOf("=");
  return [value.slice(0, index), value.slice(index + 1)];
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (value == null || value.startsWith("-")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseMappings(value, option) {
  return Object.fromEntries(csv(value).map((mapping) => {
    const index = mapping.indexOf("=");
    if (index <= 0 || index === mapping.length - 1) throw new Error(`Invalid ${option} mapping: ${mapping}`);
    return [mapping.slice(0, index), mapping.slice(index + 1)];
  }));
}

function csv(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(Array.isArray(values) ? values : csv(values))];
}

function json(input, label) {
  if (typeof input === "string") {
    try { return JSON.parse(input); } catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  }
  if (!input || typeof input !== "object") throw new Error(`${label} must be an object or JSON string`);
  return input;
}

function countsOf(total, passed, failed, skipped) {
  return { total: Number(total ?? 0), passed: Number(passed ?? 0), failed: Number(failed ?? 0), skipped: Number(skipped ?? 0) };
}

function emptyCounts() {
  return countsOf(0, 0, 0, 0);
}

function addCounts(left, right) {
  return countsOf(left.total + right.total, left.passed + right.passed, left.failed + right.failed, left.skipped + right.skipped);
}

function numberOr(value, fallback) {
  return finite(value) ?? fallback ?? 0;
}

function finite(value) {
  const parsed = Number(value);
  return value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

function sum(values) {
  return values.reduce((total, value) => total + (finite(value) ?? 0), 0);
}

function iso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function formatDuration(durationMs) {
  const value = finite(durationMs) ?? 0;
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s` : `${Math.round(value)} ms`;
}

function percent(value) {
  const number = finite(value);
  return number === null ? "N/A" : `${number.toFixed(2)}%`;
}

function markdownLinks(suite) {
  const links = [];
  if (suite.logPath) links.push(`[日志](${mdLink(suite.logPath)})`);
  if (suite.details?.reportPath) links.push(`[详细报告](${mdLink(suite.details.reportPath)})`);
  return links.join(" / ") || "-";
}

function htmlLinks(suite) {
  const links = [];
  if (suite.logPath) links.push(`<a href="${html(suite.logPath)}">日志</a>`);
  if (suite.details?.reportPath) links.push(`<a href="${html(suite.details.reportPath)}">详细报告</a>`);
  return links.join(" / ") || "-";
}

function statusClass(status) {
  return status === "PASS" ? "pass" : status === "FAIL" || status === "INFRA_ERROR" ? "fail" : "warn";
}

function md(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function mdLink(value) {
  return String(value).replaceAll("(", "%28").replaceAll(")", "%29").replaceAll(" ", "%20");
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function isStrictChild(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
