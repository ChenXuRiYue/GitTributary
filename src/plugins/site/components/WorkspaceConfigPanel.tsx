import { useEffect, useState } from "react";
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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { shortPath } from "../state";
import { credentialLabel, defaultPublishDraft, isPublishCandidateUsable, makePublishTarget, purposeLabel } from "../publish";
import type {
  PublishRepoCandidate,
  RemoteConfigEntry,
  SiteWorkspaceEnvVar,
  SiteWorkspaceGroup,
} from "../types";

const PAGES_SOURCE_PRESETS = [
  { id: "main-root", label: "main / root", targetBranch: "main", publishDir: "/" },
  { id: "main-docs", label: "main / docs", targetBranch: "main", publishDir: "docs" },
  { id: "gh-pages-root", label: "gh-pages / root", targetBranch: "gh-pages", publishDir: "/" },
];

interface WorkspaceRepoOption {
  id: string;
  path: string;
  name: string;
  remotes: RemoteConfigEntry[];
}

function repoLabel(path: string) {
  return path.trim() ? shortPath(path) : "未选择";
}

function repoNameFromPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function buildWorkspaceRepoOptions(remotes: RemoteConfigEntry[]): WorkspaceRepoOption[] {
  const groups = new Map<string, RemoteConfigEntry[]>();

  remotes.forEach((remote) => {
    const path = remote.repo_path?.trim();
    if (!path) return;
    const group = groups.get(path) ?? [];
    group.push(remote);
    groups.set(path, group);
  });

  return Array.from(groups.entries())
    .sort(([a], [b]) => repoNameFromPath(a).localeCompare(repoNameFromPath(b)))
    .map(([path, items]) => ({
      id: path,
      path,
      name: repoNameFromPath(path),
      remotes: items,
    }));
}

