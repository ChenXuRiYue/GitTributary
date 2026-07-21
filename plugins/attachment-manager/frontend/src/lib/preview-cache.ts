import { invoke } from "@tauri-apps/api/core";

import type { AttachmentItem, AttachmentPreview } from "../types";

const MAX_PREVIEW_CACHE_ITEMS = 80;
const previewCache = new Map<string, AttachmentPreview>();
const previewRequests = new Map<string, Promise<AttachmentPreview>>();

export function previewKey(repoPath: string, item: AttachmentItem): string {
  return `${repoPath}\0${item.path}\0${item.modifiedAt ?? 0}\0${item.size}`;
}

export function getCachedAttachmentPreview(key: string): AttachmentPreview | null {
  return previewCache.get(key) ?? null;
}

function cachePreview(key: string, preview: AttachmentPreview): void {
  previewCache.set(key, preview);
  while (previewCache.size > MAX_PREVIEW_CACHE_ITEMS) {
    const oldest = previewCache.keys().next().value;
    if (typeof oldest !== "string") break;
    previewCache.delete(oldest);
  }
}

export function loadAttachmentPreview(
  repoPath: string,
  item: AttachmentItem,
): Promise<AttachmentPreview> {
  const key = previewKey(repoPath, item);
  const cached = previewCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = previewRequests.get(key);
  if (pending) return pending;

  if (item.kind === "link") {
    const preview = {
      path: item.path,
      mimeType: item.mimeType,
      dataUrl: item.url ?? item.path,
    };
    cachePreview(key, preview);
    return Promise.resolve(preview);
  }

  const request = invoke<AttachmentPreview>("attachments_preview", {
    repoPath,
    path: item.path,
  }).then((preview) => {
    cachePreview(key, preview);
    return preview;
  }).finally(() => {
    previewRequests.delete(key);
  });
  previewRequests.set(key, request);
  return request;
}
