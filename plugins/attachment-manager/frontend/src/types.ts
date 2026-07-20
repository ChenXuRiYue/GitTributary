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

export interface WorkspaceInfo {
  active_repo: string | null;
}
