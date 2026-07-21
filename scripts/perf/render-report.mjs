#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const args = { model: path.join(ROOT, "performance/model.json") };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--") && !args.input) args.input = value;
    else if (value === "--input") args.input = argv[++index];
    else if (value === "--baseline") args.baseline = argv[++index];
    else if (value === "--model") args.model = argv[++index];
    else if (value === "--output") args.output = argv[++index];
    else if (value === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function usage() {
  return `Usage: node scripts/perf/render-report.mjs --input result.json [options]\n\nOptions:\n  --baseline FILE  Compare against a result from the same environment\n  --model FILE     Performance model (default: performance/model.json)\n  --output DIR     Output directory (default: next to input)\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentile(values, fraction) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function stats(metric) {
  const samples = Array.isArray(metric.samples)
    ? metric.samples.map(Number).filter(Number.isFinite)
    : [];
  const supplied = metric.statistics ?? metric.stats ?? {};
  const values = {
    value: finite(metric.value ?? supplied.value),
    min: finite(metric.min ?? supplied.min),
    p50: finite(metric.p50 ?? supplied.p50),
    p95: finite(metric.p95 ?? supplied.p95),
    p99: finite(metric.p99 ?? supplied.p99),
    max: finite(metric.max ?? supplied.max),
  };
  if (samples.length > 0) {
    values.min ??= Math.min(...samples);
    values.p50 ??= percentile(samples, 0.5);
    values.p95 ??= percentile(samples, 0.95);
    values.p99 ??= percentile(samples, 0.99);
    values.max ??= Math.max(...samples);
    values.value ??= samples.reduce((sum, item) => sum + item, 0) / samples.length;
  }
  return { ...values, samples: samples.length };
}

function metricsOf(result) {
  const source = result.metrics ?? result.results ?? result.cases ?? [];
  if (!Array.isArray(source)) throw new Error("Result JSON must contain a metrics array");
  return source.map((metric, index) => ({
    ...metric,
    id: metric.id ?? metric.metric ?? metric.name ?? `metric-${index + 1}`,
    name: metric.name ?? metric.label ?? metric.id ?? `Metric ${index + 1}`,
  }));
}

function gatesOf(result) {
  const source = result.gates ?? [];
  const gates = Array.isArray(source)
    ? source
    : Object.entries(source).map(([id, gate]) => ({ id, ...(typeof gate === "object" ? gate : { status: gate }) }));
  return gates.map((gate, index) => {
    const status = String(gate.status ?? gate.outcome ?? "unknown").toLowerCase();
    const pass = typeof gate.pass === "boolean"
      ? gate.pass
      : ["pass", "passed", "success", "ok"].includes(status);
    return {
      ...gate,
      id: gate.id ?? gate.name ?? `gate-${index + 1}`,
      name: gate.name ?? gate.label ?? gate.id ?? `Gate ${index + 1}`,
      status,
      pass,
    };
  });
}

function metadataOf(result) {
  return result.metadata ?? result.environment ?? {};
}

function compare(operator, actual, expected) {
  if (actual === null) return null;
  if (operator === "<=") return actual <= expected;
  if (operator === "<") return actual < expected;
  if (operator === ">=") return actual >= expected;
  if (operator === ">") return actual > expected;
  if (operator === "==") return actual === expected;
  throw new Error(`Unsupported budget operator: ${operator}`);
}

function environmentComparison(model, current, baseline) {
  if (!baseline) return { comparable: false, reason: "未提供基线" };
  const currentMeta = metadataOf(current);
  const baselineMeta = metadataOf(baseline);
  const mismatches = model.environmentMatch.filter((key) => {
    const left = currentMeta[key];
    const right = baselineMeta[key];
    return left == null || right == null || left !== right;
  });
  return mismatches.length === 0
    ? { comparable: true, reason: "环境匹配" }
    : { comparable: false, reason: `环境不匹配或字段缺失: ${mismatches.join(", ")}` };
}

function regressionLimit(model, budget, unit) {
  const type = budget?.regressionClass ?? "latency";
  const percent = type === "throughput"
    ? model.regression.throughputPercent
    : type === "resource"
      ? model.regression.resourcePercent
      : model.regression.latencyPercent;
  const minimumBudgetDeltaPercent = finite(model.regression.minimumBudgetDeltaPercent) ?? 0;
  const budgetValue = finite(budget?.value);
  const budgetScaledDelta = budgetValue === null
    ? 0
    : Math.abs(budgetValue) * minimumBudgetDeltaPercent / 100;
  return {
    type,
    percent,
    absolute: Math.max(model.regression.minimumAbsoluteDelta[unit] ?? 0, budgetScaledDelta),
  };
}

function evaluate(model, result, baseline) {
  const budgets = new Map(model.budgets.map((budget) => [budget.id, budget]));
  const baselineMetrics = new Map(metricsOf(baseline ?? {}).map((metric) => [metric.id, metric]));
  const environment = environmentComparison(model, result, baseline);
  const resultMetrics = metricsOf(result);
  const evaluated = resultMetrics.map((metric) => {
    const budget = budgets.get(metric.budgetId ?? metric.id) ?? metric.inlineBudget ?? null;
    const values = stats(metric);
    const statistic = metric.statistic ?? budget?.statistic ?? "value";
    const actual = finite(values[statistic]);
    const unit = metric.unit ?? budget?.unit ?? "";
    const budgetPass = budget ? compare(budget.operator, actual, budget.value) : null;
    const baselineMetric = environment.comparable ? baselineMetrics.get(metric.id) : null;
    const baselineValues = baselineMetric ? stats(baselineMetric) : null;
    const baselineValue = baselineValues ? finite(baselineValues[statistic]) : null;
    let changePercent = null;
    let regressionPass = null;
    if (actual !== null && baselineValue !== null) {
      changePercent = baselineValue === 0
        ? (actual === 0 ? 0 : null)
        : ((actual - baselineValue) / Math.abs(baselineValue)) * 100;
      // Baseline-only observations remain visible as trends. A metric becomes a
      // regression gate only after the performance model assigns it a budget.
      if (budget) {
        const limit = regressionLimit(model, budget, unit);
        const absoluteChange = actual - baselineValue;
        const meaningful = Math.abs(absoluteChange) >= limit.absolute;
        if (!meaningful) regressionPass = true;
        else if (limit.type === "throughput" || budget.operator?.startsWith(">")) {
          regressionPass = changePercent === null || changePercent >= -limit.percent;
        } else if (limit.type === "error" && unit === "percent") {
          regressionPass = absoluteChange <= model.regression.errorRateAbsolutePoints;
        } else {
          regressionPass = changePercent === null || changePercent <= limit.percent;
        }
      }
    }
    const measurementFailed = Boolean(metric.error)
      || ["error", "failed", "timeout"].includes(String(metric.status ?? metric.outcome ?? "").toLowerCase());
    const pass = !measurementFailed
      && (actual !== null ? budgetPass !== false && regressionPass !== false : !budget);
    return {
      metric,
      budget,
      values,
      statistic,
      actual,
      unit,
      budgetPass,
      baselineValue,
      changePercent,
      regressionPass,
      measurementFailed,
      pass,
      framework: metric.framework ?? budget?.framework ?? "UNCLASSIFIED",
    };
  });
  const coveredBudgets = new Set(resultMetrics.map((metric) => metric.budgetId ?? metric.id));
  for (const budget of model.budgets) {
    if (coveredBudgets.has(budget.id)) continue;
    evaluated.push({
      metric: { id: budget.id, name: budget.label, statistic: budget.statistic },
      budget,
      values: { value: null, min: null, p50: null, p95: null, p99: null, max: null, samples: 0 },
      statistic: budget.statistic,
      actual: null,
      unit: budget.unit,
      budgetPass: null,
      baselineValue: null,
      changePercent: null,
      regressionPass: null,
      measurementFailed: false,
      pass: true,
      coverageGap: true,
      framework: budget.framework,
    });
  }
  return evaluated;
}

function formatValue(value, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
  const number = Number(value);
  const digits = Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 10 ? 1 : 2;
  const rendered = number.toLocaleString("en-US", { maximumFractionDigits: digits });
  if (unit === "bytes") {
    if (number >= 1048576) return `${(number / 1048576).toFixed(2)} MiB`;
    if (number >= 1024) return `${(number / 1024).toFixed(1)} KiB`;
  }
  return unit ? `${rendered} ${unit}` : rendered;
}

function verdict(item) {
  if (item.coverageGap) return "NO DATA";
  if (item.actual === null) return "NO DATA";
  if (!item.budget && item.regressionPass === null) return "OBSERVE";
  return item.pass ? "PASS" : "FAIL";
}

function frameworkSummary(model, evaluated) {
  return Object.entries(model.frameworks).map(([id, framework]) => {
    const rows = evaluated.filter((item) => item.framework === id);
    const assessed = rows.filter((item) => verdict(item) !== "OBSERVE" && verdict(item) !== "NO DATA");
    const passed = assessed.filter((item) => item.pass).length;
    return { id, ...framework, rows: rows.length, assessed: assessed.length, passed };
  });
}

function barChart(evaluated) {
  const rows = evaluated.filter((item) => item.actual !== null).slice(0, 18);
  if (rows.length === 0) return "<p class=empty>没有可绘制的指标。</p>";
  const width = 920;
  const rowHeight = 34;
  const labelWidth = 250;
  const chartWidth = width - labelWidth - 80;
  const svgRows = rows.map((item, index) => {
    const target = item.budget?.value ?? item.actual;
    const max = Math.max(item.actual, target) * 1.15 || 1;
    const actualWidth = Math.max(1, (item.actual / max) * chartWidth);
    const targetX = labelWidth + (target / max) * chartWidth;
    const baselineX = item.baselineValue === null
      ? null
      : labelWidth + (item.baselineValue / max) * chartWidth;
    const y = index * rowHeight + 8;
    const color = item.budget ? (item.pass ? "#059669" : "#dc2626") : "#6b7280";
    const targetLine = item.budget
      ? `<line x1="${targetX}" y1="${y - 3}" x2="${targetX}" y2="${y + 19}" stroke="#111827" stroke-width="2"/>`
      : "";
    return `<text x="0" y="${y + 13}" class="svg-label">${escapeHtml(item.metric.name)}</text><rect x="${labelWidth}" y="${y}" width="${actualWidth}" height="16" rx="2" fill="${color}" opacity=".82"/>${targetLine}${baselineX === null ? "" : `<line x1="${baselineX}" y1="${y - 3}" x2="${baselineX}" y2="${y + 19}" stroke="#2563eb" stroke-width="2" stroke-dasharray="3 2"/>`}<text x="${Math.min(labelWidth + actualWidth + 6, width - 72)}" y="${y + 13}" class="svg-value">${escapeHtml(formatValue(item.actual, item.unit))}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${rows.length * rowHeight + 8}" role="img" aria-label="指标与预算对比">${svgRows}</svg><p class="muted">黑色实线为绝对预算；蓝色虚线为同环境基线；灰色条为无预算观察项。</p>`;
}

function percentileChart(evaluated) {
  const rows = evaluated.filter((item) => item.values.p50 !== null
    && item.values.p95 !== null
    && item.values.p99 !== null).slice(0, 12);
  if (rows.length === 0) return "";
  const width = 920;
  const labelWidth = 250;
  const chartWidth = 620;
  const rowHeight = 38;
  const svgRows = rows.map((item, index) => {
    const values = [item.values.p50, item.values.p95, item.values.p99];
    const max = Math.max(...values, item.budget?.value ?? 0) * 1.1 || 1;
    const y = index * rowHeight + 18;
    const positions = values.map((value) => labelWidth + (value / max) * chartWidth);
    return `<text x="0" y="${y + 4}" class="svg-label">${escapeHtml(item.metric.name)}</text><line x1="${positions[0]}" y1="${y}" x2="${positions[2]}" y2="${y}" stroke="#9ca3af" stroke-width="3"/><circle cx="${positions[0]}" cy="${y}" r="5" fill="#059669"><title>p50 ${escapeHtml(formatValue(values[0], item.unit))}</title></circle><circle cx="${positions[1]}" cy="${y}" r="5" fill="#ca8a04"><title>p95 ${escapeHtml(formatValue(values[1], item.unit))}</title></circle><circle cx="${positions[2]}" cy="${y}" r="5" fill="#dc2626"><title>p99 ${escapeHtml(formatValue(values[2], item.unit))}</title></circle>`;
  }).join("");
  return `<section><h2>延迟分布</h2><svg class="chart" viewBox="0 0 ${width} ${rows.length * rowHeight + 12}" role="img" aria-label="p50 p95 p99 延迟分布">${svgRows}</svg><div class="legend"><span><i style="background:#059669"></i>p50</span><span><i style="background:#ca8a04"></i>p95</span><span><i style="background:#dc2626"></i>p99</span></div></section>`;
}

function frameworkChart(summaries) {
  const width = 920;
  const cells = summaries.map((item, index) => {
    const x = index * 220 + 10;
    const ratio = item.assessed === 0 ? 0 : item.passed / item.assessed;
    return `<g transform="translate(${x},12)"><text x="0" y="16" class="svg-heading">${escapeHtml(item.id)}</text><rect x="0" y="30" width="190" height="14" rx="2" fill="#e5e7eb"/><rect x="0" y="30" width="${190 * ratio}" height="14" rx="2" fill="${escapeHtml(item.color)}"/><text x="0" y="64" class="svg-value">${item.assessed ? `${item.passed}/${item.assessed} 通过` : "仅观察或无数据"}</text></g>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${width} 90" role="img" aria-label="性能模型覆盖情况">${cells}</svg>`;
}

function waterfallChart(evaluated) {
  const metric = evaluated.find((item) => Array.isArray(item.metric.stages) && item.metric.stages.length);
  if (!metric) return "";
  const stages = metric.metric.stages.map((stage) => ({
    name: stage.name ?? stage.id ?? "stage",
    duration: finite(stage.durationMs ?? stage.value) ?? 0,
  }));
  const total = stages.reduce((sum, stage) => sum + stage.duration, 0) || 1;
  let cursor = 0;
  const colors = ["#2563eb", "#0891b2", "#059669", "#ca8a04", "#dc2626", "#7c3aed"];
  const blocks = stages.map((stage, index) => {
    const x = 20 + (cursor / total) * 880;
    const width = Math.max(2, (stage.duration / total) * 880);
    cursor += stage.duration;
    return `<rect x="${x}" y="28" width="${width}" height="34" fill="${colors[index % colors.length]}"/><title>${escapeHtml(stage.name)}: ${formatValue(stage.duration, "ms")}</title>`;
  }).join("");
  const legend = stages.map((stage, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(stage.name)} ${escapeHtml(formatValue(stage.duration, "ms"))}</span>`).join("");
  return `<section><h2>端到端耗时瀑布</h2><p class="muted">${escapeHtml(metric.metric.name)}</p><svg class="chart" viewBox="0 0 920 90" role="img" aria-label="端到端耗时分层">${blocks}<text x="20" y="82" class="svg-value">总计 ${escapeHtml(formatValue(total, "ms"))}</text></svg><div class="legend">${legend}</div></section>`;
}

function trendChart(evaluated) {
  const metric = evaluated.find((item) => Array.isArray(item.metric.series) && item.metric.series.length > 1);
  if (!metric) return "";
  const isPayloadScaling = metric.metric.series.every((point) => finite(point.payloadBytes) !== null);
  const points = metric.metric.series.map((point, index) => ({
    rawX: finite(point.x ?? point.elapsedMs ?? index) ?? index,
    y: finite(point.y ?? point.value) ?? 0,
  })).map((point) => ({
    ...point,
    x: isPayloadScaling ? Math.log2(point.rawX + 1) : point.rawX,
  }));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const coords = points.map((point) => {
    const x = 50 + ((point.x - minX) / (maxX - minX || 1)) * 840;
    const y = 230 - ((point.y - minY) / (maxY - minY || 1)) * 190;
    return `${x},${y}`;
  }).join(" ");
  const title = isPayloadScaling ? "载荷伸缩趋势" : "资源趋势";
  return `<section><h2>${title}</h2><p class="muted">${escapeHtml(metric.metric.name)}</p><svg class="chart" viewBox="0 0 920 270" role="img" aria-label="${title}"><line x1="50" y1="40" x2="50" y2="230" stroke="#9ca3af"/><line x1="50" y1="230" x2="890" y2="230" stroke="#9ca3af"/><polyline points="${coords}" fill="none" stroke="#059669" stroke-width="3"/><text x="52" y="34" class="svg-value">${escapeHtml(formatValue(maxY, metric.unit))}</text><text x="52" y="250" class="svg-value">${escapeHtml(formatValue(minY, metric.unit))}</text></svg></section>`;
}

function metricRows(evaluated) {
  return evaluated.map((item) => `<tr class="${item.pass ? "pass" : "fail"}"><td><strong>${escapeHtml(item.metric.name)}</strong><small>${escapeHtml(item.metric.id)}</small></td><td>${escapeHtml(item.framework)}</td><td>${escapeHtml(item.statistic)}</td><td>${escapeHtml(formatValue(item.actual, item.unit))}</td><td>${item.budget ? `${escapeHtml(item.budget.operator)} ${escapeHtml(formatValue(item.budget.value, item.budget.unit))}` : "-"}</td><td>${item.baselineValue === null ? "-" : escapeHtml(formatValue(item.baselineValue, item.unit))}</td><td>${item.changePercent === null ? "-" : `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(1)}%`}</td><td><span class="badge ${verdict(item).toLowerCase().replace(" ", "-")}">${verdict(item)}</span></td></tr>`).join("");
}

function gateRows(gates) {
  if (gates.length === 0) return '<tr><td colspan="4" class="muted">本次结果未提供聚合门禁。</td></tr>';
  return gates.map((gate) => `<tr><td><strong>${escapeHtml(gate.name)}</strong><small>${escapeHtml(gate.id)}</small></td><td>${escapeHtml(gate.status || "unknown")}</td><td>${escapeHtml(gate.message ?? gate.summary ?? "-")}</td><td><span class="badge ${gate.pass ? "pass" : "fail"}">${gate.pass ? "PASS" : "FAIL"}</span></td></tr>`).join("");
}

function metadataRows(metadata) {
  return Object.entries(metadata).map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</td></tr>`).join("");
}

function markdown(model, result, evaluated, environment, gates) {
  const metadata = metadataOf(result);
  const failures = evaluated.filter((item) => !item.pass);
  const gateFailures = gates.filter((gate) => !gate.pass);
  const assessed = evaluated.filter((item) => verdict(item) !== "OBSERVE" && verdict(item) !== "NO DATA");
  const coverageGaps = evaluated.filter((item) => verdict(item) === "NO DATA");
  const status = failures.length > 0 || gateFailures.length > 0
    ? "FAIL"
    : coverageGaps.length > 0 ? "INCOMPLETE" : "PASS";
  const rows = evaluated.map((item) => `| ${item.metric.name} | ${item.framework} | ${item.statistic} | ${formatValue(item.actual, item.unit)} | ${item.budget ? `${item.budget.operator} ${formatValue(item.budget.value, item.budget.unit)}` : "-"} | ${item.baselineValue === null ? "-" : formatValue(item.baselineValue, item.unit)} | ${item.changePercent === null ? "-" : `${item.changePercent.toFixed(1)}%`} | ${verdict(item)} |`).join("\n");
  const meta = Object.entries(metadata).map(([key, value]) => `- \`${key}\`: ${typeof value === "object" ? JSON.stringify(value) : value}`).join("\n");
  const gateTable = gates.length === 0
    ? "本次结果未提供聚合门禁。"
    : `| 门禁 | 状态 | 信息 | 判定 |\n| --- | --- | --- | --- |\n${gates.map((gate) => `| ${gate.name} | ${gate.status || "unknown"} | ${gate.message ?? gate.summary ?? "-"} | ${gate.pass ? "PASS" : "FAIL"} |`).join("\n")}`;
  return `# GitTributary 性能测试报告\n\n> 模型版本: ${model.modelVersion}  \n> 结论: **${status}** (${assessed.filter((item) => item.pass).length}/${assessed.length} 项指标通过，${gates.filter((gate) => gate.pass).length}/${gates.length} 项门禁通过，${coverageGaps.length} 项未采集)  \n> 基线比较: ${environment.reason}\n\n## 测试环境\n\n${meta || "未提供环境元数据。"}\n\n## 聚合门禁\n\n${gateTable}\n\n## 指标与预算\n\n| 指标 | 模型 | 统计量 | 当前值 | 绝对预算 | 基线 | 变化 | 判定 |\n| --- | --- | --- | ---: | ---: | ---: | ---: | --- |\n${rows || "| - | - | - | - | - | - | - | NO DATA |"}\n\n## 判定规则\n\n- 百分位采用 nearest-rank；推荐至少 ${model.measurement.minimumSamples} 个正式样本，参考环境使用 ${model.measurement.referenceSamples} 个样本。\n- 延迟回退阈值 ${model.regression.latencyPercent}%，吞吐回退阈值 ${model.regression.throughputPercent}%，资源回退阈值 ${model.regression.resourcePercent}%。\n- 只有 ${model.environmentMatch.join("、")} 全部匹配时才进行相对基线判定。\n- 模型中未采集的场景显示 NO DATA，并使报告标记为 INCOMPLETE；当前 CI 只对已自动化场景执行硬门禁。\n- 单一综合分数仅用于浏览；是否通过始终由每项硬预算、相对回归和聚合门禁决定。\n`;
}

function html(model, result, evaluated, environment, gates) {
  const metadata = metadataOf(result);
  const summaries = frameworkSummary(model, evaluated);
  const assessed = evaluated.filter((item) => ["PASS", "FAIL"].includes(verdict(item)));
  const passed = assessed.filter((item) => item.pass).length;
  const failures = evaluated.filter((item) => !item.pass).length;
  const gateFailures = gates.filter((gate) => !gate.pass).length;
  const coverageGaps = evaluated.filter((item) => verdict(item) === "NO DATA").length;
  const status = failures > 0 || gateFailures > 0
    ? "FAIL"
    : coverageGaps > 0 ? "INCOMPLETE" : "PASS";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitTributary 性能测试报告</title><style>
  :root{color-scheme:light;--ink:#111827;--muted:#6b7280;--line:#d1d5db;--paper:#fff;--wash:#f3f4f6;--pass:#047857;--fail:#b91c1c}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1120px;margin:auto;background:var(--paper);min-height:100vh;padding:40px 48px}header{border-bottom:2px solid var(--ink);padding-bottom:24px;margin-bottom:30px}.kicker{text-transform:uppercase;color:var(--muted);font-size:12px}h1{font-size:32px;margin:4px 0;letter-spacing:0}h2{font-size:19px;margin:32px 0 12px;letter-spacing:0}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:20px 0}.tile{border:1px solid var(--line);padding:14px;border-radius:6px}.tile b{display:block;font-size:22px}.status-pass{color:var(--pass)}.status-fail{color:var(--fail)}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid var(--line);padding:9px 8px;vertical-align:top}thead th{background:var(--wash);position:sticky;top:0}td small{display:block;color:var(--muted)}.badge{font-weight:700;font-size:11px;padding:2px 6px;border-radius:3px}.badge.pass{background:#d1fae5;color:#065f46}.badge.fail,.badge.no-data{background:#fee2e2;color:#991b1b}.badge.observe{background:#e5e7eb;color:#374151}.muted,.empty{color:var(--muted)}.chart{display:block;width:100%;height:auto;border:1px solid var(--line);background:#fff}.svg-label{font:12px ui-sans-serif,system-ui;fill:#374151}.svg-value{font:11px ui-monospace,monospace;fill:#4b5563}.svg-heading{font:bold 16px ui-sans-serif,system-ui;fill:#111827}.legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}.legend i{display:inline-block;width:9px;height:9px;margin-right:5px}details{margin-top:30px}code{font-family:ui-monospace,monospace}@media(max-width:760px){main{padding:24px 16px}.summary{grid-template-columns:1fr 1fr}.table-wrap{overflow-x:auto}}@media print{body{background:#fff}main{max-width:none;padding:10mm}.chart{break-inside:avoid}thead th{position:static}}
  </style></head><body><main><header><div class="kicker">Performance report · model ${escapeHtml(model.modelVersion)}</div><h1>GitTributary 性能测试报告</h1><p class="muted">基线比较：${escapeHtml(environment.reason)}</p><div class="summary"><div class="tile"><span>总体判定</span><b class="status-${status.toLowerCase()}">${status}</b></div><div class="tile"><span>已判定</span><b>${passed}/${assessed.length}</b></div><div class="tile"><span>未采集</span><b>${coverageGaps}</b></div><div class="tile"><span>失败项</span><b>${failures + gateFailures}</b></div></div></header><section><h2>RAIL / RED / USE / Desktop</h2>${frameworkChart(summaries)}</section><section><h2>聚合门禁</h2><div class="table-wrap"><table><thead><tr><th>门禁</th><th>状态</th><th>信息</th><th>判定</th></tr></thead><tbody>${gateRows(gates)}</tbody></table></div></section><section><h2>指标与预算</h2>${barChart(evaluated)}</section>${percentileChart(evaluated)}${waterfallChart(evaluated)}${trendChart(evaluated)}<section><h2>完整结果</h2><div class="table-wrap"><table><thead><tr><th>指标</th><th>模型</th><th>统计量</th><th>当前</th><th>预算</th><th>基线</th><th>变化</th><th>判定</th></tr></thead><tbody>${metricRows(evaluated)}</tbody></table></div></section><details><summary>测试环境与元数据</summary><table><tbody>${metadataRows(metadata)}</tbody></table></details><details><summary>判定方法</summary><p>百分位使用 nearest-rank。只有 ${escapeHtml(model.environmentMatch.join("、"))} 全部匹配时才启用相对基线门禁。延迟、吞吐、资源的允许回退分别为 ${model.regression.latencyPercent}%、${model.regression.throughputPercent}%、${model.regression.resourcePercent}%。模型中未采集的场景显示 NO DATA，并使总体状态标记为 INCOMPLETE；当前 CI 只对已自动化场景执行硬门禁。</p></details></main></body></html>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (!args.input) throw new Error(`Missing --input\n\n${usage()}`);
  const model = readJson(args.model);
  const result = readJson(args.input);
  const baseline = args.baseline ? readJson(args.baseline) : null;
  const environment = environmentComparison(model, result, baseline);
  const evaluated = evaluate(model, result, baseline);
  const gates = gatesOf(result);
  const output = path.resolve(args.output ?? path.dirname(path.resolve(args.input)));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "report.md"), markdown(model, result, evaluated, environment, gates));
  fs.writeFileSync(path.join(output, "report.html"), html(model, result, evaluated, environment, gates));
  const failures = evaluated.filter((item) => !item.pass);
  const gateFailures = gates.filter((gate) => !gate.pass);
  const coverageGaps = evaluated.filter((item) => verdict(item) === "NO DATA");
  const status = failures.length > 0 || gateFailures.length > 0
    ? `FAIL (${failures.length + gateFailures.length})`
    : coverageGaps.length > 0 ? `INCOMPLETE (${coverageGaps.length} missing)` : "PASS";
  process.stdout.write(`Performance report: ${path.join(output, "report.html")}\n`);
  process.stdout.write(`Verdict: ${status}\n`);
  if (failures.length > 0 || gateFailures.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`render-report: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
