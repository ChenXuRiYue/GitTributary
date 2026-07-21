import { STORE_DOMAIN_MIN_WIDTH, VIEW_MODES } from "./constants";
import type { JsonGroup, KeyTreeNode, KvEntry, StorePanelUiState, ViewMode } from "./types";

const L0_KEYS = new Set([
  "git.access_token",
  "git.ssh_passphrase",
  "data_center.config_repo.token",
]);

export function isL0Key(key: string): boolean {
  return L0_KEYS.has(key) || (key.startsWith("project.") && key.endsWith(".token"));
}

export function isConfigCenterUrl(url: string): boolean {
  return url.trim().startsWith("https://");
}

function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.some((mode) => mode.id === value);
}

export function parseStorePanelUiState(value: unknown): StorePanelUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<StorePanelUiState>;
  if (state.version !== 1) return null;
  if (typeof state.namespace !== "string" || state.namespace.length === 0) return null;
  if (!isViewMode(state.viewMode)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return { version: 1, namespace: state.namespace, viewMode: state.viewMode, updatedAt: state.updatedAt };
}

export function parseStoredWidth(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(STORE_DOMAIN_MIN_WIDTH, value);
}

export function stringifyValue(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, null, space) ?? String(value);
  } catch {
    return String(value);
  }
}

export function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array:${value.length}`;
  if (typeof value === "object") return `object:${Object.keys(value as Record<string, unknown>).length}`;
  return typeof value;
}

export function domainLabel(namespace: string): string {
  return namespace.startsWith("private.") ? namespace.slice("private.".length) : namespace;
}

export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const withoutSuffix = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
  const sshMatch = withoutSuffix.match(/[:/]([^/:]+\/[^/]+)$/);
  if (sshMatch) return sshMatch[1];
  try {
    return new URL(withoutSuffix).pathname.replace(/^\/+/, "") || trimmed;
  } catch {
    return withoutSuffix.split("/").slice(-2).join("/") || trimmed;
  }
}

export function isExpandable(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0;
}

export function sortedObjectEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

export function primitiveClassName(value: unknown): string {
  if (value === null) return "text-muted-foreground";
  if (typeof value === "string") return "text-emerald-700 dark:text-emerald-300";
  if (typeof value === "number") return "text-sky-700 dark:text-sky-300";
  if (typeof value === "boolean") return "text-violet-700 dark:text-violet-300";
  return "text-foreground";
}

export function formatPrimitive(value: unknown, mode: "json" | "yaml" = "json"): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (mode === "yaml" && /^[\w./:@-]+$/.test(value)) return value;
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return stringifyValue(value);
}

function createTreeNode(name: string, path: string): KeyTreeNode {
  return { name, path, children: new Map() };
}

function assignJsonPath(target: Record<string, unknown>, path: string[], value: unknown) {
  if (path.length === 0) {
    target.$value = value;
    return;
  }
  let cursor = target;
  path.forEach((part, index) => {
    if (index === path.length - 1) {
      const existing = cursor[part];
      if (existing !== undefined && isExpandable(existing)) {
        (existing as Record<string, unknown>).$value = value;
      } else {
        cursor[part] = value;
      }
      return;
    }
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  });
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, childValue]) => [key, sortJsonValue(childValue)]),
  );
}

export function buildJsonGroups(entries: KvEntry[]): JsonGroup[] {
  const groups = new Map<string, { value: Record<string, unknown>; count: number }>();
  for (const entry of entries) {
    const parts = entry.key.split(".").filter(Boolean);
    const name = parts[0] || entry.key;
    let group = groups.get(name);
    if (!group) {
      group = { value: {}, count: 0 };
      groups.set(name, group);
    }
    assignJsonPath(group.value, parts.length > 1 ? parts.slice(1) : [], isL0Key(entry.key) ? "••••••••" : entry.value);
    group.count += 1;
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, group]) => ({
      name,
      value: sortJsonValue(Object.keys(group.value).length === 1 && "$value" in group.value ? group.value.$value : group.value),
      count: group.count,
    }));
}

export function buildKeyTree(entries: KvEntry[]): KeyTreeNode {
  const root = createTreeNode("", "");
  for (const entry of entries) {
    const parts = entry.key.split(".").filter(Boolean);
    const safeParts = parts.length > 0 ? parts : [entry.key];
    let cursor = root;
    safeParts.forEach((part, index) => {
      const path = safeParts.slice(0, index + 1).join(".");
      let next = cursor.children.get(part);
      if (!next) {
        next = createTreeNode(part, path);
        cursor.children.set(part, next);
      }
      cursor = next;
    });
    cursor.entry = entry;
  }
  return root;
}

export function sortedChildren(node: KeyTreeNode): KeyTreeNode[] {
  return Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
}
