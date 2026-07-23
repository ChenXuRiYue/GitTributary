import type { LucideIcon } from "lucide-react";
import { Eye, Plus, Workflow, Wrench } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { ViewMode } from "../types";

export function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const nextMode = mode === "read" ? "operate" : "read";
  const Icon = mode === "read" ? Wrench : Eye;
  const label = mode === "read" ? "切到操作模式" : "切到预览模式";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onChange(nextMode)}
      className={cn(
        "flex size-8 items-center justify-center rounded-md border bg-background transition-colors",
        mode === "read" ? "text-muted-foreground hover:bg-accent" : "bg-primary text-primary-foreground shadow-sm",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

export function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2 last:border-b-0">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="na-label text-muted-foreground">{label}</p>
        <p className="na-metric-compact truncate">{value}</p>
      </div>
    </div>
  );
}

export function SectionHeader({ icon: Icon, title, aside }: { icon: LucideIcon; title: string; aside?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h4 className="na-title-section truncate">{title}</h4>
      </div>
      {aside && <span className="na-caption shrink-0 text-muted-foreground">{aside}</span>}
    </div>
  );
}

export function EmptyState({ canOperate, onCreate }: { canOperate: boolean; onCreate: () => void }) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-md border bg-background p-5 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-muted">
          <Workflow className="size-5 text-muted-foreground" />
        </div>
        <h3 className="na-title-panel mt-3">还没有 Flow</h3>
        <p className="na-body mt-2 text-muted-foreground">
          先保存一个 YAML 工作流,这里会展示它的触发入口、节点步骤和最近执行。
        </p>
        {canOperate && (
          <Button className="mt-4" size="sm" onClick={onCreate}>
            <Plus className="size-3.5" />
            添加 Flow
          </Button>
        )}
      </div>
    </div>
  );
}
