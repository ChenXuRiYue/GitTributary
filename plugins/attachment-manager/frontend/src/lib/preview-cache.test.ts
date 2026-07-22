import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachment } from "../test/fixtures";
import type { AttachmentPreview } from "../types";
import {
  getCachedAttachmentPreview,
  loadAttachmentPreview,
  previewKey,
} from "./preview-cache";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("attachment preview cache", () => {
  it("uses a stable key containing repository, file metadata, and path", () => {
    const item = attachment({ path: "assets/key.png", modifiedAt: null, size: 42 });
    expect(previewKey("/repo", item)).toBe(["/repo", "assets/key.png", "0", "42"].join("\0"));
    expect(getCachedAttachmentPreview(previewKey("/missing", item))).toBeNull();
  });

  it("loads local previews once and serves later requests from cache", async () => {
    const item = attachment({ path: "assets/cache.png" });
    const preview: AttachmentPreview = {
      path: item.path,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AA==",
    };
    mockedInvoke.mockResolvedValue(preview as never);
    await expect(loadAttachmentPreview("/repo", item)).resolves.toEqual(preview);
    await expect(loadAttachmentPreview("/repo", item)).resolves.toEqual(preview);
    expect(mockedInvoke).toHaveBeenCalledOnce();
    expect(mockedInvoke).toHaveBeenCalledWith("attachments_preview", {
      repoPath: "/repo",
      path: item.path,
    });
    expect(getCachedAttachmentPreview(previewKey("/repo", item))).toEqual(preview);
  });

  it("deduplicates concurrent local preview requests", async () => {
    const item = attachment({ path: "assets/concurrent.png" });
    let resolvePreview: ((preview: AttachmentPreview) => void) | undefined;
    mockedInvoke.mockReturnValue(new Promise((resolve) => { resolvePreview = resolve; }) as never);
    const first = loadAttachmentPreview("/repo", item);
    const second = loadAttachmentPreview("/repo", item);
    expect(mockedInvoke).toHaveBeenCalledOnce();
    resolvePreview?.({ path: item.path, mimeType: "image/png", dataUrl: "data:image/png;base64,AQ==" });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("assembles large local previews from bounded backend chunks", async () => {
    const item = attachment({ path: "assets/chunked.png", size: 4 });
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "attachments_preview") {
        return {
          path: item.path,
          mimeType: "image/png",
          size: 4,
          chunkSize: 3,
        } as never;
      }
      const payload = args as { offset: number; expectedSize: number };
      expect(command).toBe("attachments_preview_chunk");
      expect(payload.expectedSize).toBe(4);
      return (payload.offset === 0
        ? { path: item.path, offset: 0, nextOffset: 3, data: "YWJj", done: false }
        : { path: item.path, offset: 3, nextOffset: 4, data: "ZA==", done: true }) as never;
    });

    await expect(loadAttachmentPreview("/repo", item)).resolves.toEqual({
      path: item.path,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,YWJjZA==",
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "attachments_preview_chunk", {
      repoPath: "/repo",
      path: item.path,
      offset: 0,
      expectedSize: 4,
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(3, "attachments_preview_chunk", {
      repoPath: "/repo",
      path: item.path,
      offset: 3,
      expectedSize: 4,
    });
  });

  it("builds remote previews without invoking the plugin backend", async () => {
    const item = attachment({
      path: "https://example.com/image.png",
      kind: "link",
      linkKind: "image",
      url: "https://cdn.example.com/image.png",
    });
    await expect(loadAttachmentPreview("/repo", item)).resolves.toEqual({
      path: item.path,
      mimeType: item.mimeType,
      dataUrl: item.url,
    });
    const linkWithoutUrl = attachment({
      path: "https://example.com/fallback.png",
      kind: "link",
      linkKind: "image",
      url: null,
    });
    await expect(loadAttachmentPreview("/repo", linkWithoutUrl)).resolves.toMatchObject({
      dataUrl: linkWithoutUrl.path,
    });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
