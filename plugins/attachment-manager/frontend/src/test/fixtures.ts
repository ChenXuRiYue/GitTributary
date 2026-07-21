import type { AttachmentItem, AttachmentScanReport } from "../types";

export function attachment(overrides: Partial<AttachmentItem> = {}): AttachmentItem {
  return {
    path: "assets/image.png",
    name: "image.png",
    extension: "png",
    kind: "image",
    mimeType: "image/png",
    size: 1024,
    modifiedAt: 1_700_000_000,
    url: null,
    references: [{ notePath: "README.md", line: 1, role: "embed" }],
    ...overrides,
  };
}

export function scanReport(items: AttachmentItem[] = []): AttachmentScanReport {
  return {
    repoPath: "/fixtures/notes",
    scannedAt: 1_700_000_000,
    durationMs: 12,
    notesScanned: 3,
    skippedEntries: 0,
    totalSize: items.reduce((sum, item) => sum + item.size, 0),
    attachments: items,
  };
}
