import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  GitHubImageMigrationReport,
  ImageMigrationLibrarySnapshot,
  ImageMigrationSettings,
  ImageMigrationTaskRecord,
  ImageMigrationWorkspaceState,
} from "../../types";
import { migrationError, SETTINGS_NAMESPACE } from "./model";
import {
  emptyMigrationWorkspace,
  MIGRATION_WORKSPACE_KEY,
  parseMigrationWorkspace,
  upsertMigrationTask,
} from "./migration-workspace";

export interface MigrationStartInput {
  repoPath: string;
  library: ImageMigrationLibrarySnapshot;
  settings: ImageMigrationSettings;
  imagePaths: string[];
  noteCount: number;
}

export interface MigrationWorkspaceController {
  loading: boolean;
  error: string | null;
  drafts: Record<string, ImageMigrationSettings>;
  history: ImageMigrationTaskRecord[];
  updateDraft: (repoPath: string, settings: ImageMigrationSettings) => void;
  startMigration: (input: MigrationStartInput) => Promise<void>;
}

export function useMigrationWorkspace(
  onCompleted: () => Promise<void>,
): MigrationWorkspaceController {
  const [workspace, setWorkspace] = useState<ImageMigrationWorkspaceState>(() => emptyMigrationWorkspace());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workspaceRef = useRef(workspace);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(async (next: ImageMigrationWorkspaceState) => {
    await invoke("store_set", {
      namespace: SETTINGS_NAMESPACE,
      key: MIGRATION_WORKSPACE_KEY,
      value: next,
    });
  }, []);

  const commit = useCallback((next: ImageMigrationWorkspaceState) => {
    workspaceRef.current = next;
    setWorkspace(next);
    persistQueueRef.current = persistQueueRef.current
      .then(() => persist(next))
      .catch((reason) => setError(migrationError(reason)));
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    void invoke<unknown>("store_get", {
      namespace: SETTINGS_NAMESPACE,
      key: MIGRATION_WORKSPACE_KEY,
    }).then((stored) => {
      if (cancelled) return;
      const next = parseMigrationWorkspace(stored);
      workspaceRef.current = next;
      setWorkspace(next);
      const hadRunningTask = Boolean(
        stored
        && typeof stored === "object"
        && Array.isArray((stored as { history?: unknown }).history)
        && (stored as { history: Array<{ status?: unknown }> }).history
          .some((task) => task?.status === "running"),
      );
      if (hadRunningTask) void persist(next).catch((reason) => setError(migrationError(reason)));
    }).catch((reason) => {
      if (!cancelled) setError(migrationError(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [persist]);

  const updateDraft = useCallback((repoPath: string, settings: ImageMigrationSettings) => {
    if (!repoPath) return;
    const next: ImageMigrationWorkspaceState = {
      ...workspaceRef.current,
      drafts: { ...workspaceRef.current.drafts, [repoPath]: settings },
      updatedAt: Date.now(),
    };
    commit(next);
  }, [commit]);

  const startMigration = useCallback(async (input: MigrationStartInput) => {
    if (workspaceRef.current.history.some(
      (task) => task.repoPath === input.repoPath && task.status === "running",
    )) {
      throw new Error("当前操作库已有迁移任务运行中");
    }
    const startedAt = Date.now();
    const running: ImageMigrationTaskRecord = {
      id: createTaskId(startedAt),
      status: "running",
      repoPath: input.repoPath,
      settings: { ...input.settings },
      library: {
        ...input.library,
        config: {
          ...input.library.config,
          remote: { ...input.library.config.remote },
        },
      },
      imagePaths: [...input.imagePaths],
      noteCount: input.noteCount,
      startedAt,
    };
    commit(upsertMigrationTask(workspaceRef.current, running, startedAt));
    setError(null);

    try {
      const result = await invoke<GitHubImageMigrationReport>("attachments_migrate_github_images", {
        repoPath: input.repoPath,
        imagePaths: input.imagePaths,
        config: input.library.config,
        localFilePolicy: input.settings.localFilePolicy,
      });
      const failures = result.failed.length + result.failedNotes.length + result.failedDeletes.length;
      const completed: ImageMigrationTaskRecord = {
        ...running,
        status: failures > 0 ? "partial" : "succeeded",
        finishedAt: Date.now(),
        result,
      };
      commit(upsertMigrationTask(workspaceRef.current, completed, completed.finishedAt));
      try {
        await onCompleted();
      } catch (reason) {
        setError(migrationError(reason));
      }
    } catch (reason) {
      const failed: ImageMigrationTaskRecord = {
        ...running,
        status: "failed",
        finishedAt: Date.now(),
        error: migrationError(reason),
      };
      commit(upsertMigrationTask(workspaceRef.current, failed, failed.finishedAt));
    }
  }, [commit, onCompleted]);

  return {
    loading,
    error,
    drafts: workspace.drafts,
    history: workspace.history,
    updateDraft,
    startMigration,
  };
}

function createTaskId(now: number) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `migration-${now}-${Math.random().toString(36).slice(2)}`;
}
