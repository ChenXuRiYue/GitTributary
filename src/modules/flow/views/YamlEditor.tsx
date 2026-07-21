import { CheckCircle2, Code2, Save, Trash2, XCircle } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

export function YamlEditor({
  yaml,
  folder,
  folders,
  status,
  error,
  isSaving,
  onChange,
  onFolderChange,
  onSave,
  onCancel,
  onDelete,
}: {
  yaml: string;
  folder: string;
  folders: string[];
  status: "idle" | "valid" | "invalid";
  error: string | null;
  isSaving: boolean;
  onChange: (value: string) => void;
  onFolderChange: (folder: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Code2 className="size-4 text-muted-foreground" />
          <h3 className="gt-title-panel">YAML</h3>
          {status === "valid" && (
            <Badge variant="outline" className="h-5 border-green-200 bg-green-50 text-green-700">
              <CheckCircle2 className="size-3" />
              可保存
            </Badge>
          )}
          {status === "invalid" && (
            <Badge variant="outline" className="h-5 border-red-200 bg-red-50 text-red-700">
              <XCircle className="size-3" />
              校验失败
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onDelete && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="size-3.5" />
              删除
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving || status === "invalid"}>
            <Save className="size-3.5" />
            保存
          </Button>
        </div>
      </div>
      {error && (
        <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <label className="gt-label shrink-0 text-muted-foreground" htmlFor="flow-folder-select">文件夹</label>
        <select
          id="flow-folder-select"
          value={folder}
          onChange={(event) => onFolderChange(event.target.value)}
          className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {folders.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <Textarea
          value={yaml}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="h-full min-h-[420px] resize-none font-mono text-xs leading-5"
        />
      </div>
    </div>
  );
}
