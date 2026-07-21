import { invoke } from "@tauri-apps/api/core";

import { EXTENSIONS_CHANGED_EVENT } from "@/platform/extensions/events";

import type { MarketPlugin } from "./types";

export function listMarketPlugins(): Promise<MarketPlugin[]> {
  return invoke<MarketPlugin[]>("plugin_market_list");
}

export function installPlugin(pluginId: string): Promise<void> {
  return invoke<void>("plugin_install", { pluginId });
}

export function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke<void>("plugin_uninstall", { pluginId });
}

export function notifyExtensionsChanged(): void {
  window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT));
}

export function marketErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "插件列表暂时不可用";
}
