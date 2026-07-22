import type { ReactNode } from "react";
import { ChevronDown, Trash2 } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";

import { credentialLabel, purposeLabel } from "../publish";
import { shortPath } from "../state";
import type {
  PublishRepoCandidate,
  SiteWorkspaceEnvVar,
  SiteWorkspaceGroup,
} from "../types";

export const PAGES_SOURCE_PRESETS = [
  { id: "main-root", label: "main / root", targetBranch: "main", publishDir: "/" },
  { id: "main-docs", label: "main / docs", targetBranch: "main", publishDir: "docs" },
  { id: "gh-pages-root", label: "gh-pages / root", targetBranch: "gh-pages", publishDir: "/" },
];

function repoLabel(path: string) {
  return path.trim() ? shortPath(path) : "未选择";
}

export function WorkspaceGroupRow({
  group,
  viewing,
  current,
  onSelect,
}: {
  group: SiteWorkspaceGroup;
  viewing: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={viewing}
      className={cn(
        "flex min-h-[76px] w-full min-w-0 items-start gap-3 border-l-2 border-transparent px-3 py-3 text-left transition-colors",
        viewing
          ? "border-l-primary bg-background text-foreground"
          : "hover:bg-background/70",
      )}
    >
      <span className={cn(
        "mt-1.5 size-2 shrink-0 rounded-full",
        group.target ? "bg-primary" : "bg-amber-500",
      )} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="gt-body-strong truncate">{group.name || "未命名任务"}</span>
          {current && <Badge variant="secondary" className="h-5 px-1.5 gt-caption">当前</Badge>}
        </span>
        <span className="gt-caption mt-1 block truncate text-muted-foreground">
          {repoLabel(group.sourceRepoPath)}
        </span>
        <span className="gt-caption mt-1 block truncate text-muted-foreground">
          文档范围 {group.documentScope.length} 项 · {group.target ? "已配发布仓库" : "未配发布仓库"}
        </span>
      </span>
    </button>
  );
}

export function EnvVarRow({
  item,
  onChange,
  onRemove,
}: {
  item: SiteWorkspaceEnvVar;
  onChange: (item: SiteWorkspaceEnvVar) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border bg-background p-2 sm:grid-cols-[auto_minmax(120px,0.45fr)_minmax(160px,1fr)_auto]">
      <Switch
        checked={item.enabled}
        onCheckedChange={(enabled) => onChange({ ...item, enabled })}
        aria-label="启用环境变量"
      />
      <Input
        value={item.key}
        onChange={(event) => onChange({ ...item, key: event.target.value })}
        placeholder="变量名"
        className="h-8 font-mono text-xs"
      />
      <Input
        value={item.value}
        onChange={(event) => onChange({ ...item, value: event.target.value })}
        placeholder="变量值"
        className="h-8 font-mono text-xs"
      />
      <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={onRemove} title="删除变量">
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

export function PublishCandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: PublishRepoCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "bg-background hover:bg-accent/40",
      )}
    >
      <span className={cn(
        "mt-1 size-2.5 shrink-0 rounded-full",
        candidate.status === "ready" ? "bg-primary" : candidate.status === "needs-local" ? "bg-amber-500" : "bg-muted-foreground",
      )} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate gt-body-strong">{candidate.name}</span>
          {candidate.status === "needs-local" && <Badge variant="outline" className="h-5 px-1.5 gt-caption">需本地副本</Badge>}
          {candidate.status === "not-recommended" && <Badge variant="outline" className="h-5 px-1.5 gt-caption">不推荐</Badge>}
        </span>
        <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
          {candidate.repoPath ?? candidate.url}
        </span>
        <span className="mt-2 flex flex-wrap gap-1">
          <Badge variant="outline" className="h-5 px-1.5 gt-caption">{candidate.remoteName}</Badge>
          <Badge variant="outline" className="h-5 px-1.5 gt-caption">{credentialLabel(candidate.credentialMode)}</Badge>
          {candidate.purpose.slice(0, 3).map((purpose) => (
            <Badge key={purpose} variant="outline" className="h-5 px-1.5 gt-caption">{purposeLabel(purpose)}</Badge>
          ))}
        </span>
      </span>
    </button>
  );
}

export function CollapsibleConfigSection({
  title,
  subtitle,
  status,
  children,
}: {
  title: string;
  subtitle: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-md border bg-background">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate gt-body-strong">{title}</div>
            {status}
          </div>
          <div className="gt-caption mt-0.5 truncate text-muted-foreground" title={subtitle}>
            {subtitle}
          </div>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t bg-muted/10 p-3">{children}</div>
    </details>
  );
}
