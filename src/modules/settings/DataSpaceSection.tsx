import { useState } from "react";
import { CloudUpload, Layers, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

interface DataSpaceSectionProps {
  spaces: string[];
  activeSpace: string;
  bound: boolean;
  canSync: boolean;
  busyAction: string | null;
  onSpaceChange: (space: string) => void;
  onCreateSpace: (space: string) => Promise<boolean>;
  onSync: () => void;
}

const compactButtonClass = "h-7 gap-1 px-2 text-[11px] [&_svg]:size-3";

export function DataSpaceSection({
  spaces,
  activeSpace,
  bound,
  canSync,
  busyAction,
  onSpaceChange,
  onCreateSpace,
  onSync,
}: DataSpaceSectionProps) {
  const [creating, setCreating] = useState(false);
  const [spaceName, setSpaceName] = useState("");

  const handleSubmit = async () => {
    const name = spaceName.trim();
    if (!name) return;
    if (await onCreateSpace(name)) {
      setSpaceName("");
      setCreating(false);
    }
  };

  return (
    <section aria-labelledby="data-space-heading">
      <div className="mb-3 flex items-center gap-2 border-b border-border/70 pb-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
          <Layers className="size-3.5" />
        </div>
        <h2 id="data-space-heading" className="gt-title-section">数据空间</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={compactButtonClass}
            onClick={() => setCreating((visible) => !visible)}
            disabled={!bound || busyAction !== null}
            aria-expanded={creating}
            title={bound ? "新建空间" : "绑定仓库后可新建空间"}
          >
            <Plus />
            新建空间
          </Button>
          <Button
            type="button"
            size="sm"
            className={compactButtonClass}
            onClick={onSync}
            disabled={!canSync || busyAction !== null}
          >
            {busyAction === "sync" ? <RefreshCw className="animate-spin" /> : <CloudUpload />}
            {busyAction === "sync" ? "同步中" : "立即同步"}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
        <label htmlFor="data-sync-space" className="gt-label text-muted-foreground">当前空间</label>
        <select
          id="data-sync-space"
          value={activeSpace}
          onChange={(event) => onSpaceChange(event.target.value)}
          disabled={!bound || busyAction !== null}
          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {spaces.map((space) => (
            <option key={space} value={space}>{space}</option>
          ))}
        </select>
      </div>

      {creating && (
        <form
          className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <label htmlFor="data-sync-space-name" className="gt-label text-muted-foreground">空间名称</label>
          <Input
            id="data-sync-space-name"
            value={spaceName}
            onChange={(event) => setSpaceName(event.target.value)}
            placeholder="例如 staging"
            className="h-8 text-xs"
            disabled={busyAction !== null}
            autoFocus
          />
          <div className="sm:col-start-2 flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={compactButtonClass}
              onClick={() => setCreating(false)}
              disabled={busyAction !== null}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              className={compactButtonClass}
              disabled={!spaceName.trim() || busyAction !== null}
            >
              {busyAction === "create-space" ? <RefreshCw className="animate-spin" /> : <Plus />}
              {busyAction === "create-space" ? "创建中" : "创建"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
