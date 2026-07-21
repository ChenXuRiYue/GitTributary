import type { AttachmentItem, AttachmentKind, LinkKind } from "../types";

export const attachmentKindLabels: Record<AttachmentKind, string> = {
  image: "图片",
  audio: "音频",
  link: "链接",
};

export const linkKindLabels: Record<LinkKind, string> = {
  image: "图片链接",
  audio: "音频链接",
  video: "视频链接",
  website: "网站",
  download: "下载链接",
  unknown: "未知链接",
};

export const referenceRoleLabels = {
  embed: "嵌入资源",
  navigation: "导航链接",
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDate(seconds: number | null): string {
  if (!seconds) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(seconds * 1000));
}

export function attachmentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("preview_file_too_large")) return "文件超过 24 MB，请使用系统应用打开";
  if (message.includes("repository_not_open")) return "请先打开一个 Git 仓库";
  return message;
}

export function absolutePath(root: string, relative: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${separator}${relative.split("/").join(separator)}`;
}

export function repositoryLabel(path: string | undefined): string {
  if (!path) return "当前仓库";
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function attachmentTypeLabel(item: AttachmentItem): string {
  if (item.kind !== "link") return attachmentKindLabels[item.kind];
  return item.linkKind ? linkKindLabels[item.linkKind] : "未知链接";
}

export function canPreviewAttachment(item: AttachmentItem): boolean {
  if (item.kind !== "link") return true;
  return item.linkKind === "image" || item.linkKind === "audio";
}

export function canPreviewImage(item: AttachmentItem, mimeType = item.mimeType): boolean {
  return item.kind === "image" || item.linkKind === "image" || mimeType.startsWith("image/");
}
