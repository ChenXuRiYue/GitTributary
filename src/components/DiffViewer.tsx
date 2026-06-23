import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  /** Unified diff patch text from gt-git */
  patch: string;
  /** File path (displayed in header) */
  filePath: string;
  /** Number of additions */
  additions: number;
  /** Number of deletions */
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
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
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

export function DiffViewer({ patch, filePath, additions, deletions }: DiffViewerProps) {
  const lines = useMemo(() => parsePatch(patch), [patch]);

  if (!patch.trim()) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        无法生成 diff(可能是新文件或二进制文件）
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* File header */}
      <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
        <span className="font-mono text-xs font-medium">{filePath}</span>
        <div className="flex items-center gap-2 text-xs">
          {additions > 0 && (
            <span className="font-mono text-green-600">+{additions}</span>
          )}
          {deletions > 0 && (
            <span className="font-mono text-red-500">-{deletions}</span>
          )}
        </div>
      </div>

      {/* Diff body */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs leading-5">
          <tbody>
            {lines.map((line, i) => {
              if (line.type === "header") return null;

              if (line.type === "hunk") {
                return (
                  <tr key={i} className="bg-primary/5">
                    <td
                      colSpan={3}
                      className="px-4 py-1 text-xs text-primary/70 select-none"
                    >
                      {line.content}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={i}
                  className={cn(
                    "group",
                    line.type === "add" && "bg-green-50 dark:bg-green-950/30",
                    line.type === "del" && "bg-red-50 dark:bg-red-950/30",
                  )}
                >
                  {/* Old line number */}
                  <td className="w-10 select-none border-r px-2 text-right text-muted-foreground/50">
                    {line.oldLineNo ?? ""}
                  </td>
                  {/* New line number */}
                  <td className="w-10 select-none border-r px-2 text-right text-muted-foreground/50">
                    {line.newLineNo ?? ""}
                  </td>
                  {/* Content */}
                  <td className="whitespace-pre px-3">
                    <span
                      className={cn(
                        "select-text",
                        line.type === "add" && "text-green-700 dark:text-green-400",
                        line.type === "del" && "text-red-600 dark:text-red-400",
                      )}
                    >
                      {line.type === "add" && (
                        <span className="mr-1 inline-block w-3 text-center select-none opacity-60">+</span>
                      )}
                      {line.type === "del" && (
                        <span className="mr-1 inline-block w-3 text-center select-none opacity-60">-</span>
                      )}
                      {line.type === "context" && (
                        <span className="mr-1 inline-block w-3 select-none"> </span>
                      )}
                      {line.content}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
