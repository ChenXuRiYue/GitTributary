import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type {
  EventDefinition,
  FlowListItem,
  FlowNodeDefinition,
  FlowSummary,
} from "./types";
import {
  defaultFlowFolder,
  eventDomainMeta,
  eventDomainText,
  eventMatchesQuery,
  eventSearchText,
  eventStabilityTone,
  flowFileName,
  flowMarker,
  flowMarkerClass,
  flowSectionLabel,
  formatTime,
  groupEventsByDomain,
  groupNodeDefinitionsByType,
  nodeMatchesQuery,
  nodeSearchText,
  nodeTypeMeta,
  nodeTypeText,
  nodeTypeTone,
  normalizeFolder,
  runStatusText,
  runStatusTone,
  shortJson,
  sortedEvents,
  sortedNodeDefinitions,
  statusTone,
  summaryFromItem,
  triggerText,
} from "./utils";

function summary(triggerKind = "workflow_dispatch"): FlowSummary {
  return {
    id: "flow.publish",
    name: "Publish",
    enabled: true,
    triggers: [{ kind: triggerKind, label: triggerKind }],
    jobs: [],
    step_count: 0,
  };
}

function node(overrides: Partial<FlowNodeDefinition> = {}): FlowNodeDefinition {
  return {
    uses: "example/build@v1",
    name: "Build site",
    node_type: "build",
    summary: "Build markdown",
    description: "Build a static site",
    inputs_schema: { source: "string" },
    outputs_schema: { output: "path" },
    source: { kind: "plugin", id: "example", name: "Publisher", version: "1.2.3" },
    ...overrides,
  };
}

function event(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    type: "git.commit.created",
    source: "gittributary://gt-git",
    domain: "git",
    summary: "Commit created",
    description: "A commit was created",
    trigger_description: "After commit",
    stability: "stable",
    filters: ["branches"],
    data_schema: { branch: "string" },
    ...overrides,
  };
}

describe("flow projection helpers", () => {
  it.each([
    ["events", "事件"],
    ["nodes", "节点"],
    ["flows", "编排"],
  ] as const)("labels %s sections", (section, label) => {
    expect(flowSectionLabel(section)).toBe(label);
  });

  it.each([
    ["schedule", "定时"],
    ["workflow_dispatch", "手动"],
    ["file_watch", "监听"],
    ["git.commit.created", "Git 事件"],
    ["store_changed", "事件"],
  ])("maps trigger %s to folder %s", (trigger, folder) => {
    expect(defaultFlowFolder(summary(trigger))).toBe(folder);
  });

  it("normalizes unsafe and blank folder segments", () => {
    expect(normalizeFolder(" release / ./ ../ daily ")).toBe("release/daily");
    expect(normalizeFolder(" /./../ ", summary("schedule"))).toBe("定时");
    expect(normalizeFolder()).toBe("未分类");
  });

  it("never emits dot traversal segments after normalization", () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(".", "..", "", " docs ", "release", " nested "), { maxLength: 30 }),
      (parts) => {
        const normalized = normalizeFolder(parts.join("/"));
        expect(normalized.split("/")).not.toContain(".");
        expect(normalized.split("/")).not.toContain("..");
      },
    ));
  });

  it.each([
    ["flow.daily.backup", "daily-backup.yml"],
    ["daily", "daily.yml"],
    ["flow.flow.notes", "flow-notes.yml"],
  ])("turns flow id %s into filename %s", (id, file) => {
    expect(flowFileName(id)).toBe(file);
  });

  it("maps enabled state and markers to stable visual semantics", () => {
    expect(flowMarker(true)).toBe("active");
    expect(flowMarker(false)).toBe("muted");
    expect(flowMarkerClass("active")).toContain("green");
    expect(flowMarkerClass("warning")).toContain("amber");
    expect(flowMarkerClass("error")).toContain("red");
    expect(flowMarkerClass()).toContain("muted");
  });

  it("uses list-item enabled state as the authoritative summary state", () => {
    const item: FlowListItem = {
      id: "flow.publish",
      key: "workflow.flow.publish",
      summary: summary(),
      enabled: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      folder: "手动",
    };
    expect(summaryFromItem(item)).toEqual({ ...item.summary, enabled: false });
    expect(item.summary.enabled).toBe(true);
  });
});

