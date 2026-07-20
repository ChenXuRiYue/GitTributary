import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  /** 拖拽方向 */
  direction: "horizontal" | "vertical";
  /** 当前尺寸(px) */
  size: number;
  /** 尺寸变化回调 */
  onResize: (newSize: number) => void;
  /** 最小尺寸(px) */
  minSize?: number;
  /** 磁吸预设值(px):接近时自动吸附 */
  snapTo?: number;
  /** 磁吸范围(px):在 snapTo ± snapThreshold 内触发吸附,默认 8 */
  snapThreshold?: number;
  /** 额外 className */
  className?: string;
  /** 把手位于面板哪一侧，start 用于从面板左边缘反向调整 */
  edge?: "start" | "end";
  /** 无障碍名称，用于区分同一页面中的多个分隔条 */
  ariaLabel?: string;
}

/**
 * 通用可拖拽分隔条,带磁吸(snap)。
 *
 * 磁吸行为:当拖拽到接近 snapTo 值(±threshold)时,
 * 自动吸附到 snapTo,产生"预设感"。松手后保持吸附位置。
 * 继续拖拽超出阈值后脱离吸附恢复自由调整。
 */
export function ResizeHandle({
  direction,
  size,
  onResize,
  minSize = 100,
  snapTo,
  snapThreshold = 8,
  className,
  edge = "end",
  ariaLabel = "调整面板大小",
}: ResizeHandleProps) {
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const applySnap = useCallback(
    (raw: number): number => {
      const clamped = Math.max(minSize, raw);
      if (snapTo != null && Math.abs(clamped - snapTo) <= snapThreshold) {
        return snapTo;
      }
      return clamped;
    },
    [minSize, snapTo, snapThreshold],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
      startSize.current = size;
      document.body.style.userSelect = "none";
      document.body.style.cursor =
        direction === "horizontal" ? "col-resize" : "row-resize";

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta =
          direction === "horizontal"
            ? ev.clientX - startPos.current
            : ev.clientY - startPos.current;
        const raw = startSize.current + delta * (edge === "start" ? -1 : 1);
        onResize(applySnap(raw));
      };

      const onUp = () => {
        dragging.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [direction, edge, size, onResize, applySnap],
  );

  // 双击重置到预设值
  const onDoubleClick = useCallback(() => {
    if (snapTo != null) {
      onResize(snapTo);
    }
  }, [snapTo, onResize]);

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
      aria-valuemin={minSize}
      aria-valuenow={Math.round(size)}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group shrink-0 transition-colors",
        direction === "horizontal"
          ? "w-1 cursor-col-resize hover:bg-primary/20"
          : "h-1 cursor-row-resize hover:bg-primary/20",
        className,
      )}
      title="拖拽调整大小，双击重置"
    />
  );
}
