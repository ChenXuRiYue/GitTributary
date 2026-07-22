import { describe, expect, it } from "vitest";

import { attachment } from "../test/fixtures";
import {
  absolutePath,
  attachmentErrorMessage,
  attachmentTypeLabel,
  canPreviewAttachment,
  canPreviewImage,
  formatBytes,
  formatDate,
  repositoryLabel,
} from "./attachment";

describe("attachment presentation helpers", () => {
  it("formats every byte unit boundary", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1_536)).toBe("1.5 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("formats known dates and preserves the unknown state", () => {
    expect(formatDate(null)).toBe("未知");
    expect(formatDate(1_700_000_000)).not.toBe("未知");
  });

  it("normalizes preview and repository errors without hiding unknown diagnostics", () => {
    expect(attachmentErrorMessage(new Error("preview_file_too_large"))).toBe("音频文件超过 24 MB，请使用系统应用打开");
    expect(attachmentErrorMessage("repository_not_open")).toBe("请先打开一个 Git 仓库");
    expect(attachmentErrorMessage("custom_failure")).toBe("custom_failure");
  });

  it("builds platform-aware absolute paths and compact repository labels", () => {
    expect(absolutePath("/repo/", "assets/image.png")).toBe("/repo/assets/image.png");
    expect(absolutePath("C:\\repo\\", "assets/image.png")).toBe("C:\\repo\\assets\\image.png");
    expect(repositoryLabel("/repo/notes")).toBe("notes");
    expect(repositoryLabel("C:\\repo\\notes")).toBe("notes");
    expect(repositoryLabel("/")).toBe("/");
    expect(repositoryLabel(undefined)).toBe("当前仓库");
  });

  it("labels and classifies local and remote preview capabilities", () => {
    const local = attachment();
    const remoteImage = attachment({ kind: "link", linkKind: "image", url: "https://example.com/a.png" });
    const remoteAudio = attachment({ kind: "link", linkKind: "audio", mimeType: "audio/mpeg" });
    const website = attachment({ kind: "link", linkKind: "website", mimeType: "text/html" });
    const unknown = attachment({ kind: "link", linkKind: null });
    expect(attachmentTypeLabel(local)).toBe("图片");
    expect(attachmentTypeLabel(remoteImage)).toBe("图片链接");
    expect(attachmentTypeLabel(unknown)).toBe("未知链接");
    expect(canPreviewAttachment(local)).toBe(true);
    expect(canPreviewAttachment(remoteAudio)).toBe(true);
    expect(canPreviewAttachment(website)).toBe(false);
    expect(canPreviewImage(remoteImage)).toBe(true);
    expect(canPreviewImage(website, "image/webp")).toBe(true);
    expect(canPreviewImage(website)).toBe(false);
  });
});