describe("flow node catalog helpers", () => {
  it.each([
    ["context", "上下文"],
    ["guard", "判断"],
    ["build", "构建"],
    ["validate", "校验"],
    ["sync", "同步"],
    ["git", "Git"],
    ["notify", "通知"],
    ["custom", "custom"],
  ])("labels node type %s", (type, label) => {
    expect(nodeTypeText(type)).toBe(label);
    expect(nodeTypeMeta(type).label.length).toBeGreaterThan(0);
    expect(nodeTypeMeta(type).description.length).toBeGreaterThan(0);
  });

  it("gives important node types distinct tones", () => {
    expect(nodeTypeTone("build")).toContain("blue");
    expect(nodeTypeTone("git")).toContain("green");
    expect(nodeTypeTone("sync")).toContain("purple");
    expect(nodeTypeTone("validate")).toContain("amber");
    expect(nodeTypeTone("unknown")).toContain("red");
    expect(nodeTypeTone("custom")).toContain("slate");
  });

  it("sorts on a copy by type then uses", () => {
    const input = [
      node({ uses: "z/build@v1", node_type: "git" }),
      node({ uses: "b/build@v1", node_type: "build" }),
      node({ uses: "a/build@v1", node_type: "build" }),
    ];
    expect(sortedNodeDefinitions(input).map((item) => item.uses)).toEqual([
      "a/build@v1", "b/build@v1", "z/build@v1",
    ]);
    expect(input[0].uses).toBe("z/build@v1");
  });

  it("searches all user-visible, schema, source, and translated fields", () => {
    const definition = node();
    for (const query of ["BUILD SITE", "构建", "markdown", "source", "output", "publisher", "1.2.3"]) {
      expect(nodeMatchesQuery(definition, `  ${query}  `)).toBe(true);
    }
    expect(nodeMatchesQuery(definition, "missing-value")).toBe(false);
    expect(nodeMatchesQuery(definition, "  ")).toBe(true);
    expect(nodeSearchText(definition)).toBe(nodeSearchText(definition).toLocaleLowerCase());
  });

  it("groups blank types under unknown without changing item identity", () => {
    const unknown = node({ node_type: "" });
    const build = node();
    const groups = groupNodeDefinitionsByType([unknown, build]);
    expect(groups.unknown).toEqual([unknown]);
    expect(groups.build).toEqual([build]);
  });
});

describe("flow event catalog helpers", () => {
  it.each([
    ["app", "应用"],
    ["ui", "界面"],
    ["git", "Git"],
    ["store", "数据中心"],
    ["flow", "Flow"],
    ["custom", "custom"],
  ])("describes event domain %s", (domain, label) => {
    expect(eventDomainText(domain)).toBe(label);
    expect(eventDomainMeta(domain).summary.length).toBeGreaterThan(0);
    expect(eventDomainMeta(domain).description.length).toBeGreaterThan(0);
  });

  it("maps stability to visual warning levels", () => {
    expect(eventStabilityTone("stable")).toContain("green");
    expect(eventStabilityTone("deprecated")).toContain("amber");
    expect(eventStabilityTone("experimental")).toContain("slate");
  });

  it("sorts and groups events deterministically", () => {
    const input = [
      event({ type: "git.push.completed" }),
      event({ domain: "app", type: "app.started" }),
      event({ type: "git.commit.created" }),
      event({ domain: "", type: "custom" }),
    ];
    expect(sortedEvents(input).map((item) => item.type)).toEqual([
      "custom", "app.started", "git.commit.created", "git.push.completed",
    ]);
    expect(groupEventsByDomain(input).unknown[0].type).toBe("custom");
    expect(input[0].type).toBe("git.push.completed");
  });

  it("searches event descriptions, filters, schema, and metadata case-insensitively", () => {
    const definition = event();
    for (const query of ["COMMIT CREATED", "after commit", "branches", "branch", "stable", "gt-git"]) {
      expect(eventMatchesQuery(definition, query)).toBe(true);
    }
    expect(eventMatchesQuery(definition, "missing-value")).toBe(false);
    expect(eventMatchesQuery(definition, "  ")).toBe(true);
    expect(eventSearchText(definition)).toBe(eventSearchText(definition).toLocaleLowerCase());
  });
});

describe("flow run presentation", () => {
  it("formats empty and invalid time values without throwing", () => {
    expect(formatTime("")).toBe("-");
    expect(formatTime("not-a-time")).toBe("not-a-time");
    expect(formatTime("2026-01-01T00:00:00Z")).not.toBe("2026-01-01T00:00:00Z");
  });

  it.each([
    ["pending", "等待中"],
    ["running", "运行中"],
    ["succeeded", "成功"],
    ["failed", "失败"],
    ["skipped", "已跳过"],
  ] as const)("labels run status %s", (status, label) => {
    expect(runStatusText(status)).toBe(label);
    expect(runStatusTone(status).length).toBeGreaterThan(0);
  });

  it("uses enabled and disabled status tones", () => {
    expect(statusTone(true)).toContain("green");
    expect(statusTone(false)).toContain("slate");
  });

  it.each([
    ["workflow_dispatch", "手动运行入口"],
    ["schedule", "定时触发"],
    ["file_watch", "文件监听触发"],
    ["store_changed", "数据中心变更触发"],
    ["git.commit.created", "Git 事件触发"],
    ["flow.succeeded", "Flow 运行事件触发"],
    ["custom", "事件触发"],
  ])("labels trigger %s", (kind, label) => {
    expect(triggerText({ kind, label: kind })).toBe(label);
  });

  it("renders compact JSON with a hard 120-character ceiling", () => {
    expect(shortJson(null)).toBe("-");
    expect(shortJson("plain")).toBe("plain");
    expect(shortJson({ ok: true })).toBe('{"ok":true}');
    const compact = shortJson({ payload: "x".repeat(300) });
    expect(compact).toHaveLength(120);
    expect(compact.endsWith("...")).toBe(true);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(shortJson(circular)).toBe("[object Object]");
  });
});