function envVarId() {
  return `env.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
}

/** 两个发布任务配置是否在业务字段上等价 (忽略 updatedAt)，用于判断草稿是否 dirty。 */
function groupsEqual(a: SiteWorkspaceGroup, b: SiteWorkspaceGroup): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if (a.sourceRepoPath !== b.sourceRepoPath) return false;
  if (JSON.stringify(a.target) !== JSON.stringify(b.target)) return false;
  if (JSON.stringify(a.env) !== JSON.stringify(b.env)) return false;
  return true;
}

function WorkspaceGroupRow({
  group,
  active,
  onSelect,
}: {
  group: SiteWorkspaceGroup;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-h-20 w-full min-w-0 flex-col justify-center gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-primary/35 bg-primary/5 text-foreground shadow-sm"
          : "bg-background/70 hover:border-primary/20 hover:bg-accent/45",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="gt-body-strong truncate">{group.name || "未命名任务"}</span>
        {active && <Badge variant="secondary" className="h-5 px-1.5 gt-caption">当前</Badge>}
      </div>
      <span className="gt-caption truncate text-muted-foreground">
        {repoLabel(group.sourceRepoPath)}
      </span>
      <span className="gt-caption truncate text-muted-foreground">
        文档范围 {group.documentScope.length} 项 · {group.target ? "已配发布仓库" : "未配发布仓库"}
      </span>
    </button>
  );
}

function EnvVarRow({
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

function PublishCandidateRow({
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
  onCreateGroup: () => void;
  onSelectGroup: (id: string) => void;
  onUpdateGroup: (id: string, updater: (group: SiteWorkspaceGroup) => SiteWorkspaceGroup) => void;
  onDeleteGroup: (id: string) => void;
  onRefreshRemoteConfigs: () => void;
}) {
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null;

  // 发布任务配置是「本地草稿 + 手动保存」模式: 编辑任务名/源仓库/发布仓库
  // 参数/环境变量都只改本地 draft，不再实时写回 onUpdateGroup；点击「保存」
  // 才提交草稿。draft 随 activeGroup.id 变化重新播种 (切换任务时)。
  const [draft, setDraft] = useState<SiteWorkspaceGroup | null>(activeGroup);
  useEffect(() => {
    setDraft(activeGroup);
    // 只在切换到不同任务时重新播种，不随 activeGroup 内容变化 (例如另一处
    // 通过 onUpdateGroup 写入 documentScope) 而覆盖用户正在编辑的草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup?.id]);

  const dirty = Boolean(draft && activeGroup && !groupsEqual(draft, activeGroup));

  const confirmDiscardIfDirty = () => {
    if (!dirty) return true;
    return window.confirm("当前发布任务还有未保存的改动，切换/新建/删除会丢弃这些改动。确定要继续吗？");
  };

  const handleSelectGroup = (id: string) => {
    if (id === activeGroup?.id) return;
    if (!confirmDiscardIfDirty()) return;
    onSelectGroup(id);
  };

  const handleCreateGroup = () => {
    if (!confirmDiscardIfDirty()) return;
    onCreateGroup();
  };

  const handleDeleteGroup = (id: string) => {
    if (!confirmDiscardIfDirty()) return;
    onDeleteGroup(id);
  };

  const saveDraft = () => {
    if (!draft) return;
    onUpdateGroup(draft.id, () => draft);
  };

  const sourceRepoOptions = buildWorkspaceRepoOptions(remoteConfigs);
  const hasSourceRepoOptions = sourceRepoOptions.length > 0;
  const selectedSource = draft
    ? sourceRepoOptions.find((repo) => repo.path === draft.sourceRepoPath) ?? null
    : null;
  const target = draft?.target ?? null;
  const selectedCandidate = target
    ? publishCandidates.find((candidate) => candidate.id === target.targetRepoId) ?? null
    : null;

  const updateDraft = (updater: (group: SiteWorkspaceGroup) => SiteWorkspaceGroup) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const updateTarget = (updater: (target: NonNullable<SiteWorkspaceGroup["target"]>) => NonNullable<SiteWorkspaceGroup["target"]>) => {
    updateDraft((group) => (group.target ? { ...group, target: updater(group.target) } : group));
  };

  const selectPublishCandidate = (candidate: PublishRepoCandidate) => {
    updateDraft((group) => ({
      ...group,
      target: makePublishTarget(candidate, defaultPublishDraft(candidate)),
    }));
  };

  const addEnvVar = () => {
    updateDraft((group) => ({
      ...group,
      env: [
        ...group.env,
        {
          id: envVarId(),
          key: "",
          value: "",
          enabled: true,
        },
      ],
    }));
  };

  return (
    <section className="mx-auto w-full max-w-5xl overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            <div className="gt-title-panel">发布任务</div>
            <Badge variant="outline" className="h-5 px-1.5 gt-caption">{groups.length} 个任务</Badge>
          </div>
          <p className="gt-caption mt-1 text-muted-foreground">
            仅配置源仓库、发布仓库与文档范围所需的参数;构建与发布在「构建结果」工作台执行。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={onRefreshRemoteConfigs} title="重新拉取 Git 模块的远程配置">
            <RefreshCw className="size-3.5" />
            刷新远程配置
          </Button>
          <Button size="sm" variant="outline" onClick={handleCreateGroup}>
            <Plus className="size-3.5" />
            新建任务
          </Button>
        </div>
      </div>

      <div className="grid min-h-[560px] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b bg-muted/10 p-3 lg:border-b-0 lg:border-r">
          {groups.length === 0 ? (
            <div className="rounded-md border border-dashed bg-background px-4 py-7 text-center">
              <div className="gt-body-strong">还没有发布任务</div>
              <p className="gt-caption mt-1 text-muted-foreground">先新建一个发布任务。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((group) => (
                <WorkspaceGroupRow
                  key={group.id}
                  group={group}
                  active={group.id === activeGroup?.id}
                  onSelect={() => handleSelectGroup(group.id)}
                />
              ))}
            </div>
          )}
        </aside>

        <main className="min-w-0 px-5 py-5">
          {!draft ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
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
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/20 px-3 py-2">
                <div className="flex items-center gap-2">
                  {dirty ? (
                    <Badge variant="outline" className="h-5 px-1.5 gt-caption text-amber-600">未保存</Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 px-1.5 gt-caption text-muted-foreground">已保存</Badge>
                  )}
                  <span className="gt-caption text-muted-foreground">编辑不会自动生效,需点击保存写入本地配置。</span>
                </div>
                <Button size="sm" onClick={saveDraft} disabled={!dirty}>
                  <Save className="size-3.5" />
                  保存
                </Button>
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="gt-body-strong">任务名称</div>
                    <p className="gt-caption text-muted-foreground">例如「个人博客」「团队文档」「产品手册」。</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteGroup(draft.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Input
                  value={draft.name}
                  onChange={(event) => updateDraft((group) => ({ ...group, name: event.target.value }))}
                  placeholder="发布任务名称"
                />
              </section>

              <section className="space-y-3">
                <div>
                  <div className="gt-body-strong">源仓库</div>
                  <p className="gt-caption text-muted-foreground">只能从 Git 已配置的工作仓库中选择。</p>
                </div>
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
                      <div className="rounded-md border bg-muted/30 px-3 py-2">
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
                  <div className="rounded-md border border-dashed px-4 py-5 text-center">
                    <div className="gt-body-strong">暂无已配置工作仓库</div>
                    <p className="gt-caption mt-1 text-muted-foreground">
                      先到 Git 模块的远程配置中打开、Clone 或绑定仓库,然后点击右上方"刷新远程配置"。
                    </p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={onRefreshRemoteConfigs}>
                      <RefreshCw className="size-3.5" />
                      刷新远程配置
                    </Button>
                  </div>
                )}
              </section>

              <section className="space-y-3 rounded-lg border bg-muted/10 p-4">
                <div className="flex items-center gap-2">
                  <Globe2 className="size-4 text-muted-foreground" />
                  <div className="gt-body-strong">发布仓库</div>
                  {target ? (
                    <Badge variant="secondary" className="h-5 px-1.5 gt-caption">已配置</Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 px-1.5 gt-caption">未配置</Badge>
                  )}
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="gt-caption text-muted-foreground">优先选择独立 Pages 仓库。</p>
                      <Badge variant="outline" className="h-5 px-1.5 gt-caption">{publishCandidates.length} 个候选</Badge>
                    </div>

                    {publishCandidates.length === 0 ? (
                      <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed bg-background px-4 py-6 text-center">
                        <GitBranch className="size-7 text-muted-foreground" />
                        <div className="gt-body-strong mt-2">暂无可用发布仓库</div>
                        <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                          先在远程配置中 Clone 或绑定一个 Pages 仓库,然后点击"刷新远程配置"。
                        </p>
                        <Button size="sm" variant="outline" className="mt-3" onClick={onRefreshRemoteConfigs}>
                          <RefreshCw className="size-3.5" />
                          刷新远程配置
                        </Button>
                      </div>
                    ) : (
                      <div className="gt-thin-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
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
                              onClick={() => window.open(target.pagesUrl, "_blank", "noopener,noreferrer")}
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
                      <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed bg-background px-4 py-6 text-center">
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
          )}
        </main>
      </div>
    </section>
  );
}
