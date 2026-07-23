import { ArrowLeft, File, FolderOpen, Link2 } from "lucide-react";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

import { ResizeHandle } from "@/shared/components/ResizeHandle";
import { Button } from "@/shared/ui/button";

import {
  absolutePath,
  attachmentTypeLabel,
  formatBytes,
  formatDate,
  referenceRoleLabels,
} from "../../lib/attachment";
import type { AttachmentItem, AttachmentPreview as Preview } from "../../types";
import { AttachmentPreview } from "./AttachmentPreview";

export function AttachmentDetailPanel({
  item,
  repoPath,
  preview,
  previewLoading,
  previewError,
  width,
  onResize,
  onClose,
  onExpand,
}: {
  item: AttachmentItem;
  repoPath: string;
  preview: Preview | null;
  previewLoading: boolean;
  previewError: string | null;
  width: number;
  onResize: (value: number) => void;
  onClose: () => void;
  onExpand: () => void;
}) {
  const revealItem = () => {
    if (item.kind !== "link") void revealItemInDir(absolutePath(repoPath, item.path));
  };
  const openItem = () => {
    if (item.kind === "link") void openUrl(item.url ?? item.path);
    else void openPath(absolutePath(repoPath, item.path));
  };

  return (
    <>
      <ResizeHandle
        direction="horizontal"
        edge="start"
        size={width}
        onResize={onResize}
        minSize={240}
        snapTo={320}
        ariaLabel="调整详情栏宽度"
        className="max-[720px]:hidden"
      />
      <aside
        className="border-border/50 bg-background flex min-h-0 shrink-0 flex-col border-l max-[720px]:absolute max-[720px]:inset-y-0 max-[720px]:left-10 max-[720px]:z-20 max-[720px]:w-[calc(100%-2.5rem)]"
        style={{ width: `min(${width}px, calc(100vw - 2.5rem))` }}
      >
        <div className="border-border/50 flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1 size-7 min-[721px]:hidden"
            onClick={onClose}
            title="返回附件列表"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h2 className="na-title-panel min-w-0 truncate" title={item.name}>{item.name}</h2>
          <div className="flex shrink-0 items-center gap-1">
            {item.kind !== "link" && (
              <Button variant="ghost" size="icon" className="size-7" onClick={revealItem} title="在文件管理器中显示">
                <FolderOpen className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={openItem}
              title={item.kind === "link" ? "在浏览器中打开" : "使用系统应用打开"}
            >
              {item.kind === "link" ? <Link2 className="size-4" /> : <File className="size-4" />}
            </Button>
          </div>
        </div>
        <div className="na-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
          <AttachmentPreview
            item={item}
            preview={preview}
            loading={previewLoading}
            error={previewError}
            onExpand={onExpand}
          />
          <dl className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-2">
            <dt className="text-muted-foreground na-label">{item.kind === "link" ? "链接" : "路径"}</dt>
            <dd className="na-caption break-all">{item.url ?? item.path}</dd>
            <dt className="text-muted-foreground na-label">类型</dt>
            <dd className="na-body">
              {attachmentTypeLabel(item)}{item.extension ? ` · ${item.extension.toUpperCase()}` : ""}
            </dd>
            {item.kind === "link" && (
              <>
                <dt className="text-muted-foreground na-label">域名</dt>
                <dd className="na-body break-all">{item.domain ?? "未知"}</dd>
              </>
            )}
            <dt className="text-muted-foreground na-label">大小</dt>
            <dd className="na-body">{item.kind === "link" ? "远程资源" : formatBytes(item.size)}</dd>
            <dt className="text-muted-foreground na-label">修改时间</dt>
            <dd className="na-body">{item.kind === "link" ? "未知" : formatDate(item.modifiedAt)}</dd>
          </dl>

          <div className="border-border mt-4 border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="na-title-section flex items-center gap-2">
                <Link2 className="size-4" />
                引用笔记
              </h3>
              <span className="text-muted-foreground na-caption">{item.references.length}</span>
            </div>
            {item.references.length === 0 ? (
              <p className="text-muted-foreground na-body">未发现引用</p>
            ) : (
              <div className="divide-border/20 divide-y">
                {item.references.map((reference) => (
                  <div key={`${reference.notePath}:${reference.line}:${reference.role ?? "unknown"}`} className="px-1 py-2">
                    <div className="na-body-strong truncate" title={reference.notePath}>{reference.notePath}</div>
                    <div className="text-muted-foreground na-caption flex justify-between gap-2">
                      <span>第 {reference.line} 行</span>
                      <span>{reference.role ? referenceRoleLabels[reference.role] : "引用"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
