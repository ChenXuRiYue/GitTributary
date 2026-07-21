import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  GitHubImageLibrary,
  GitRemoteBinding,
  GitRemoteConfigEntry,
} from "../../types";
import {
  bindingKey,
  createLibrary,
  isStoredSettings,
  LEGACY_SETTINGS_KEY,
  migratePreviousSettings,
  migrationError,
  normalizeRemoteUrl,
  PREVIOUS_SETTINGS_KEY,
  remoteBinding,
  remoteEntryKey,
  SETTINGS_KEY,
  SETTINGS_NAMESPACE,
  type StoredGitHubImageSettings,
} from "./model";

export function useImageLibraries() {
  const [libraries, setLibraries] = useState<GitHubImageLibrary[]>([]);
  const [remotes, setRemotes] = useState<GitRemoteConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleRemotes = useMemo(
    () => remotes.filter((entry) => remoteBinding(entry) !== null),
    [remotes],
  );

  const loadRemotes = useCallback(async () => {
    const next = await invoke<GitRemoteConfigEntry[]>("get_remote_configs");
    setRemotes(next);
    return next;
  }, []);

  const persist = useCallback(async (next: GitHubImageLibrary[]) => {
    const value: StoredGitHubImageSettings = { version: 3, libraries: next };
    await invoke("store_set", {
      namespace: SETTINGS_NAMESPACE,
      key: SETTINGS_KEY,
      value,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stored, configuredRemotes] = await Promise.all([
          invoke<unknown>("store_get", { namespace: SETTINGS_NAMESPACE, key: SETTINGS_KEY }),
          invoke<GitRemoteConfigEntry[]>("get_remote_configs"),
        ]);
        if (cancelled) return;
        setRemotes(configuredRemotes);
        if (isStoredSettings(stored)) {
          setLibraries(bindSuggestedRemotes(stored.libraries, configuredRemotes));
          return;
        }

        const previous = await invoke<unknown>("store_get", {
          namespace: SETTINGS_NAMESPACE,
          key: PREVIOUS_SETTINGS_KEY,
        });
        if (cancelled) return;
        let migrated = migratePreviousSettings(previous);
        if (migrated.length === 0) {
          const legacy = await invoke<unknown>("store_get", {
            namespace: SETTINGS_NAMESPACE,
            key: LEGACY_SETTINGS_KEY,
          });
          if (cancelled) return;
          migrated = migratePreviousSettings(legacy);
        }
        const bound = bindSuggestedRemotes(migrated, configuredRemotes);
        setLibraries(bound);
        if (bound.length > 0) await persist(bound);
      } catch (reason) {
        if (!cancelled) setError(migrationError(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [persist]);

  const saveLibrary = async (library: GitHubImageLibrary) => {
    if (!library.name.trim()) throw new Error("请输入图库名称");
    const binding = library.remote;
    if (!binding) throw new Error("请选择 Git 远程仓库");
    if (!eligibleRemotes.some((entry) => remoteEntryKey(entry) === bindingKey(binding))) {
      throw new Error("选择的 Git 远程不存在或没有可用 Token");
    }
    const normalized: GitHubImageLibrary = {
      ...library,
      name: library.name.trim(),
      branch: library.branch.trim() || "main",
      directory: library.directory.trim().replace(/^\/+|\/+$/g, ""),
      suggestedRemoteUrl: undefined,
    };
    const next = libraries.some((item) => item.id === normalized.id)
      ? libraries.map((item) => item.id === normalized.id ? normalized : item)
      : [...libraries, normalized];
    setSaving(true);
    setError(null);
    try {
      await persist(next);
      setLibraries(next);
      return normalized;
    } catch (reason) {
      setError(migrationError(reason));
      throw reason;
    } finally {
      setSaving(false);
    }
  };

  const deleteLibrary = async (id: string) => {
    const next = libraries.filter((library) => library.id !== id);
    setSaving(true);
    setError(null);
    try {
      await persist(next);
      setLibraries(next);
    } catch (reason) {
      setError(migrationError(reason));
      throw reason;
    } finally {
      setSaving(false);
    }
  };

  const addRemote = async (draft: {
    name: string;
    url: string;
    token: string;
  }): Promise<GitRemoteBinding> => {
    setSaving(true);
    setError(null);
    try {
      await invoke("add_remote", {
        name: draft.name.trim(),
        url: draft.url.trim(),
        token: draft.token.trim(),
        commitName: null,
        commitEmail: null,
      });
      const next = await loadRemotes();
      const created = next.find((entry) => (
        entry.name === draft.name.trim()
        && normalizeRemoteUrl(entry.url) === normalizeRemoteUrl(draft.url)
        && remoteBinding(entry) !== null
      ));
      const binding = created && remoteBinding(created);
      if (!binding) throw new Error("新增远程成功，但未能读取 Git 绑定");
      return binding;
    } catch (reason) {
      setError(migrationError(reason));
      throw reason;
    } finally {
      setSaving(false);
    }
  };

  const isBindingAvailable = (binding: GitRemoteBinding | null) => Boolean(
    binding && eligibleRemotes.some((entry) => remoteEntryKey(entry) === bindingKey(binding)),
  );

  return {
    libraries,
    eligibleRemotes,
    loading,
    saving,
    error,
    createLibrary: () => createLibrary(libraries.length + 1),
    saveLibrary,
    deleteLibrary,
    addRemote,
    refreshRemotes: loadRemotes,
    isBindingAvailable,
  };
}

function bindSuggestedRemotes(
  libraries: GitHubImageLibrary[],
  remotes: GitRemoteConfigEntry[],
): GitHubImageLibrary[] {
  return libraries.map((library) => {
    if (library.remote || !library.suggestedRemoteUrl) return library;
    const matches = remotes.filter((entry) => (
      normalizeRemoteUrl(entry.url) === normalizeRemoteUrl(library.suggestedRemoteUrl ?? "")
      && remoteBinding(entry) !== null
    ));
    const binding = matches.length === 1 ? remoteBinding(matches[0]) : null;
    return binding ? { ...library, remote: binding, suggestedRemoteUrl: undefined } : library;
  });
}
