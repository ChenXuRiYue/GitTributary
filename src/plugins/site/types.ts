export type SitePhase = "idle" | "scanning" | "ready" | "building" | "succeeded" | "failed";
export type SitePathKind = "file" | "dir";
export type CaptureViewMode = "tree" | "list";
export type SiteTheme = "typora-light" | "typora-dark";
export type PublishCandidateStatus = "ready" | "needs-local" | "not-recommended";

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

export interface SiteBuildUiState {
  version: 1 | 2;
  repoPath: string;
  outputDir: string;
  siteTitle: string;
  include: string[];
  hasSelectionState: boolean;
  captureViewMode: CaptureViewMode;
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

export interface SitePublishTargetState {
  version: 1;
  id: string;
  name: string;
  sourceRepoPath: string;
  targetRepoId: string;
  targetRepoName: string;
  targetRepoUrl: string;
  targetLocalPath: string;
  targetBranch: string;
  publishDir: string;
  remoteName: string;
  pagesUrl: string;
  autoCommitMessage: string;
  updatedAt: number;
}

export interface SitePublishDraft {
  targetBranch: string;
  publishDir: string;
  pagesUrl: string;
  autoCommitMessage: string;
}
