import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, LoaderCircle } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { registerPluginModal } from "../bridge";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    return registerPluginModal("standard");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-border bg-background w-full max-w-md border shadow-xl"
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <AlertTriangle className={destructive ? "text-destructive mt-0.5 size-5 shrink-0" : "text-primary mt-0.5 size-5 shrink-0"} />
          <div className="min-w-0">
            <h2 id={titleId} className="gt-title-panel">{title}</h2>
            <div className="text-muted-foreground gt-body mt-1.5">{description}</div>
          </div>
        </div>
        <div className="border-border/60 bg-muted/20 flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={onCancel} disabled={busy} autoFocus>
            取消
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            className="h-7 px-2.5"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
