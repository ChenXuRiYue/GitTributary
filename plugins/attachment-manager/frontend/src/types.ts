export type AttachmentKind = "image" | "audio" | "video" | "document";

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
  references: AttachmentReference[];
}

export interface AttachmentScanReport {
  repoPath: string;
  scannedAt: number;
  durationMs: number;
  notesScanned: number;
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
