import { invoke } from "@tauri-apps/api/core";

export interface JsonStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}
/** A minimal namespaced JSON store for core UI state. */
export function createJsonStore(namespace: string): JsonStore {
  return {
    get: <T,>(key: string) => invoke<T | null>("store_get", { namespace, key }),
    set: <T,>(key: string, value: T) => invoke<void>("store_set", { namespace, key, value }),
    delete: (key: string) => invoke<void>("store_delete", { namespace, key }),
  };
}
