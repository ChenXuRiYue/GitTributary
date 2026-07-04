import type {
  CaptureViewMode,
  SiteActiveRepoState,
  SiteBuildUiState,
  SitePublishTarget,
  SiteRunRecord,
  SiteWorkspaceConfigState,
  SiteWorkspaceEnvVar,
  SiteWorkspaceGroup,
} from "./types";

export const pathCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const SITE_STATE_NS = "sites";
export const SITE_STATE_KEY_PREFIX = "build.";
/** @deprecated 发布参数已合并进 `SiteWorkspaceGroup.target`；此前缀仅用于读取旧数据做一次性迁移。 */
export const SITE_LEGACY_PUBLISH_KEY_PREFIX = "publish.";
export const SITE_ACTIVE_REPO_KEY = "repo.active";
export const SITE_WORKSPACE_CONFIG_KEY = "workspace.config";
/** 每个发布任务保留的最近执行记录条数上限，超出的旧记录会被丢弃。 */
export const SITE_RUN_HISTORY_LIMIT = 10;

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function siteStateKey(repoPath: string) {
  return `${SITE_STATE_KEY_PREFIX}${stableHash(repoPath)}`;
}

/** @deprecated 仅用于定位旧的独立发布目标记录以迁移，新逻辑不应再写入此 key。 */
export function legacySitePublishKey(repoPath: string) {
  return `${SITE_LEGACY_PUBLISH_KEY_PREFIX}${stableHash(repoPath)}`;
}

export function isCaptureViewMode(value: unknown): value is CaptureViewMode {
  return value === "tree" || value === "list";
}

export function parseSiteActiveRepoState(value: unknown): SiteActiveRepoState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SiteActiveRepoState>;
  if (state.version !== 1) return null;
  if (typeof state.repoPath !== "string" || state.repoPath.trim().length === 0) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    repoPath: state.repoPath,
    updatedAt: state.updatedAt,
  };
}

export function parseSiteBuildUiState(value: unknown): SiteBuildUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SiteBuildUiState>;
  if (state.version !== 1 && state.version !== 2) return null;
  if (typeof state.repoPath !== "string") return null;
  if (typeof state.outputDir !== "string") return null;
  if (typeof state.siteTitle !== "string") return null;
  if (!Array.isArray(state.include) || state.include.some((item) => typeof item !== "string")) return null;
  if (state.theme !== "typora-light" && state.theme !== "typora-dark") return null;
  if (typeof state.withSearch !== "boolean") return null;
  if (typeof state.copyAssets !== "boolean") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  const openPaths = Array.isArray(state.openPaths) && state.openPaths.every((item) => typeof item === "string")
    ? state.openPaths
    : null;
  return {
    version: state.version,
    repoPath: state.repoPath,
    outputDir: state.outputDir,
    siteTitle: state.siteTitle,
    include: state.include,
    hasSelectionState: state.version >= 2 ? state.hasSelectionState !== false : state.include.length > 0,
    captureViewMode: isCaptureViewMode(state.captureViewMode) ? state.captureViewMode : "tree",
    openPaths,
    theme: state.theme,
    withSearch: state.withSearch,
    copyAssets: state.copyAssets,
    updatedAt: state.updatedAt,
  };
}

/**
 * 解析旧版独立发布目标记录 (`sites/publish.<hash>`)，仅用于一次性迁移到
 * `SiteWorkspaceGroup.target`。新代码不应再依赖此形状做常规读写。
 */
export function parseLegacySitePublishTarget(value: unknown): SitePublishTarget | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SitePublishTarget> & { version?: unknown };
  if (state.version !== 1) return null;
  if (typeof state.targetRepoId !== "string" || !state.targetRepoId.trim()) return null;
  if (typeof state.targetRepoName !== "string") return null;
  if (typeof state.targetRepoUrl !== "string") return null;
  if (typeof state.targetLocalPath !== "string") return null;
  if (typeof state.targetBranch !== "string") return null;
  if (typeof state.publishDir !== "string") return null;
  if (typeof state.remoteName !== "string") return null;
  if (typeof state.pagesUrl !== "string") return null;
  if (typeof state.autoCommitMessage !== "string") return null;
  return {
    targetRepoId: state.targetRepoId,
    targetRepoName: state.targetRepoName,
    targetRepoUrl: state.targetRepoUrl,
    targetLocalPath: state.targetLocalPath,
    targetBranch: state.targetBranch,
    publishDir: state.publishDir,
    remoteName: state.remoteName,
    credentialRef: typeof state.credentialRef === "string" ? state.credentialRef : null,
    pagesUrl: state.pagesUrl,
    autoCommitMessage: state.autoCommitMessage,
  };
}

