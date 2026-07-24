import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, FolderOpen, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import type { RepoOverview } from "@/modules/git/types";
import {
  credentialLabel,
  remoteKey,
  repositoryName,
  sourceLabel,
  type RemoteInfo,
  useRemoteView,
  usageLabels,
  verifyLabel,
} from "@/modules/git/hooks/useRemoteView";

interface WorkspaceInfo {
  active_repo: string | null;
  recent_repos: string[];
}

const compactButtonClass = "h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5";

interface RepositoryRemoteGroup {
  key: string;
  name: string;
  path: string | null;
  remotes: RemoteInfo[];
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}

function groupRemotesByRepository(remotes: RemoteInfo[]): RepositoryRemoteGroup[] {
  const groups = new Map<string, RepositoryRemoteGroup>();
  remotes.forEach((remote) => {
    const key = remote.repo_path ?? `remote:${remote.url}`;
    const group = groups.get(key);
    if (group) {
      group.remotes.push(remote);
      return;
    }
    groups.set(key, {
      key,
      name: repositoryName(remote),
      path: remote.repo_path,
      remotes: [remote],
    });
  });
  return Array.from(groups.values());
}

export function GitRemoteSettings() {
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [sessionGeneration, setSessionGeneration] = useState(0);

  const openRepository = useCallback(async (path: string) => {
    const nextOverview = await invoke<RepoOverview>("open_repo", { path });
    setOverview(nextOverview);
    setRecentRepos((current) => Array.from(new Set([nextOverview.path, ...current])).slice(0, 10));
    setSessionGeneration((generation) => generation + 1);
  }, []);

  const refreshRepository = useCallback(async () => {
    try {
      const nextOverview = await invoke<RepoOverview>("get_overview");
      setOverview(nextOverview);
    } catch {
      setOverview(null);
    } finally {
      setSessionGeneration((generation) => generation + 1);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void invoke<WorkspaceInfo>("get_workspace_info").then(async (workspace) => {
      if (cancelled) return;
      setRecentRepos(workspace.recent_repos ?? []);
      if (!workspace.active_repo) {
        setSessionGeneration((generation) => generation + 1);
        return;
      }
      const nextOverview = await invoke<RepoOverview>("open_repo", { path: workspace.active_repo });
      if (cancelled) return;
      setOverview(nextOverview);
      setRecentRepos((current) => Array.from(new Set([nextOverview.path, ...current])).slice(0, 10));
      setSessionGeneration((generation) => generation + 1);
    }).catch(() => {
      if (!cancelled) setSessionGeneration((generation) => generation + 1);
    });
    return () => { cancelled = true; };
  }, []);

  const {
    remotes,
    addRemoteDraft,
    setAddRemoteDraft,
    savingNewRemote,
    remoteDrafts,
    remoteBusyKey,
    expandedRemoteKeys,
    setExpandedRemoteKeys,
    status,
    error,
    refresh,
    openRepo,
    openFromDialog,
    handleAddRemote,
    updateRemoteDraft,
    handleUpdateRemote,
    handleRemoveRemote,
  } = useRemoteView({ overview, sessionGeneration, openRepository, refreshRepository });
  const repositories = useMemo(() => groupRemotesByRepository(remotes), [remotes]);

  const handleOpenRecent = () => {
    const path = recentRepos[0];
    if (path) void openRepo(path);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">
          <section aria-labelledby="git-repositories-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 id="git-repositories-heading" className="na-title-section">已打开仓库</h2>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{repositories.length}</Badge>
                </div>
                <p className="mt-1 na-caption text-muted-foreground">远端、仓库提交身份与访问凭据</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!overview && recentRepos[0] && (
                  <Button type="button" variant="ghost" size="sm" className={compactButtonClass} onClick={handleOpenRecent}>
                    <FolderOpen />
                    打开最近仓库
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" className={compactButtonClass} onClick={() => void openFromDialog()}>
                  <FolderOpen />
                  打开仓库
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => void refresh()} title="刷新仓库配置" aria-label="刷新仓库配置">
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
            </div>

            {status && <p role="status" className="mt-3 rounded-md bg-primary/10 px-3 py-2 na-caption text-primary">{status}</p>}
            {error && <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 na-caption text-destructive">{error}</p>}

            {repositories.length === 0 ? (
              <div className="mt-4 rounded-md bg-muted/30 px-4 py-5">
                <p className="na-body-strong">还没有带远端的已打开仓库</p>
                <p className="mt-1 na-caption text-muted-foreground">
                  打开一个本地仓库后，它的远端会自动出现在这里。
                </p>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-1.5">
                {repositories.map((repository) => {
                  const usage = usageLabels(repository.remotes.flatMap((remote) => remote.purpose));
                  return (
                    <div key={repository.key} className="rounded-md bg-muted/25 px-3 py-2.5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <FolderOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="na-body-strong truncate">{repository.name}</span>
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                              {repository.remotes.length} 个远端
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {repository.path ? shortPath(repository.path) : "未关联本地仓库"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="na-caption text-muted-foreground">使用情况</span>
                            {usage.map((label) => <Badge key={label} variant="secondary" className="h-5 px-1.5 text-[10px]">{label}</Badge>)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 divide-y divide-border/50 border-t border-border/50">
                        {repository.remotes.map((remote) => {
                          const key = remoteKey(remote);
                          const expanded = expandedRemoteKeys[key] ?? false;
                          const draft = remoteDrafts[key] ?? {
                            url: remote.url,
                            token: "",
                            commitName: remote.commit_name ?? "",
                            commitEmail: remote.commit_email ?? "",
                            showToken: false,
                          };
                          const isLocal = remote.source === "local_git_config";
                          const isBusy = remoteBusyKey === key;
                          return (
                            <div key={`${remote.source}:${key}`} className="py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">{remote.name}</Badge>
                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{remote.url}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 shrink-0"
                                  onClick={() => setExpandedRemoteKeys((current) => ({ ...current, [key]: !expanded }))}
                                  aria-label={`${expanded ? "收起" : "查看"} ${repository.name} ${remote.name}`}
                                  title={expanded ? "收起远端配置" : "查看远端配置"}
                                >
                                  <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
                                </Button>
                              </div>

                              {expanded && (
                                <div className="mt-2 flex flex-col gap-2.5 pl-1 sm:pr-9">
                                  <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{sourceLabel(remote.source)}</Badge>
                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{credentialLabel(remote.credential_mode)}</Badge>
                                    {!isLocal && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{verifyLabel(remote.verify_status)}</Badge>}
                                  </div>
                                  {remote.push_url && <p className="truncate font-mono text-[11px] text-muted-foreground">push {remote.push_url}</p>}
                                  {isLocal && (
                                    <div className="grid gap-2 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center">
                                      <span className="na-label text-muted-foreground">远端地址</span>
                                      <Input value={draft.url} onChange={(event) => updateRemoteDraft(key, { url: event.target.value })} className="h-8 text-xs" />
                                      <span className="na-label text-muted-foreground">提交名称</span>
                                      <Input value={draft.commitName} onChange={(event) => updateRemoteDraft(key, { commitName: event.target.value })} placeholder="留空使用全局身份" className="h-8 text-xs" />
                                      <span className="na-label text-muted-foreground">提交邮箱</span>
                                      <Input value={draft.commitEmail} onChange={(event) => updateRemoteDraft(key, { commitEmail: event.target.value })} placeholder="留空使用全局身份" className="h-8 text-xs" />
                                      <span className="na-label text-muted-foreground">Access Token</span>
                                      <Input aria-label="Access Token" type="password" value={draft.token} onChange={(event) => updateRemoteDraft(key, { token: event.target.value })} placeholder="重新输入以验证远端" className="h-8 text-xs" />
                                      <p className="sm:col-start-2 na-caption text-muted-foreground">保存更改时需要重新输入该远端的 Access Token。</p>
                                      <div className="flex justify-end gap-1.5 sm:col-start-2">
                                        <Button type="button" size="sm" className={compactButtonClass} onClick={() => void handleUpdateRemote(remote)} disabled={isBusy || !draft.url.trim() || !draft.token.trim()}>
                                          <Save />
                                          {isBusy ? "校验中" : "保存更改"}
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className={cn(compactButtonClass, "text-destructive hover:text-destructive")} onClick={() => void handleRemoveRemote(remote)} disabled={isBusy}>
                                          <Trash2 />
                                          删除
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {overview && (
            <details className="rounded-md bg-muted/25">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 na-body-strong">
                <Plus className="size-3.5 text-muted-foreground" />
                添加远端
                <span className="ml-auto na-caption text-muted-foreground">当前仓库 · {shortPath(overview.path)}</span>
              </summary>
              <form
                className="grid gap-2 border-t border-border/50 px-3 py-3 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddRemote();
                }}
              >
                <label htmlFor="git-add-remote-name" className="na-label text-muted-foreground">名称</label>
                <Input id="git-add-remote-name" value={addRemoteDraft.name} onChange={(event) => setAddRemoteDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="origin" className="h-8 text-xs" />
                <label htmlFor="git-add-remote-url" className="na-label text-muted-foreground">远端地址</label>
                <Input id="git-add-remote-url" type="url" value={addRemoteDraft.url} onChange={(event) => setAddRemoteDraft((draft) => ({ ...draft, url: event.target.value }))} placeholder="https://github.com/org/repo.git" className="h-8 text-xs" />
                <label htmlFor="git-add-remote-token" className="na-label text-muted-foreground">Access Token</label>
                <Input id="git-add-remote-token" type="password" value={addRemoteDraft.token} onChange={(event) => setAddRemoteDraft((draft) => ({ ...draft, token: event.target.value }))} placeholder="用于验证远端访问" className="h-8 text-xs" />
                <label htmlFor="git-add-remote-name-override" className="na-label text-muted-foreground">提交名称</label>
                <Input id="git-add-remote-name-override" value={addRemoteDraft.commitName} onChange={(event) => setAddRemoteDraft((draft) => ({ ...draft, commitName: event.target.value }))} placeholder="留空使用全局身份" className="h-8 text-xs" />
                <label htmlFor="git-add-remote-email-override" className="na-label text-muted-foreground">提交邮箱</label>
                <Input id="git-add-remote-email-override" type="email" value={addRemoteDraft.commitEmail} onChange={(event) => setAddRemoteDraft((draft) => ({ ...draft, commitEmail: event.target.value }))} placeholder="留空使用全局身份" className="h-8 text-xs" />
                <div className="flex justify-end sm:col-start-2">
                  <Button type="submit" size="sm" className={compactButtonClass} disabled={savingNewRemote || !addRemoteDraft.name.trim() || !addRemoteDraft.url.trim() || !addRemoteDraft.token.trim()}>
                    <Plus />
                    {savingNewRemote ? "校验中" : "添加远端"}
                  </Button>
                </div>
              </form>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
