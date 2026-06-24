import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * 从数据中心读取一个 KV 值,并提供刷新能力。
 * 后续可扩展为 Tauri event 订阅自动刷新。
 *
 * @param namespace 命名空间
 * @param key 键
 * @returns [value, refresh] — 当前值 + 手动刷新函数
 */
export function useStoreKey<T = unknown>(
  namespace: string,
  key: string,
): [T | null, () => void] {
  const [value, setValue] = useState<T | null>(null);

  const refresh = useCallback(async () => {
    try {
      const val = await invoke<T | null>("store_get", { namespace, key });
      setValue(val);
    } catch {
      setValue(null);
    }
  }, [namespace, key]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [value, refresh];
}

/**
 * 读取 workspace 完整状态(快捷 hook)。
 */
export function useWorkspace() {
  const [activeRepo] = useStoreKey<string>("workspace", "repo.active");
  const [activeBranch] = useStoreKey<string>("workspace", "repo.branch");
  const [recentRepos] = useStoreKey<string[]>("workspace", "repo.recent");
  const [deviceId] = useStoreKey<string>("workspace", "device.id");
  const [deviceName] = useStoreKey<string>("workspace", "device.name");

  return { activeRepo, activeBranch, recentRepos, deviceId, deviceName };
}
