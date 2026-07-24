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
    <section aria-labelledby="software-data-environment-heading">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
          <Layers className="size-3.5" />
        </div>
        <h2 id="software-data-environment-heading" className="min-w-0 flex-1 na-title-section">数据环境</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => setCreating((visible) => !visible)}
            disabled={!bound || busyAction !== null}
            aria-label="新建环境"
            aria-expanded={creating}
            title={bound ? "新建环境" : "绑定远程仓库后可新建环境"}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={onSync}
            disabled={!canSync || busyAction !== null}
            aria-label={busyAction === "sync" ? "同步中" : "立即同步"}
            title="立即同步"
          >
            {busyAction === "sync"
              ? <RefreshCw className="size-3.5 animate-spin" />
              : <CloudUpload className="size-3.5" />}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
        <label htmlFor="data-sync-space" className="na-label text-muted-foreground">当前环境</label>
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
          <label htmlFor="data-sync-space-name" className="na-label text-muted-foreground">环境名称</label>
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
