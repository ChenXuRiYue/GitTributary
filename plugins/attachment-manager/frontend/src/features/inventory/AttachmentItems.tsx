import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, Link2, LoaderCircle } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import { AttachmentIcon } from "../../components/AttachmentIcon";
import { attachmentTypeLabel, canPreviewImage, formatBytes } from "../../lib/attachment";
import {
  getCachedAttachmentPreview,
  loadAttachmentPreview,
  previewKey,
} from "../../lib/preview-cache";
import type { AttachmentItem, AttachmentPreview } from "../../types";
import { AsyncPreviewImage } from "./AttachmentPreview";

export const AttachmentTile = memo(function AttachmentTile({
  item,
  repoPath,
  selected,
  onSelect,
}: {
  item: AttachmentItem;
  repoPath: string;
  selected: boolean;
  onSelect?: (path: string) => void;
}) {
  const tileRef = useRef<HTMLElement | null>(null);
  const key = previewKey(repoPath, item);
  const [preview, setPreview] = useState<AttachmentPreview | null>(() => getCachedAttachmentPreview(key));
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    getCachedAttachmentPreview(key) ? "ready" : "idle",
  );
  const canPreview = canPreviewImage(item);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedAttachmentPreview(key);
    setPreview(cached);
    setLoadState(cached ? "ready" : "idle");
    if (cached || !canPreview || !repoPath) return;

    const load = () => {
      setLoadState("loading");
      void loadAttachmentPreview(repoPath, item).then((value) => {
        if (!cancelled) {
          setPreview(value);
          setLoadState("ready");
        }
      }).catch(() => {
        if (!cancelled) setLoadState("error");
      });
    };
    const element = tileRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      load();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [canPreview, item, key, repoPath]);

  const tileClassName = cn(
    "border-border/60 bg-card w-full min-w-0 overflow-hidden rounded-md border text-left transition-colors [contain:layout_paint]",
    selected ? "border-primary/40 bg-primary/5" : onSelect && "hover:bg-accent/40",
    onSelect && "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  );
  const content = (
    <>
      <div className="bg-muted/60 pointer-events-none flex aspect-[4/3] w-full items-center justify-center overflow-hidden">
        {preview && canPreview ? (
          <AsyncPreviewImage key={preview.dataUrl} src={preview.dataUrl} alt="" fallbackKind={item.kind} />
        ) : loadState === "loading" ? (
          <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
        ) : loadState === "error" ? (
          <AlertTriangle className="text-muted-foreground size-6" />
        ) : (
          <AttachmentIcon item={item} className="text-muted-foreground size-8" />
        )}
      </div>
      <div className="pointer-events-none p-2">
        <div className="gt-body-strong truncate" title={item.name}>{item.name}</div>
        <div className="text-muted-foreground gt-caption mt-1 flex items-center justify-between gap-2">
          <span
            className="truncate"
            title={item.kind === "link" ? [attachmentTypeLabel(item), item.domain].filter(Boolean).join(" · ") : undefined}
          >
            {item.kind === "link"
              ? [attachmentTypeLabel(item), item.domain].filter(Boolean).join(" · ")
              : formatBytes(item.size)}
          </span>
          <span className="flex items-center gap-1"><Link2 className="size-3" />{item.references.length}</span>
        </div>
      </div>
    </>
  );

  return onSelect ? (
    <button
      ref={(element) => { tileRef.current = element; }}
      type="button"
      onClick={() => onSelect(item.path)}
      aria-pressed={selected}
      className={tileClassName}
    >
      {content}
    </button>
  ) : (
    <div
      ref={(element) => { tileRef.current = element; }}
      className={tileClassName}
    >
      {content}
    </div>
  );
});

export const AttachmentRow = memo(function AttachmentRow({
  item,
  selected,
  onSelect,
}: {
  item: AttachmentItem;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.path)}
      aria-pressed={selected}
      className={cn(
        "flex min-h-10 w-full min-w-0 items-center gap-3 px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
        selected ? "bg-primary/8 text-foreground" : "hover:bg-accent/40",
      )}
    >
      <AttachmentIcon item={item} className={cn("text-muted-foreground size-4 shrink-0", selected && "text-primary")} />
      <span className="min-w-0 flex-1">
        <span className="gt-body-strong block truncate">{item.name}</span>
        <span className="text-muted-foreground gt-caption block truncate">
          {item.kind === "link"
            ? [attachmentTypeLabel(item), item.domain].filter(Boolean).join(" · ")
            : item.path}
        </span>
      </span>
      <span className="text-muted-foreground gt-caption w-16 shrink-0 text-right">
        {item.kind === "link" ? attachmentTypeLabel(item) : formatBytes(item.size)}
      </span>
      <span className="text-muted-foreground gt-caption flex w-8 shrink-0 items-center justify-end gap-1">
        <Link2 className="size-3" />{item.references.length}
      </span>
    </button>
  );
});
