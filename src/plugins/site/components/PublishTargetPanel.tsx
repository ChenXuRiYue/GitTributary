import { CheckCircle2, ExternalLink, GitBranch, Globe2, Save, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { credentialLabel, purposeLabel } from "../publish";
import { shortPath } from "../state";
import type { PublishRepoCandidate, SitePublishDraft, SitePublishTargetState } from "../types";

export function PublishTargetPanel({
  candidates,
  selectedCandidateId,
  draft,
  savedTarget,
  sourceRepoReady,
  onSelectCandidate,
  onDraftChange,
  onSave,
}: {
  candidates: PublishRepoCandidate[];
  selectedCandidateId: string;
  draft: SitePublishDraft;
  savedTarget: SitePublishTargetState | null;
  sourceRepoReady: boolean;
  onSelectCandidate: (candidate: PublishRepoCandidate) => void;
  onDraftChange: (draft: SitePublishDraft) => void;
  onSave: () => void;
}) {
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null;
  const canSave = sourceRepoReady && Boolean(selectedCandidate && selectedCandidate.status === "ready" && draft.targetBranch.trim() && draft.publishDir.trim());
  const savedMatches = Boolean(savedTarget && selectedCandidate && savedTarget.targetRepoId === selectedCandidate.id);

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe2 className="size-4 text-muted-foreground" />
            <div className="gt-title-panel">Pages 发布</div>
            {savedTarget ? (
              <Badge variant="secondary" className="h-5 px-1.5 gt-caption">已配置</Badge>
            ) : (
              <Badge variant="outline" className="h-5 px-1.5 gt-caption">未配置</Badge>
            )}
          </div>
          <p className="gt-caption mt-1 truncate text-muted-foreground">
            从已有仓库配置中选择静态发布仓库。
          </p>
        </div>
        <Button size="sm" onClick={onSave} disabled={!canSave}>
          <Save /> 保存发布目标
        </Button>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="gt-body-strong">发布仓库</div>
              <p className="gt-caption text-muted-foreground">优先选择独立 Pages 仓库。</p>
            </div>
            <Badge variant="outline" className="h-5 px-1.5 gt-caption">{candidates.length} 个候选</Badge>
          </div>

          {candidates.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center">
              <GitBranch className="size-7 text-muted-foreground" />
              <div className="gt-body-strong mt-2">暂无可用发布仓库</div>
              <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                先在远程配置中 Clone 或绑定一个 Pages 仓库,然后回到这里选择。
              </p>
            </div>
          ) : (
            <div className="gt-thin-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
              {candidates.map((candidate) => (
                <PublishCandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  selected={candidate.id === selectedCandidateId}
                  saved={savedTarget?.targetRepoId === candidate.id}
                  onSelect={() => onSelectCandidate(candidate)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <div className="gt-body-strong">发布参数</div>
            <p className="gt-caption text-muted-foreground">当前阶段只保存配置,发布执行稍后接入。</p>
          </div>

          {selectedCandidate ? (
            <>
              <div className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2",
                selectedCandidate.status === "ready"
                  ? "border-primary/20 bg-primary/5"
                  : "border-amber-500/30 bg-amber-500/10",
              )}>
                {selectedCandidate.status === "ready" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <div className="gt-body-strong">{selectedCandidate.reason}</div>
                  <p className="gt-caption mt-0.5 truncate text-muted-foreground">
                    {selectedCandidate.repoPath ? shortPath(selectedCandidate.repoPath) : selectedCandidate.url}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="gt-caption text-muted-foreground">目标分支</span>
                  <Input
                    value={draft.targetBranch}
                    onChange={(event) => onDraftChange({ ...draft, targetBranch: event.target.value })}
                    placeholder="gh-pages"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="gt-caption text-muted-foreground">发布目录</span>
                  <Input
                    value={draft.publishDir}
                    onChange={(event) => onDraftChange({ ...draft, publishDir: event.target.value })}
                    placeholder="/"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="gt-caption text-muted-foreground">Pages URL</span>
                <div className="flex gap-2">
                  <Input
                    value={draft.pagesUrl}
                    onChange={(event) => onDraftChange({ ...draft, pagesUrl: event.target.value })}
                    placeholder="https://user.github.io/repo/"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!draft.pagesUrl.trim()}
                    onClick={() => window.open(draft.pagesUrl, "_blank", "noopener,noreferrer")}
                    title="打开 Pages URL"
                  >
                    <ExternalLink />
                  </Button>
                </div>
              </label>

              <label className="block space-y-1.5">
                <span className="gt-caption text-muted-foreground">提交信息</span>
                <Input
                  value={draft.autoCommitMessage}
                  onChange={(event) => onDraftChange({ ...draft, autoCommitMessage: event.target.value })}
                  placeholder="deploy: 更新静态站点"
                />
              </label>

              {savedMatches && (
                <div className="gt-caption rounded-md bg-muted px-3 py-2 text-muted-foreground">
                  当前选择已经保存为此仓库的 Pages 发布目标。
                </div>
              )}
            </>
          ) : savedTarget ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-amber-500/30 bg-amber-500/10 px-4 py-6 text-center">
              <TriangleAlert className="size-7 text-amber-600" />
              <div className="gt-body-strong mt-2">发布仓库未在当前候选中找到</div>
              <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                {savedTarget.targetRepoName || savedTarget.targetRepoUrl}
              </p>
              <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                请刷新远程配置,或重新选择一个已有仓库配置。
              </p>
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center">
              <Globe2 className="size-7 text-muted-foreground" />
              <div className="gt-body-strong mt-2">选择一个发布仓库</div>
              <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                有本地工作副本的候选才能在后续阶段执行同步、提交和推送。
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PublishCandidateRow({
  candidate,
  selected,
  saved,
  onSelect,
}: {
  candidate: PublishRepoCandidate;
  selected: boolean;
  saved: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
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
          {saved && <Badge variant="secondary" className="h-5 px-1.5 gt-caption">已保存</Badge>}
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
