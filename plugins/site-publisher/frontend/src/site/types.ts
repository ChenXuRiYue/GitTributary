export type SitePhase = "idle" | "scanning" | "ready" | "building" | "publishing" | "succeeded" | "failed";
export type SitePathKind = "file" | "dir";
export type CaptureViewMode = "tree" | "list";
export type CaptureKindFilter = "all" | "dir" | "file";
export type CaptureSelectionFilter = "all" | "selected" | "unselected";
export type CaptureDefaultFilter = "all" | "default" | "custom";
export type CaptureSortMode = "path" | "score-desc" | "markdown-desc";
export type SiteTheme = "typora-light" | "typora-dark";
export type PublishCandidateStatus = "ready" | "needs-local" | "not-recommended";

export interface CaptureFilterState {
  query: string;
  kind: CaptureKindFilter;
  selection: CaptureSelectionFilter;
  defaultState: CaptureDefaultFilter;
  minMarkdownCount: number;
  sort: CaptureSortMode;
}

export interface WorkspaceInfo {
  active_repo: string | null;
  recent_repos: string[];
  device_id: string | null;
  device_name: string | null;
}

export interface SitePathCandidate {
  path: string;
  kind: SitePathKind;
  score: number;
  reason: string[];
  markdownCount: number;
  selectedByDefault: boolean;
}

export interface SiteScanReport {
  repoPath: string;
  repoName: string;
  candidates: SitePathCandidate[];
  ignored: { path: string; reason: string }[];
  markdownCount: number;
  assetCount: number;
  defaultOutputDir: string;
}

export interface SiteBuildConfig {
  repoPath: string;
  outputDir: string;
  siteTitle: string;
  include: string[];
  exclude: string[];
  theme: SiteTheme;
  withSearch: boolean;
  copyAssets: boolean;
}

export interface SiteBuildReport {
  outputDir: string;
  indexHtml: string;
  pageCount: number;
  assetCount: number;
  brokenLinks: { source: string; target: string; kind: string }[];
  warnings: { path: string; message: string }[];
  durationMs: number;
}

export interface SitePublishRequest {
  buildConfig: SiteBuildConfig;
  target: {
    targetLocalPath: string;
    targetBranch: string;
    publishDir: string;
    remoteName: string;
    credentialRef: string | null;
    pagesUrl: string;
    autoCommitMessage: string;
  };
}

export interface SitePublishReport {
  build: SiteBuildReport;
  targetRepoPath: string;
  publishDir: string;
  publishPath: string;
  branch: string;
  remoteName: string;
  pagesUrl: string;
  copiedFileCount: number;
  changedCount: number;
  commit: string | null;
  pushed: boolean;
  credentialMode: string;
  credentialRef: string | null;
  durationMs: number;
}

export interface SiteBuildUiState {
  version: 1 | 2 | 3;
  repoPath: string;
  outputDir: string;
  siteTitle: string;
  include: string[];
  hasSelectionState: boolean;
  captureViewMode: CaptureViewMode;
  captureFilters: CaptureFilterState;
  openPaths: string[] | null;
  theme: SiteTheme;
  withSearch: boolean;
  copyAssets: boolean;
  updatedAt: number;
}

export interface SiteActiveRepoState {
  version: 1;
  repoPath: string;
  updatedAt: number;
}

export interface SiteWorkspaceEnvVar {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

/** 发布任务上的目标仓库与发布参数。是发布任务的字段，不再是独立存储实体。 */
export interface SitePublishTarget {
  targetRepoId: string;
  targetRepoName: string;
  targetRepoUrl: string;
  targetLocalPath: string;
  targetBranch: string;
  publishDir: string;
  remoteName: string;
  credentialRef: string | null;
  pagesUrl: string;
  autoCommitMessage: string;
}

export interface SiteWorkspaceGroup {
  id: string;
  name: string;
  sourceRepoPath: string;
  /** 文档范围：本任务勾选参与构建的候选路径集合。任务自带此配置，不再依赖按仓库路径 hash 的独立 key。 */
  documentScope: string[];
  target: SitePublishTarget | null;
  env: SiteWorkspaceEnvVar[];
  /** 近期若干次执行 (构建/发布) 记录，最新的在前，仅保留有限条数 (见 SITE_RUN_HISTORY_LIMIT)。 */
  runHistory: SiteRunRecord[];
  updatedAt: number;
}

/** 单次构建或发布执行的摘要记录，用于「发布执行」工作台展示近期执行历史。 */
export type SiteRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface SiteRunRecord {
  id: string;
  kind: "build" | "publish";
  status: SiteRunStatus;
  message: string;
  startedAt: number;
  finishedAt?: number;
  durationMs: number;
  pageCount?: number;
  assetCount?: number;
  commit?: string | null;
}

export interface SiteWorkspaceConfigState {
  version: 1;
  activeGroupId: string | null;
  groups: SiteWorkspaceGroup[];
  updatedAt: number;
}

export interface CaptureTreeNode {
  name: string;
  path: string;
  children: CaptureTreeNode[];
  candidate?: SitePathCandidate;
}

export interface RemoteConfigEntry {
  name: string;
  url: string;
  push_url: string | null;
  repo_path: string | null;
  source: string;
  purpose: string[];
  credential_mode: string;
  credential_ref: string | null;
  commit_name: string | null;
  commit_email: string | null;
  verify_status: string;
  capabilities: string;
}

export interface PublishRepoCandidate {
  id: string;
  name: string;
  remoteName: string;
  url: string;
  pushUrl: string | null;
  repoPath: string | null;
  source: string;
  purpose: string[];
  credentialMode: string;
  credentialRef: string | null;
  verifyStatus: string;
  capabilities: string;
  status: PublishCandidateStatus;
  reason: string;
  recommended: boolean;
}

export interface SitePublishDraft {
  targetBranch: string;
  publishDir: string;
  pagesUrl: string;
  autoCommitMessage: string;
}
