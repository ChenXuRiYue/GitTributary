import type {
  CaptureViewMode,
  SiteActiveRepoState,
  SiteBuildUiState,
  SitePublishTargetState,
} from "./types";

export const pathCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const SITE_STATE_NS = "sites";
export const SITE_STATE_KEY_PREFIX = "build.";
export const SITE_PUBLISH_KEY_PREFIX = "publish.";
export const SITE_ACTIVE_REPO_KEY = "repo.active";

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

export function sitePublishKey(repoPath: string) {
  return `${SITE_PUBLISH_KEY_PREFIX}${stableHash(repoPath)}`;
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

export function parseSitePublishTargetState(value: unknown): SitePublishTargetState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SitePublishTargetState>;
  if (state.version !== 1) return null;
  if (typeof state.id !== "string" || !state.id.trim()) return null;
  if (typeof state.name !== "string") return null;
  if (typeof state.sourceRepoPath !== "string") return null;
  if (typeof state.targetRepoId !== "string" || !state.targetRepoId.trim()) return null;
  if (typeof state.targetRepoName !== "string") return null;
  if (typeof state.targetRepoUrl !== "string") return null;
  if (typeof state.targetLocalPath !== "string") return null;
  if (typeof state.targetBranch !== "string") return null;
  if (typeof state.publishDir !== "string") return null;
  if (typeof state.remoteName !== "string") return null;
  if (typeof state.pagesUrl !== "string") return null;
  if (typeof state.autoCommitMessage !== "string") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    id: state.id,
    name: state.name,
    sourceRepoPath: state.sourceRepoPath,
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
    updatedAt: state.updatedAt,
  };
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
