import { invoke } from "@tauri-apps/api/core";

import type {
  ExtensionCallRequest,
  ExtensionViewContribution,
} from "./types";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: JsonObject, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function normalizeContribution(
  value: unknown,
  pluginDefaults?: JsonObject,
): ExtensionViewContribution | null {
  if (!isObject(value)) return null;

  const pluginId = readString(value, "pluginId", "plugin_id")
    ?? (pluginDefaults && readString(pluginDefaults, "pluginId", "plugin_id", "id"));
  const viewId = readString(value, "viewId", "view_id", "id");
  const title = readString(value, "title", "name");
  const entryUrl = readString(value, "entryUrl", "entry_url", "url", "entry");
  if (!pluginId || !viewId || !title || !entryUrl) return null;

  return {
    pluginId,
    pluginName: readString(value, "pluginName", "plugin_name")
      ?? (pluginDefaults && readString(pluginDefaults, "pluginName", "plugin_name", "name"))
      ?? pluginId,
    pluginVersion: readString(value, "pluginVersion", "plugin_version")
      ?? (pluginDefaults && readString(pluginDefaults, "pluginVersion", "plugin_version", "version"))
      ?? "0.0.0",
    viewId,
    title,
    description: readString(value, "description") ?? "插件扩展页面",
    entryUrl,
    iconUrl: readString(value, "iconUrl", "icon_url", "icon"),
  };
}

/**
 * Accept both the flattened MVP response and a manifest-shaped response. This
 * keeps the React runtime independent from the install registry's storage DTO.
 */
function normalizeExtensionList(value: unknown): ExtensionViewContribution[] {
  const list = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.extensions)
      ? value.extensions
      : [];

  const contributions: ExtensionViewContribution[] = [];
  for (const item of list) {
    if (!isObject(item)) continue;
    if (item.enabled === false || item.status === "disabled") continue;

    const direct = normalizeContribution(item);
    if (direct) {
      contributions.push(direct);
      continue;
    }

    const manifest = isObject(item.manifest) ? item.manifest : item;
    const contributes = isObject(manifest.contributes) ? manifest.contributes : null;
    const views = contributes && Array.isArray(contributes.views)
      ? contributes.views
      : Array.isArray(item.views)
        ? item.views
        : [];
    for (const view of views) {
      const normalized = normalizeContribution(view, manifest);
      if (normalized) contributions.push(normalized);
    }
  }

  return contributions;
}

export async function listExtensionContributions(): Promise<ExtensionViewContribution[]> {
  const response = await invoke<unknown>("extension_list");
  return normalizeExtensionList(response);
}

export function callExtension<T = unknown>(request: ExtensionCallRequest): Promise<T> {
  return invoke<T>("extension_call", {
    pluginId: request.pluginId,
    method: request.method,
    payload: request.payload,
  });
}

export function extensionErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isObject(error)) {
    const message = readString(error, "message", "error");
    if (message) return message;
  }
  return "扩展运行时暂时不可用";
}
