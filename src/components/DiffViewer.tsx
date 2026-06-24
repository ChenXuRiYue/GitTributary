import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  patch: string;
  filePath: string;
  additions: number;
  deletions: number;
}

interface DiffLine {
  type: "add" | "del" | "context" | "hunk" | "header";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "hunk", content: raw, oldLineNo: null, newLineNo: null });
    } else if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("---") || raw.startsWith("+++")) {
      result.push({ type: "header", content: raw, oldLineNo: null, newLineNo: null });
    } else if (raw.startsWith("+")) {
      result.push({ type: "add", content: raw.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (raw.startsWith("-")) {
      result.push({ type: "del", content: raw.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (raw.startsWith(" ")) {
      result.push({ type: "context", content: raw.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    }
  }
  return result;
}

/**
 * Diff 预览 — GitHub Desktop 风格
 * 无圆角无外框,直接铺满容器。长行自动换行。
 */
export function DiffViewer({ patch, filePath, additions, deletions }: DiffViewerProps) {
  const lines = useMemo(() => parsePatch(patch), [patch]);

  if (!patch.trim()) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        无法生成 diff（可能是新文件或二进制文件）
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 文件头 */}
      <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{filePath}</span>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {additions > 0 && <span className="font-mono text-green-600">+{additions}</span>}
          {deletions > 0 && <span className="font-mono text-red-500">-{deletions}</span>}
        </div>
      </div>

      {/* Diff 内容 */}
      <div className="flex-1 overflow-y-auto overscroll-contain font-mono text-xs leading-5">
        {lines.map((line, i) => {
          if (line.type === "header") return null;

          if (line.type === "hunk") {
            return (
              <div key={i} className="bg-primary/5 px-4 py-0.5 text-primary/70 select-none">
                {line.content}
              </div>
            );
          }

          return (
            <div
              key={i}
              className={cn(
                "flex",
                line.type === "add" && "bg-green-50 dark:bg-green-950/30",
                line.type === "del" && "bg-red-50 dark:bg-red-950/30",
              )}
            >
              {/* 行号 */}
              <span className="w-9 shrink-0 select-none border-r px-1 text-right text-muted-foreground/40">
                {line.oldLineNo ?? ""}
              </span>
              <span className="w-9 shrink-0 select-none border-r px-1 text-right text-muted-foreground/40">
                {line.newLineNo ?? ""}
              </span>
              {/* +/- 标记 */}
              <span className="w-5 shrink-0 select-none text-center">
                {line.type === "add" && <span className="text-green-600">+</span>}
                {line.type === "del" && <span className="text-red-500">-</span>}
              </span>
              {/* 内容:自动换行 */}
              <span
                className={cn(
                  "min-w-0 flex-1 whitespace-pre-wrap break-words px-1",
                  line.type === "add" && "text-green-700 dark:text-green-400",
                  line.type === "del" && "text-red-600 dark:text-red-400",
                )}
              >
                {line.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
