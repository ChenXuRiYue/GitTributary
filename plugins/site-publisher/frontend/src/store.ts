import { invoke } from "@tauri-apps/api/core";

const PLUGIN_NAMESPACE = "plugin.dev.noteaura.site-publisher";

export interface PluginStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}
/** Create a small KV store that is always scoped to this plugin. */
export function createPluginStore(area: string): PluginStore {
  const namespace = `${PLUGIN_NAMESPACE}.${area}`;
  return {
    get: <T,>(key: string) => invoke<T | null>("store_get", { namespace, key }),
    set: <T,>(key: string, value: T) => invoke<void>("store_set", { namespace, key, value }),
    delete: (key: string) => invoke<void>("store_delete", { namespace, key }),
  };
}
export const siteUiStore = createPluginStore("ui");
