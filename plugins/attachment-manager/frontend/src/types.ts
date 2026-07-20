export type AttachmentKind = "image" | "audio" | "link";

export interface AttachmentReference {
  notePath: string;
  line: number;
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
