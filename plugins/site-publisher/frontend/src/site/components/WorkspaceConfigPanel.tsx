import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Globe2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";

import { shortPath } from "../state";
import { credentialLabel, isPublishCandidateUsable } from "../publish";
import type {
  PublishRepoCandidate,
  RemoteConfigEntry,
  SiteWorkspaceGroup,
} from "../types";
import {
  CollapsibleConfigSection,
  EnvVarRow,
  PAGES_SOURCE_PRESETS,
  PublishCandidateRow,
  WorkspaceGroupRow,
} from "./WorkspaceConfigParts";
import { useWorkspaceConfigDraft } from "../hooks/useWorkspaceConfigDraft";

export function WorkspaceConfigPanel({
  groups,
  activeGroupId,
  remoteConfigs,
  publishCandidates,
  onCreateGroup,
  onSelectGroup,
  onUpdateGroup,
  onDeleteGroup,
  onRefreshRemoteConfigs,
}: {
  groups: SiteWorkspaceGroup[];
  activeGroupId: string | null;
  remoteConfigs: RemoteConfigEntry[];
  publishCandidates: PublishRepoCandidate[];
  onCreateGroup: () => string | null;
  onSelectGroup: (id: string) => void;
  onUpdateGroup: (id: string, updater: (group: SiteWorkspaceGroup) => SiteWorkspaceGroup) => void;
  onDeleteGroup: (id: string) => void;
  onRefreshRemoteConfigs: () => void;
}) {
  const {
    viewingGroup,
    draft,
    dirty,
    draftIsCurrent,
    sourceRepoOptions,
    selectedSource,
    target,
    selectedCandidate,
    handleViewGroup,
    handleCreateGroup,
    handleDeleteGroup,
    handleSetCurrentGroup,
    saveDraft,
    updateDraft,
    updateTarget,
    selectPublishCandidate,
    addEnvVar,
  } = useWorkspaceConfigDraft({
    groups,
    activeGroupId,
    remoteConfigs,
    publishCandidates,
    onCreateGroup,
    onSelectGroup,
    onUpdateGroup,
    onDeleteGroup,
  });
  const hasSourceRepoOptions = sourceRepoOptions.length > 0;

  return (
    <section className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border/60 bg-sidebar/70">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Settings2 className="size-4 shrink-0 text-muted-foreground" />
              <div className="gt-title-panel truncate">任务流</div>
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 gt-caption">{groups.length}</Badge>
            </div>
            <p className="gt-caption mt-1 truncate text-muted-foreground">源仓库、范围、目标仓库</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={onRefreshRemoteConfigs}
              title="刷新远程配置"
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="size-8"
              onClick={handleCreateGroup}
              title="新建任务"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="gt-thin-scroll min-h-0 flex-1 overflow-y-auto py-1">
          {groups.length === 0 ? (
            <div className="mx-3 my-4 rounded-md border border-dashed bg-background px-4 py-7 text-center">
              <div className="gt-body-strong">还没有发布任务</div>
              <p className="gt-caption mt-1 text-muted-foreground">先新建一个发布任务。</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={handleCreateGroup}>
                <Plus className="size-3.5" />
                新建任务
              </Button>
            </div>
          ) : (
            groups.map((group) => (
              <WorkspaceGroupRow
                key={group.id}
                group={group}
                viewing={group.id === viewingGroup?.id}
                current={group.id === activeGroupId}
                onSelect={() => handleViewGroup(group.id)}
              />
            ))
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!draft ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <Settings2 className="size-8 text-muted-foreground" />
            <div className="gt-title-panel mt-3">新建一个发布任务</div>
            <p className="gt-body mt-2 max-w-sm text-muted-foreground">
              发布任务会保存一套可复用的源仓库、发布仓库和环境变量。
            </p>
            <Button className="mt-4" size="sm" onClick={handleCreateGroup}>
              <Plus className="size-3.5" />
              新建任务
            </Button>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/60 px-6 py-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="gt-title-panel truncate">{draft.name || "未命名任务"}</div>
                  {draftIsCurrent && (
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 gt-caption">当前上下文</Badge>
                  )}
                  {dirty ? (
                    <Badge variant="outline" className="h-5 shrink-0 px-1.5 gt-caption text-amber-600">未保存</Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 shrink-0 px-1.5 gt-caption text-muted-foreground">已保存</Badge>
                  )}
                </div>
                <p className="gt-caption mt-1 truncate text-muted-foreground">
                  {draftIsCurrent ? "当前任务" : "仅查看详情"} · {draft.sourceRepoPath ? shortPath(draft.sourceRepoPath) : "未选择源仓库"} · 文档范围 {draft.documentScope.length} 项
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!draftIsCurrent && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={handleSetCurrentGroup}
                    disabled={dirty}
                    title={dirty ? "先保存当前改动后再设为当前任务" : "设为当前任务"}
                  >
                    <CheckCircle2 className="size-3.5" />
                    设为当前
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteGroup(draft.id)}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
                <Button size="sm" className="h-8" onClick={saveDraft} disabled={!dirty}>
                  <Save className="size-3.5" />
                  保存
                </Button>
              </div>
            </div>

            <div className="gt-thin-scroll min-h-0 flex-1 overflow-y-auto">
              <div className="grid min-h-full xl:grid-cols-[minmax(320px,0.92fr)_minmax(440px,1.08fr)]">
                <div className="min-w-0 space-y-6 border-b border-border/50 px-6 py-5 xl:border-b-0 xl:border-r">
                  <section className="space-y-3">
                    <div>
                      <div className="gt-body-strong">任务名称</div>
                      <p className="gt-caption text-muted-foreground">例如「个人博客」「团队文档」「产品手册」。</p>
                    </div>
                    <Input
                      value={draft.name}
                      onChange={(event) => updateDraft((group) => ({ ...group, name: event.target.value }))}
                      placeholder="发布任务名称"
                    />
                  </section>

                  <CollapsibleConfigSection
                    title="源仓库"
                    subtitle={draft.sourceRepoPath ? shortPath(draft.sourceRepoPath) : "未选择源仓库"}
                    status={(
                      <Badge variant="outline" className={cn(
                        "h-5 px-1.5 gt-caption",
                        draft.sourceRepoPath ? "text-muted-foreground" : "text-amber-600",
                      )}>
                        {draft.sourceRepoPath ? "已选择" : "未选择"}
                      </Badge>
                    )}
                  >
                    <div className="space-y-3">
                      <p className="gt-caption text-muted-foreground">只能从 Git 已配置的工作仓库中选择。</p>
                      {hasSourceRepoOptions ? (
                        <>
                          <select
                            value={draft.sourceRepoPath}
                            onChange={(event) => updateDraft((group) => ({
                              ...group,
                              sourceRepoPath: event.target.value,
                              target: null,
                            }))}
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
                            aria-label="选择源仓库"
                          >
                            <option value="">选择源仓库</option>
                            {sourceRepoOptions.map((repo) => (
                              <option key={repo.path} value={repo.path}>
                                {repo.name} · {shortPath(repo.path)}
                              </option>
                            ))}
                          </select>
                          {selectedSource && (
                            <div className="rounded-md border bg-background px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                                <div className="gt-body-strong truncate">{selectedSource.name}</div>
                                <Badge variant="outline" className="ml-auto h-5 px-1.5 gt-caption">
                                  {selectedSource.remotes.length > 0 ? `${selectedSource.remotes.length} remote` : "当前仓库"}
                                </Badge>
                              </div>
                              <p className="gt-caption mt-1 truncate text-muted-foreground">{selectedSource.path}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="rounded-md border border-dashed bg-background px-4 py-5 text-center">
                          <div className="gt-body-strong">暂无已配置工作仓库</div>
                          <p className="gt-caption mt-1 text-muted-foreground">
                            先到 Git 模块的远程配置中打开、Clone 或绑定仓库,然后点击刷新远程配置。
                          </p>
                          <Button size="sm" variant="outline" className="mt-3" onClick={onRefreshRemoteConfigs}>
                            <RefreshCw className="size-3.5" />
                            刷新远程配置
                          </Button>
                        </div>
                      )}
                    </div>
                  </CollapsibleConfigSection>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="gt-body-strong">环境变量</div>
                        <p className="gt-caption text-muted-foreground">保存此任务需要复用的非敏感变量。</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={addEnvVar}>
                        <Plus className="size-3.5" />
                        新增变量
                      </Button>
                    </div>
                    {draft.env.length === 0 ? (
                      <div className="rounded-md border border-dashed px-4 py-5 text-center">
                        <div className="gt-body-strong">暂无环境变量</div>
                        <p className="gt-caption mt-1 text-muted-foreground">可以先为空,后续发布链路再读取。</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {draft.env.map((item) => (
                          <EnvVarRow
                            key={item.id}
                            item={item}
                            onChange={(next) => updateDraft((group) => ({
                              ...group,
                              env: group.env.map((env) => env.id === item.id ? next : env),
                            }))}
                            onRemove={() => updateDraft((group) => ({
                              ...group,
                              env: group.env.filter((env) => env.id !== item.id),
                            }))}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className="min-w-0 space-y-4 px-6 py-5">
                  <CollapsibleConfigSection
                    title="发布仓库"
                    subtitle={target
                      ? `${selectedCandidate?.name ?? target.targetRepoName ?? target.targetRepoUrl} · ${target.remoteName}/${target.targetBranch} · ${target.publishDir === "/" ? "/root" : `/${target.publishDir}`}`
                      : "未选择发布仓库"}
                    status={(
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant={target ? "secondary" : "outline"} className={cn(
                          "h-5 px-1.5 gt-caption",
                          target ? "" : "text-amber-600",
                        )}>
                          {target ? "已配置" : "未配置"}
                        </Badge>
                        <Badge variant="outline" className="h-5 px-1.5 gt-caption">{publishCandidates.length} 个候选</Badge>
                      </div>
                    )}
                  >
                    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.86fr)]">
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="gt-caption text-muted-foreground">优先选择独立 Pages 仓库。</p>
                          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onRefreshRemoteConfigs}>
                            <RefreshCw className="size-3.5" />
                            刷新
                          </Button>
                        </div>

                        {publishCandidates.length === 0 ? (
                          <div className="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed bg-background px-4 py-6 text-center">
                            <GitBranch className="size-7 text-muted-foreground" />
                            <div className="gt-body-strong mt-2">暂无可用发布仓库</div>
                            <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                              先在远程配置中 Clone 或绑定一个 Pages 仓库,然后点击刷新远程配置。
                            </p>
                            <Button size="sm" variant="outline" className="mt-3" onClick={onRefreshRemoteConfigs}>
                              <RefreshCw className="size-3.5" />
                              刷新远程配置
                            </Button>
                          </div>
                        ) : (
                          <div className="gt-thin-scroll max-h-[360px] space-y-2 overflow-y-auto pr-1">
                            {publishCandidates.map((candidate) => (
                              <PublishCandidateRow
                                key={candidate.id}
                                candidate={candidate}
                                selected={candidate.id === target?.targetRepoId}
                                onSelect={() => selectPublishCandidate(candidate)}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 space-y-3">
                        {target && selectedCandidate ? (
                          <>
                            <div className={cn(
                              "flex items-start gap-2 rounded-md border bg-background px-3 py-2",
                              isPublishCandidateUsable(selectedCandidate)
                                ? "border-primary/20"
                                : "border-amber-500/30 bg-amber-500/10",
                            )}>
                              {isPublishCandidateUsable(selectedCandidate) ? (
                                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                              ) : (
                                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                              )}
                              <div className="min-w-0">
                                <div className="gt-body-strong">{selectedCandidate.reason}</div>
                                <p className="gt-caption mt-0.5 truncate text-muted-foreground">
                                  {selectedCandidate.repoPath ? shortPath(selectedCandidate.repoPath) : selectedCandidate.url}
                                </p>
                                <p className="gt-caption mt-0.5 truncate text-muted-foreground">
                                  凭证: {credentialLabel(selectedCandidate.credentialMode)}
                                  {selectedCandidate.credentialRef ? ` / ${selectedCandidate.credentialRef}` : ""}
                                </p>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <span className="gt-caption text-muted-foreground">GitHub Pages 源</span>
                              <div className="grid grid-cols-3 gap-1 rounded-md border bg-background p-1">
                                {PAGES_SOURCE_PRESETS.map((preset) => {
                                  const active = target.targetBranch.trim() === preset.targetBranch && target.publishDir.trim() === preset.publishDir;
                                  return (
                                    <Button
                                      key={preset.id}
                                      type="button"
                                      variant={active ? "secondary" : "ghost"}
                                      size="sm"
                                      className="h-8 px-2 text-xs"
                                      onClick={() => updateTarget((current) => ({
                                        ...current,
                                        targetBranch: preset.targetBranch,
                                        publishDir: preset.publishDir,
                                      }))}
                                    >
                                      {preset.label}
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1.5">
                                <span className="gt-caption text-muted-foreground">目标分支</span>
                                <Input
                                  value={target.targetBranch}
                                  onChange={(event) => updateTarget((current) => ({ ...current, targetBranch: event.target.value }))}
                                  placeholder="main"
                                />
                              </label>
                              <label className="space-y-1.5">
                                <span className="gt-caption text-muted-foreground">发布目录</span>
                                <Input
                                  value={target.publishDir}
                                  onChange={(event) => updateTarget((current) => ({ ...current, publishDir: event.target.value }))}
                                  placeholder="/"
                                />
                              </label>
                            </div>

                            <label className="block space-y-1.5">
                              <span className="gt-caption text-muted-foreground">Pages URL</span>
                              <div className="flex gap-2">
                                <Input
                                  value={target.pagesUrl}
                                  onChange={(event) => updateTarget((current) => ({ ...current, pagesUrl: event.target.value }))}
                                  placeholder="https://user.github.io/repo/"
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  disabled={!target.pagesUrl.trim()}
                                  onClick={() => void openUrl(target.pagesUrl)}
                                  title="打开 Pages URL"
                                >
                                  <ExternalLink />
                                </Button>
                              </div>
                            </label>

                            <label className="block space-y-1.5">
                              <span className="gt-caption text-muted-foreground">提交信息</span>
                              <Input
                                value={target.autoCommitMessage}
                                onChange={(event) => updateTarget((current) => ({ ...current, autoCommitMessage: event.target.value }))}
                                placeholder="deploy: 更新文档站点"
                              />
                            </label>
                          </>
                        ) : (
                          <div className="flex min-h-44 flex-col items-center justify-center rounded-md border border-dashed bg-background px-4 py-6 text-center">
                            <Globe2 className="size-7 text-muted-foreground" />
                            <div className="gt-body-strong mt-2">选择一个发布仓库</div>
                            <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                              有本地工作副本的候选才能在后续阶段执行同步、提交和推送。
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CollapsibleConfigSection>
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </section>
  );
}
