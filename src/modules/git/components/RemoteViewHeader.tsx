import { Clock, FolderOpen, GitBranch, Globe, RefreshCw } from "lucide-react";

import { Button } from "@/shared/ui/button";
import type { RepoOverview } from "../types";
import { shortPath } from "../hooks/useRemoteView";

interface RemoteViewHeaderProps {
  overview: RepoOverview | null;
  recentRepos: string[];
  onOpenRepo: (path: string) => void;
  onOpenDialog: () => void;
  onRefresh: () => void;
}

export function RemoteViewHeader({
  overview,
  recentRepos,
  onOpenRepo,
  onOpenDialog,
  onRefresh,
}: RemoteViewHeaderProps) {
  return (
    <div className="shrink-0 border-b border-border/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">远程配置</div>
          <div className="text-[11px] text-muted-foreground">
            {overview
              ? `${overview.current_branch} · ${shortPath(overview.path)}`
              : "管理当前仓库 remote 与 GitTributary 远程配置"}
          </div>
        </div>
        {recentRepos[0] && !overview && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpenRepo(recentRepos[0])} title="打开最近仓库">
            <Clock className="size-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onOpenDialog} title="打开仓库">
          <FolderOpen className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onRefresh} title="刷新">
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function RemoteViewNotices({
  overview,
  recentRepos,
  status,
  error,
  onOpenRepo,
  onOpenDialog,
}: Omit<RemoteViewHeaderProps, "onRefresh"> & {
  status: string | null;
  error: string | null;
}) {
  return (
    <>
      {status && <div className="rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary">{status}</div>}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</div>}
      {!overview && (
        <div className="flex flex-col gap-3 rounded-md border border-dashed px-3 py-4">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">未打开当前仓库</div>
              <div className="truncate text-[11px] text-muted-foreground">
                打开已有仓库后可管理 remote,也可以在下方 Clone 新仓库。
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentRepos[0] && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenRepo(recentRepos[0])}>
                <Clock className="size-3.5" /> {shortPath(recentRepos[0])}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8" onClick={onOpenDialog}>
              <FolderOpen className="size-3.5" /> 选择仓库
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
