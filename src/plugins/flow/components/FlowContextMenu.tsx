import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Code2, FilePenLine, FolderPlus, Trash2 } from "lucide-react";

import { DEFAULT_FLOW_FOLDER } from "../constants";
import type { FlowContextMenuState, FlowFolderCreateDraft } from "./flowBrowserTypes";
import { FLOW_ACTION_MENU_WIDTH } from "./flowMenuGeometry";

export interface FlowFloatingActionsProps {
  menu: NonNullable<FlowContextMenuState>;
  onBeginCreateChildFolder: (folder: string, position: { left: number; top: number }) => void;
  onCreateFlow: (folder: string) => void;
  onDeleteFolder: (folder: string) => void;
  onEditFlow: (id: string) => void;
  onDeleteFlow: (id: string) => void;
}

export function FlowFloatingActions({
  menu,
  onBeginCreateChildFolder,
  onCreateFlow,
  onDeleteFolder,
  onEditFlow,
  onDeleteFlow,
}: FlowFloatingActionsProps) {
  const content = (
    <div
      data-flow-floating-actions
      className="fixed z-[2147483647] rounded-md border bg-popover py-1 text-popover-foreground shadow-xl ring-1 ring-black/5"
      style={{ left: menu.left, top: menu.top, width: FLOW_ACTION_MENU_WIDTH }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {menu.selection.type === "folder" ? (
        <>
          <button
            type="button"
            title="新建子文件夹"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              const folder = menu.selection.type === "folder" ? menu.selection.path : DEFAULT_FLOW_FOLDER;
              onBeginCreateChildFolder(folder, {
                left: menu.left,
                top: Math.min(menu.top + 6, window.innerHeight - 44),
              });
            }}
          >
            <FolderPlus className="size-3.5 shrink-0" />
            <span className="truncate">新建子文件夹</span>
          </button>
          <button
            type="button"
            title="添加 Flow"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => onCreateFlow(menu.selection.type === "folder" ? menu.selection.path : DEFAULT_FLOW_FOLDER)}
          >
            <FilePenLine className="size-3.5 shrink-0" />
            <span className="truncate">添加 Flow</span>
          </button>
          <button
            type="button"
            title="删除空文件夹"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              if (menu.selection.type === "folder") onDeleteFolder(menu.selection.path);
            }}
          >
            <Trash2 className="size-3.5 shrink-0" />
            <span className="truncate">删除空文件夹</span>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            title="编辑 YAML"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              if (menu.selection.type === "flow") onEditFlow(menu.selection.id);
            }}
          >
            <Code2 className="size-3.5 shrink-0" />
            <span className="truncate">编辑 YAML</span>
          </button>
          <button
            type="button"
            title="删除 Flow"
            className="flex h-8 w-full items-center gap-2 px-2.5 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              if (menu.selection.type === "flow") onDeleteFlow(menu.selection.id);
            }}
          >
            <Trash2 className="size-3.5 shrink-0" />
            <span className="truncate">删除 Flow</span>
          </button>
        </>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

export function FlowFolderCreateInput({
  draft,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: NonNullable<FlowFolderCreateDraft>;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-flow-folder-create]")) return;
      onCancel();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onCancel]);

  return createPortal(
    <div
      data-flow-folder-create
      className="fixed z-[2147483647] flex h-9 items-center gap-1 rounded-md border bg-popover px-1.5 shadow-xl ring-1 ring-black/5"
      style={{
        left: Math.min(draft.left, window.innerWidth - 220),
        top: draft.top,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <FolderPlus className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={draft.value}
        placeholder="新文件夹"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="h-7 w-40 rounded border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </div>,
    document.body,
  );
}