function parseWorkspaceEnvVar(value: unknown): SiteWorkspaceEnvVar | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SiteWorkspaceEnvVar>;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  if (typeof item.key !== "string") return null;
  if (typeof item.value !== "string") return null;
  if (typeof item.enabled !== "boolean") return null;
  return {
    id: item.id,
    key: item.key,
    value: item.value,
    enabled: item.enabled,
  };
}

function parsePublishTarget(value: unknown): SitePublishTarget | null {
  if (!value || typeof value !== "object") return null;
  const target = value as Partial<SitePublishTarget>;
  if (typeof target.targetRepoId !== "string" || !target.targetRepoId.trim()) return null;
  if (typeof target.targetRepoName !== "string") return null;
  if (typeof target.targetRepoUrl !== "string") return null;
  if (typeof target.targetLocalPath !== "string") return null;
  if (typeof target.targetBranch !== "string") return null;
  if (typeof target.publishDir !== "string") return null;
  if (typeof target.remoteName !== "string") return null;
  if (typeof target.pagesUrl !== "string") return null;
  if (typeof target.autoCommitMessage !== "string") return null;
  return {
    targetRepoId: target.targetRepoId,
    targetRepoName: target.targetRepoName,
    targetRepoUrl: target.targetRepoUrl,
    targetLocalPath: target.targetLocalPath,
    targetBranch: target.targetBranch,
    publishDir: target.publishDir,
    remoteName: target.remoteName,
    credentialRef: typeof target.credentialRef === "string" ? target.credentialRef : null,
    pagesUrl: target.pagesUrl,
    autoCommitMessage: target.autoCommitMessage,
  };
}

function parseRunRecord(value: unknown): SiteRunRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SiteRunRecord>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  if (record.kind !== "build" && record.kind !== "publish") return null;
  if (record.status !== "succeeded" && record.status !== "failed") return null;
  if (typeof record.message !== "string") return null;
  if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt)) return null;
  if (typeof record.durationMs !== "number" || !Number.isFinite(record.durationMs)) return null;
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    message: record.message,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    pageCount: typeof record.pageCount === "number" ? record.pageCount : undefined,
    assetCount: typeof record.assetCount === "number" ? record.assetCount : undefined,
    commit: typeof record.commit === "string" ? record.commit : (record.commit === null ? null : undefined),
  };
}

function parseWorkspaceGroup(value: unknown): SiteWorkspaceGroup | null {
  if (!value || typeof value !== "object") return null;
  const group = value as Partial<SiteWorkspaceGroup>;
  if (typeof group.id !== "string" || !group.id.trim()) return null;
  if (typeof group.name !== "string") return null;
  if (typeof group.sourceRepoPath !== "string") return null;
  if (!Array.isArray(group.env)) return null;
  if (typeof group.updatedAt !== "number" || !Number.isFinite(group.updatedAt)) return null;
  const env = group.env.map(parseWorkspaceEnvVar).filter((item): item is SiteWorkspaceEnvVar => Boolean(item));
  // 旧数据没有 documentScope/runHistory 字段，容错为空数组，由调用方决定是否从
  // 遗留的 `sites/build.<hash>` 记录里补一次迁移。
  const documentScope = Array.isArray(group.documentScope)
    ? group.documentScope.filter((item): item is string => typeof item === "string")
    : [];
  const runHistory = Array.isArray(group.runHistory)
    ? group.runHistory.map(parseRunRecord).filter((item): item is SiteRunRecord => Boolean(item)).slice(0, SITE_RUN_HISTORY_LIMIT)
    : [];
  return {
    id: group.id,
    name: group.name,
    sourceRepoPath: group.sourceRepoPath,
    documentScope,
    target: parsePublishTarget(group.target),
    env,
    runHistory,
    updatedAt: group.updatedAt,
  };
}

export function parseSiteWorkspaceConfigState(value: unknown): SiteWorkspaceConfigState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SiteWorkspaceConfigState>;
  if (state.version !== 1) return null;
  if (state.activeGroupId !== null && typeof state.activeGroupId !== "string") return null;
  if (!Array.isArray(state.groups)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  const groups = state.groups.map(parseWorkspaceGroup).filter((group): group is SiteWorkspaceGroup => Boolean(group));
  const activeGroupExists = !state.activeGroupId || groups.some((group) => group.id === state.activeGroupId);
  return {
    version: 1,
    activeGroupId: activeGroupExists ? state.activeGroupId : groups[0]?.id ?? null,
    groups,
    updatedAt: state.updatedAt,
  };
}

/** 把一条新的执行记录插入历史列表最前面，并裁剪到 SITE_RUN_HISTORY_LIMIT 条。 */
export function pushRunRecord(history: SiteRunRecord[], record: SiteRunRecord): SiteRunRecord[] {
  return [record, ...history].slice(0, SITE_RUN_HISTORY_LIMIT);
}

export function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path;
}

export function defaultTitleFromRepo(repoPath: string, fallback = "Git Tributary Site") {
  const parts = repoPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : fallback;
}

export function formatDuration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
