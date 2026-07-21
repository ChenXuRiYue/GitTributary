import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, Maximize2, Music, X } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { AttachmentIcon, KindIcon } from "../../components/AttachmentIcon";
import { canPreviewImage } from "../../lib/attachment";
import type { AttachmentItem, AttachmentKind, AttachmentPreview as Preview } from "../../types";

export function AttachmentPreview({
  item,
  preview,
  loading,
  error,
  onExpand,
}: {
  item: AttachmentItem;
  preview: Preview | null;
  loading: boolean;
  error: string | null;
  onExpand: () => void;
}) {
  return (
    <div className="bg-muted/40 border-border flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border">
      {loading ? (
        <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
      ) : error ? (
        <div className="text-muted-foreground gt-caption px-4 text-center">{error}</div>
      ) : !preview ? (
        <AttachmentIcon item={item} className="text-muted-foreground size-8" />
      ) : preview.mimeType.startsWith("audio/") ? (
        <AsyncPreviewAudio src={preview.dataUrl} />
      ) : canPreviewImage(item, preview.mimeType) ? (
        <AsyncPreviewImage
          key={preview.dataUrl}
          src={preview.dataUrl}
          alt={item.name}
          fallbackKind={item.kind}
          onExpand={onExpand}
        />
      ) : item.kind === "link" ? (
        <div className="text-muted-foreground gt-caption flex flex-col items-center gap-2 px-4 text-center">
          <AttachmentIcon item={item} className="size-8" />
          <span>此链接没有可内嵌的媒体预览</span>
        </div>
      ) : (
        <AttachmentIcon item={item} className="text-muted-foreground size-8" />
      )}
    </div>
  );
}

export function AsyncPreviewImage({
  src,
  alt,
  fallbackKind,
  onExpand,
}: {
  src: string;
  alt: string;
  fallbackKind: AttachmentKind;
  onExpand?: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    timeoutRef.current = window.setTimeout(() => {
      setState((current) => current === "loading" ? "error" : current);
    }, 15_000);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [src]);

  const finish = (next: "ready" | "error") => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setState(next);
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {state === "loading" && <LoaderCircle className="text-muted-foreground size-5 animate-spin" />}
      {state === "error" && (
        <div className="text-muted-foreground gt-caption flex flex-col items-center gap-2 px-4 text-center">
          <KindIcon kind={fallbackKind} className="size-7" />
          {fallbackKind === "link" && <span>此链接无法作为图片预览</span>}
        </div>
      )}
      {state !== "error" && (
        <img
          src={src}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => finish("ready")}
          onError={() => finish("error")}
          className={cn(
            "pointer-events-none absolute inset-0 block h-full w-full object-contain",
            state === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {state === "ready" && onExpand && (
        <button
          type="button"
          className="group absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
          onClick={onExpand}
          title="放大预览"
        >
          <span className="bg-background/90 absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="size-4" />
          </span>
        </button>
      )}
    </div>
  );
}

function AsyncPreviewAudio({ src }: { src: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => setState("loading"), [src]);

  return (
    <div className="flex w-full flex-col items-center px-4">
      {state === "loading" ? (
        <LoaderCircle className="text-muted-foreground mb-4 size-5 animate-spin" />
      ) : state === "error" ? (
        <AlertTriangle className="text-muted-foreground mb-4 size-6" />
      ) : (
        <Music className="text-muted-foreground mb-4 size-8" />
      )}
      <audio
        controls
        preload="metadata"
        src={src}
        onLoadedMetadata={() => setState("ready")}
        onError={() => setState("error")}
      />
    </div>
  );
}

export function ImagePreviewDialog({
  item,
  preview,
  onClose,
}: {
  item: AttachmentItem;
  preview: Preview;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} 图片预览`}
      onClick={onClose}
    >
      <img
        src={preview.dataUrl}
        alt={item.name}
        decoding="async"
        className="max-h-full max-w-full object-contain"
        onClick={(event) => event.stopPropagation()}
      />
      <Button
        variant="ghost"
        size="icon"
        autoFocus
        className="bg-background/90 text-foreground absolute right-4 top-4 shadow-sm"
        onClick={onClose}
        title="关闭预览"
      >
        <X />
      </Button>
    </div>
  );
}
