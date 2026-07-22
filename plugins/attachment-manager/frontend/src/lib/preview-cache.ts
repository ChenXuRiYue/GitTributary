import { invoke } from "@tauri-apps/api/core";

import type {
  AttachmentItem,
  AttachmentPreview,
  AttachmentPreviewChunk,
  AttachmentPreviewDescriptor,
} from "../types";

const MAX_PREVIEW_CACHE_ITEMS = 80;
const MAX_PREVIEW_CACHE_DATA_CHARS = 96 * 1024 * 1024;
const previewCache = new Map<string, AttachmentPreview>();
const previewRequests = new Map<string, Promise<AttachmentPreview>>();
let previewCacheDataChars = 0;

export function previewKey(repoPath: string, item: AttachmentItem): string {
  return `${repoPath}\0${item.path}\0${item.modifiedAt ?? 0}\0${item.size}`;
}

export function getCachedAttachmentPreview(key: string): AttachmentPreview | null {
  return previewCache.get(key) ?? null;
}

function cachePreview(key: string, preview: AttachmentPreview): void {
  const existing = previewCache.get(key);
  if (existing) {
    previewCacheDataChars -= existing.dataUrl.length;
    previewCache.delete(key);
  }
  previewCache.set(key, preview);
  previewCacheDataChars += preview.dataUrl.length;
  while (
    previewCache.size > MAX_PREVIEW_CACHE_ITEMS
    || (previewCacheDataChars > MAX_PREVIEW_CACHE_DATA_CHARS && previewCache.size > 1)
  ) {
    const oldest = previewCache.keys().next().value;
    if (typeof oldest !== "string") break;
    const removed = previewCache.get(oldest);
    if (removed) previewCacheDataChars -= removed.dataUrl.length;
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

  const request = invoke<AttachmentPreview | AttachmentPreviewDescriptor>("attachments_preview", {
    repoPath,
    path: item.path,
  }).then(async (response) => {
    if ("dataUrl" in response) return response;

    const chunks: string[] = [];
    let offset = 0;
    let complete = response.size === 0;
    while (offset < response.size) {
      const chunk = await invoke<AttachmentPreviewChunk>("attachments_preview_chunk", {
        repoPath,
        path: item.path,
        offset,
        expectedSize: response.size,
      });
      if (
        chunk.offset !== offset
        || chunk.nextOffset <= offset
        || chunk.nextOffset > response.size
      ) {
        throw new Error("invalid_preview_chunk");
      }
      chunks.push(chunk.data);
      offset = chunk.nextOffset;
      complete = chunk.done;
      if (chunk.done && offset !== response.size) {
        throw new Error("incomplete_preview_data");
      }
    }
    if (!complete) throw new Error("incomplete_preview_data");

    return {
      path: response.path,
      mimeType: response.mimeType,
      dataUrl: `data:${response.mimeType};base64,${chunks.join("")}`,
    };
  }).then((preview) => {
    cachePreview(key, preview);
    return preview;
  }).finally(() => {
    previewRequests.delete(key);
  });
  previewRequests.set(key, request);
  return request;
}
