import type {
  GitHubImageMigrationFailure,
  GitHubImageMigrationReport,
  ImageMigrationSettings,
  ImageMigrationTaskRecord,
  ImageMigrationWorkspaceState,
} from "../../types";

export const MIGRATION_WORKSPACE_KEY = "migration-workspace.v1";
export const MIGRATION_HISTORY_LIMIT = 20;

export function defaultMigrationSettings(targetLibraryId = ""): ImageMigrationSettings {
  return {
    version: 1,
    targetLibraryId,
    localFilePolicy: "keep",
    fileScope: {
      mode: "manual",
      manualFolders: null,
      rules: "",
    },
  };
}

export function emptyMigrationWorkspace(now = Date.now()): ImageMigrationWorkspaceState {
  return { version: 1, drafts: {}, history: [], updatedAt: now };
}

export function parseMigrationWorkspace(
  value: unknown,
  now = Date.now(),
): ImageMigrationWorkspaceState {
  if (!value || typeof value !== "object") return emptyMigrationWorkspace(now);
  const stored = value as Partial<ImageMigrationWorkspaceState>;
  if (stored.version !== 1 || !stored.drafts || typeof stored.drafts !== "object") {
    return emptyMigrationWorkspace(now);
  }

  const drafts = Object.fromEntries(
    Object.entries(stored.drafts)
      .filter(([repoPath, settings]) => repoPath.length > 0 && isMigrationSettings(settings)),
  );
  const history = Array.isArray(stored.history)
    ? stored.history
      .map(parseTaskRecord)
      .filter((task): task is ImageMigrationTaskRecord => task !== null)
      .map((task) => task.status === "running" ? ({
        ...task,
        status: "interrupted" as const,
        finishedAt: now,
        error: "应用退出时迁移尚未完成",
      }) : task)
      .slice(0, MIGRATION_HISTORY_LIMIT)
    : [];
  return {
    version: 1,
    drafts,
    history,
    updatedAt: typeof stored.updatedAt === "number" && Number.isFinite(stored.updatedAt)
      ? stored.updatedAt
      : now,
  };
}

export function upsertMigrationTask(
  state: ImageMigrationWorkspaceState,
  task: ImageMigrationTaskRecord,
  now = Date.now(),
): ImageMigrationWorkspaceState {
  return {
    ...state,
    history: [task, ...state.history.filter((item) => item.id !== task.id)]
      .slice(0, MIGRATION_HISTORY_LIMIT),
    updatedAt: now,
  };
}

function isMigrationSettings(value: unknown): value is ImageMigrationSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<ImageMigrationSettings>;
  return settings.version === 1
    && typeof settings.targetLibraryId === "string"
    && (settings.localFilePolicy === "keep" || settings.localFilePolicy === "delete_after_success")
    && (settings.fileScope === undefined || isFileScope(settings.fileScope));
}

function isFileScope(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const scope = value as Record<string, unknown>;
  return (scope.mode === "manual" || scope.mode === "rules")
    && (scope.manualFolders === null || (
      Array.isArray(scope.manualFolders)
      && scope.manualFolders.every((path) => typeof path === "string")
    ))
    && typeof scope.rules === "string";
}

function parseTaskRecord(value: unknown): ImageMigrationTaskRecord | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<ImageMigrationTaskRecord>;
  if (
    typeof task.id !== "string" || !task.id
    || !isTaskStatus(task.status)
    || typeof task.repoPath !== "string" || !task.repoPath
    || !isMigrationSettings(task.settings)
    || !isLibrarySnapshot(task.library)
    || !Array.isArray(task.imagePaths)
    || task.imagePaths.some((path) => typeof path !== "string")
    || typeof task.noteCount !== "number" || !Number.isFinite(task.noteCount)
    || typeof task.startedAt !== "number" || !Number.isFinite(task.startedAt)
  ) return null;
  const parsedResult = task.result === undefined ? undefined : parseMigrationReport(task.result);
  if (task.result !== undefined && !parsedResult) return null;
  return {
    id: task.id,
    status: task.status,
    repoPath: task.repoPath,
    settings: task.settings,
    library: task.library,
    imagePaths: task.imagePaths,
    noteCount: task.noteCount,
    startedAt: task.startedAt,
    finishedAt: typeof task.finishedAt === "number" && Number.isFinite(task.finishedAt)
      ? task.finishedAt
      : undefined,
    result: parsedResult ?? undefined,
    error: typeof task.error === "string" ? task.error : undefined,
  };
}

function isTaskStatus(value: unknown): value is ImageMigrationTaskRecord["status"] {
  return value === "running"
    || value === "succeeded"
    || value === "partial"
    || value === "failed"
    || value === "interrupted";
}

function isLibrarySnapshot(value: unknown): value is ImageMigrationTaskRecord["library"] {
  if (!value || typeof value !== "object") return false;
  const library = value as Partial<ImageMigrationTaskRecord["library"]>;
  const config = library.config;
  const remote = config?.remote;
  return typeof library.id === "string" && Boolean(library.id)
    && typeof library.name === "string"
    && Boolean(config)
    && typeof config?.branch === "string"
    && typeof config?.directory === "string"
    && Boolean(remote)
    && typeof remote?.repoPath === "string"
    && typeof remote?.name === "string"
    && typeof remote?.url === "string";
}

function parseMigrationReport(value: unknown): GitHubImageMigrationReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<GitHubImageMigrationReport>;
  if (
    !Array.isArray(report.migrated)
    || !Array.isArray(report.failed) || !report.failed.every(isFailure)
    || !Array.isArray(report.failedNotes) || !report.failedNotes.every(isFailure)
    || !Array.isArray(report.failedDeletes) || !report.failedDeletes.every(isFailure)
    || !Array.isArray(report.changedNotePaths)
    || report.changedNotePaths.some((path) => typeof path !== "string")
    || !Array.isArray(report.deletedLocalPaths)
    || report.deletedLocalPaths.some((path) => typeof path !== "string")
    || typeof report.changedNotes !== "number"
    || typeof report.replacedReferences !== "number"
    || typeof report.durationMs !== "number"
  ) return null;
  const migrated = report.migrated.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const migration = item as unknown as Record<string, unknown>;
    if (
      typeof migration.localPath !== "string"
      || typeof migration.remotePath !== "string"
      || typeof migration.url !== "string"
      || typeof migration.uploaded !== "boolean"
    ) return [];
    return [{
      localPath: migration.localPath,
      remotePath: migration.remotePath,
      url: migration.url,
      uploaded: migration.uploaded,
    }];
  });
  if (migrated.length !== report.migrated.length) return null;
  return {
    migrated,
    failed: report.failed,
    failedNotes: report.failedNotes,
    failedDeletes: report.failedDeletes,
    changedNotePaths: report.changedNotePaths,
    deletedLocalPaths: report.deletedLocalPaths,
    changedNotes: report.changedNotes,
    replacedReferences: report.replacedReferences,
    durationMs: report.durationMs,
  };
}

function isFailure(value: unknown): value is GitHubImageMigrationFailure {
  if (!value || typeof value !== "object") return false;
  const failure = value as Partial<GitHubImageMigrationFailure>;
  return typeof failure.path === "string" && typeof failure.error === "string";
}
