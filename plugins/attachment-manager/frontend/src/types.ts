export type AttachmentKind = "image" | "audio" | "link";
export type LinkKind = "image" | "audio" | "video" | "website" | "download" | "unknown";
export type AttachmentReferenceRole = "embed" | "navigation";

export interface AttachmentReference {
  notePath: string;
  line: number;
  role?: AttachmentReferenceRole;
}

export interface AttachmentItem {
  path: string;
  name: string;
  extension: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  modifiedAt: number | null;
  url: string | null;
  linkKind?: LinkKind | null;
  domain?: string | null;
  references: AttachmentReference[];
}

export interface AttachmentScanReport {
  repoPath: string;
  scannedAt: number;
  durationMs: number;
  notesScanned: number;
  skippedEntries: number;
  totalSize: number;
  attachments: AttachmentItem[];
}

export interface AttachmentPreview {
  path: string;
  mimeType: string;
  dataUrl: string;
}

export interface AttachmentPreviewDescriptor {
  path: string;
  mimeType: string;
  size: number;
  chunkSize: number;
}

export interface AttachmentPreviewChunk {
  path: string;
  offset: number;
  nextOffset: number;
  data: string;
  done: boolean;
}

export interface WorkspaceInfo {
  active_repo: string | null;
}

export interface GitRemoteConfigEntry {
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

export interface GitRemoteBinding {
  repoPath: string;
  name: string;
  url: string;
}

export interface GitHubImageConfig {
  remote: GitRemoteBinding;
  branch: string;
  directory: string;
}

export interface GitHubImageLibrary {
  id: string;
  name: string;
  remote: GitRemoteBinding | null;
  branch: string;
  directory: string;
  suggestedRemoteUrl?: string;
}

export interface GitHubImageConfigCheck {
  repository: string;
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
}

export interface GitHubImageMigrationFailure {
  path: string;
  error: string;
}

export interface GitHubImageMigrationItem {
  localPath: string;
  remotePath: string;
  url: string;
  uploaded: boolean;
}

export interface GitHubImageMigrationReport {
  migrated: GitHubImageMigrationItem[];
  failed: GitHubImageMigrationFailure[];
  failedNotes: GitHubImageMigrationFailure[];
  failedDeletes: GitHubImageMigrationFailure[];
  changedNotePaths: string[];
  deletedLocalPaths: string[];
  changedNotes: number;
  replacedReferences: number;
  durationMs: number;
}

export type LocalFilePolicy = "keep" | "delete_after_success";

export type ImageMigrationFileScopeMode = "manual" | "rules";

export interface ImageMigrationFileScope {
  mode: ImageMigrationFileScopeMode;
  manualFolders: string[] | null;
  rules: string;
}

export interface ImageMigrationSettings {
  version: 1;
  targetLibraryId: string;
  localFilePolicy: LocalFilePolicy;
  fileScope?: ImageMigrationFileScope;
}

export interface ImageMigrationLibrarySnapshot {
  id: string;
  name: string;
  config: GitHubImageConfig;
}

export type ImageMigrationTaskStatus =
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "interrupted";

export interface ImageMigrationTaskRecord {
  id: string;
  status: ImageMigrationTaskStatus;
  repoPath: string;
  settings: ImageMigrationSettings;
  library: ImageMigrationLibrarySnapshot;
  imagePaths: string[];
  noteCount: number;
  startedAt: number;
  finishedAt?: number;
  result?: GitHubImageMigrationReport;
  error?: string;
}

export interface ImageMigrationWorkspaceState {
  version: 1;
  drafts: Record<string, ImageMigrationSettings>;
  history: ImageMigrationTaskRecord[];
  updatedAt: number;
}
