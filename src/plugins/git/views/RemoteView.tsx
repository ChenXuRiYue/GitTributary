import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  FolderOpen,
  GitBranch,
  Globe,
  Link,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RemoteInfo {
  name: string;
  url: string;
  push_url: string | null;
  repo_path: string | null;
  source: string;
  purpose: string[];
  credential_mode: string;
  credential_ref: string | null;
  verify_status: string;
  capabilities: string;
}

interface SyncConfigPayload {
  url: string;
  branch: string;
  active_environment_id?: string | null;
  local_database_path?: string | null;
  auto_sync: boolean;
  interval_seconds: number;
}

interface ConfigRepoCheckReport {
  ok: boolean;
  status: string;
  message: string;
  default_branch: string | null;
  refs_count: number;
}

interface RepoOverview {
  path: string;
  current_branch: string;
  is_dirty: boolean;
  changed_count: number;
  remote_url: string | null;
}

interface WorkspaceInfo {
  active_repo: string | null;
  recent_repos: string[];
  device_id: string | null;
  device_name: string | null;
}

interface RemoteDraft {
  url: string;
  token: string;
  showToken: boolean;
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}

function remoteKey(remote: Pick<RemoteInfo, "name" | "repo_path">): string {
  return `${remote.repo_path ?? "app"}:${remote.name}`;
}

function repositoryNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/?#]+$/, "");
  const lastSegment = trimmed.split(/[/:]/).filter(Boolean).pop() ?? "";
  return lastSegment.replace(/\.git$/, "") || "remote";
}

function repositoryName(remote: Pick<RemoteInfo, "name" | "repo_path" | "url">): string {
  const pathName = remote.repo_path
    ?.replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  return pathName || repositoryNameFromUrl(remote.url) || remote.name;
}

function mergeRepoOptions(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  paths.forEach((path) => {
    const normalized = path?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push(normalized);
  });
  return options;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "local_git_config": return "当前仓库 .git/config";
    case "gittributary_config": return "GitTributary 配置";
    case "system_discovered": return "系统发现";
    case "imported": return "导入";
    default: return source;
  }
}

function purposeLabel(purpose: string): string {
  switch (purpose) {
    case "current_repo_remote": return "当前仓库 remote";
    case "bound_repo_remote": return "绑定仓库 remote";
    case "data_center_sync": return "数据中心同步";
    case "backup_target": return "备份目标";
    case "publish_target": return "发布目标";
    case "mirror": return "镜像";
    default: return purpose;
  }
}

function credentialLabel(mode: string): string {
  switch (mode) {
    case "repo_token": return "项目 Token";
    case "remote_token": return "Remote Token";
    case "config_repo_token": return "配置中心 Token";
    case "app_global_token": return "全局 Token";
    case "ssh_key": return "指定 SSH Key";
    case "ssh_agent": return "SSH Agent";
    case "system": return "系统 Git 凭据";
    case "none": return "未配置";
    default: return mode;
  }
}

function verifyLabel(status: string): string {
  switch (status) {
    case "unverified": return "未验证";
    case "configured": return "已配置";
    case "valid": return "可用";
    case "auth_failed": return "认证失败";
    case "network_failed": return "网络失败";
    case "permission_denied": return "权限不足";
    default: return status;
  }
}

export function RemoteView() {
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [syncConfig, setSyncConfig] = useState<SyncConfigPayload | null>(null);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneParentPath, setCloneParentPath] = useState("");
  const [cloneToken, setCloneToken] = useState("");
  const [showCloneToken, setShowCloneToken] = useState(false);
  const [configUrl, setConfigUrl] = useState("");
  const [configBranch, setConfigBranch] = useState("main");
  const [configToken, setConfigToken] = useState("");
  const [showConfigToken, setShowConfigToken] = useState(false);
  const [checkingConfig, setCheckingConfig] = useState(false);
  const [addingRemote, setAddingRemote] = useState(false);
  const [remoteDrafts, setRemoteDrafts] = useState<Record<string, RemoteDraft>>({});
  const [remoteBusyKey, setRemoteBusyKey] = useState<string | null>(null);
  const [expandedRemoteKeys, setExpandedRemoteKeys] = useState<Record<string, boolean>>({});
  const [configCheck, setConfigCheck] = useState<ConfigRepoCheckReport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRemoteDrafts((current) => {
      const next = { ...current };
      const activeKeys = new Set<string>();

      remotes.forEach((remote) => {
        if (remote.source !== "local_git_config") return;
        const key = remoteKey(remote);
        activeKeys.add(key);
        if (!next[key]) {
          next[key] = { url: remote.url, token: "", showToken: false };
        }
      });

      Object.keys(next).forEach((key) => {
        if (!activeKeys.has(key)) delete next[key];
      });

      return next;
    });
  }, [remotes]);

  const loadRemoteConfigs = useCallback(async () => {
    const r = await invoke<RemoteInfo[]>("get_remote_configs");
    setRemotes(r);
  }, []);

  const loadSyncConfig = useCallback(async () => {
    const config = await invoke<SyncConfigPayload | null>("sync_get_config");
    setSyncConfig(config);
    if (config) {
      setConfigUrl(config.url);
      setConfigBranch(config.branch || "main");
    }
  }, []);

  const refresh = useCallback(async () => {
    let nextError: string | null = null;

    try {
      const ov = await invoke<RepoOverview>("get_overview");
      setOverview(ov);
    } catch (e) {
      setOverview(null);
      const message = String(e);
      nextError = message === "尚未打开仓库" ? null : message;
    }

    try {
      await loadRemoteConfigs();
    } catch (e) {
      nextError = nextError
        ? `${nextError}; 远程配置读取失败: ${String(e)}`
        : `远程配置读取失败: ${String(e)}`;
    }

    try {
      await loadSyncConfig();
    } catch (e) {
      nextError = nextError
        ? `${nextError}; 配置中心读取失败: ${String(e)}`
        : `配置中心读取失败: ${String(e)}`;
    }

    setError(nextError);
  }, [loadRemoteConfigs, loadSyncConfig]);

  const openRepo = useCallback(async (path: string) => {
    try {
      const ov = await invoke<RepoOverview>("open_repo", { path });
      setOverview(ov);
      setRecentRepos((current) => mergeRepoOptions([ov.path, ...current]).slice(0, 10));
      await loadRemoteConfigs();
      setError(null);
    } catch (e) {
      setOverview(null);
      await loadRemoteConfigs().catch(() => setRemotes([]));
      setError(String(e));
      return;
    }

    try {
      await loadSyncConfig();
    } catch (e) {
      setError(`配置中心读取失败: ${String(e)}`);
    }
  }, [loadRemoteConfigs, loadSyncConfig]);

  useEffect(() => {
    (async () => {
      try {
        const ws = await invoke<WorkspaceInfo>("get_workspace_info");
        setRecentRepos(ws.recent_repos ?? []);
        if (ws.active_repo) {
          await openRepo(ws.active_repo);
        } else {
          await refresh();
        }
      } catch {
        await refresh();
      }
    })();
  }, [openRepo, refresh]);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  };

  const openFromDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    await openRepo(selected as string);
  };

  const selectClonePathFromDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    setCloneParentPath(selected as string);
  };

  const handleCloneRemote = async () => {
    if (!cloneParentPath.trim() || !cloneUrl.trim() || !cloneToken.trim()) return;
    setAddingRemote(true);
    try {
      setError(null);
      const ov = await invoke<RepoOverview>("clone_remote_repo", {
        url: cloneUrl.trim(),
        parentPath: cloneParentPath.trim(),
        token: cloneToken.trim(),
      });
      setOverview(ov);
      setRecentRepos((current) => mergeRepoOptions([ov.path, ...current]).slice(0, 10));
      setCloneUrl(""); setCloneParentPath(""); setCloneToken("");
      flash(`Token 校验通过,仓库已 Clone 到 ${shortPath(ov.path)}`);
      await loadRemoteConfigs();
    } catch (e) {
      setError(String(e));
    } finally {
      setAddingRemote(false);
    }
  };

  const updateRemoteDraft = (key: string, patch: Partial<RemoteDraft>) => {
    setRemoteDrafts((current) => {
      const currentDraft = current[key] ?? { url: "", token: "", showToken: false };
      return {
        ...current,
        [key]: {
          ...currentDraft,
          ...patch,
        },
      };
    });
  };

  const handleUpdateRemote = async (remote: RemoteInfo) => {
    const key = remoteKey(remote);
    const draft = remoteDrafts[key] ?? { url: remote.url, token: "", showToken: false };
    const repoPath = remote.repo_path ?? overview?.path ?? "";
    if (!repoPath || !draft.url.trim() || !draft.token.trim()) return;

    setRemoteBusyKey(key);
    try {
      setError(null);
      await invoke("set_remote_url", {
        name: remote.name,
        url: draft.url.trim(),
        repoPath,
        token: draft.token.trim(),
      });
      updateRemoteDraft(key, { token: "" });
      flash("Token 校验通过,远程已更新");
      await loadRemoteConfigs();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoteBusyKey(null);
    }
  };

  const handleRemoveRemote = async (remote: RemoteInfo) => {
    const key = remoteKey(remote);
    const repoPath = remote.repo_path ?? overview?.path ?? "";
    if (!repoPath) return;
    if (!window.confirm(`删除远程 ${remote.name}?`)) return;

    setRemoteBusyKey(key);
    try {
      setError(null);
      await invoke("remove_remote", { name: remote.name, repoPath });
      flash("远程已删除");
      await loadRemoteConfigs();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoteBusyKey(null);
    }
  };

  const configPayload = (): SyncConfigPayload => ({
    url: configUrl.trim(),
    branch: configBranch.trim() || "main",
    active_environment_id: syncConfig?.active_environment_id ?? null,
    local_database_path: syncConfig?.local_database_path ?? null,
    auto_sync: syncConfig?.auto_sync ?? true,
    interval_seconds: syncConfig?.interval_seconds ?? 300,
  });

  const handleCheckConfigRepo = async () => {
    if (!configUrl.trim()) return;
    try {
      setCheckingConfig(true);
      const report = await invoke<ConfigRepoCheckReport>("check_data_center_config_repo", {
        url: configUrl.trim(),
        token: configToken.trim() || null,
      });
      setConfigCheck(report);
      if (report.ok && report.default_branch && !configBranch.trim()) {
        setConfigBranch(report.default_branch);
      }
    } catch (e) {
      setConfigCheck({
        ok: false,
        status: "error",
        message: String(e),
        default_branch: null,
        refs_count: 0,
      });
    } finally {
      setCheckingConfig(false);
    }
  };

  const handleSaveConfigRemote = async () => {
    if (!configUrl.trim()) return;
    try {
      await invoke("update_data_center_config_remote", {
        config: configPayload(),
        token: configToken.trim() || null,
        clearToken: false,
      });
      setConfigToken("");
      flash("配置中心远程已保存并拉取到本地工作副本");
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const handleUnbindConfigRemote = async () => {
    try {
      await invoke("unbind_data_center_config_remote", { clearToken: true });
      setConfigUrl("");
      setConfigBranch("main");
      setConfigToken("");
      setConfigCheck(null);
      flash("配置中心远程已解绑");
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const hasConfigRemote = remotes.some((r) => r.source === "gittributary_config");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">远程配置</div>
            <div className="text-[11px] text-muted-foreground">
              {overview ? `${overview.current_branch} · ${shortPath(overview.path)}` : "管理当前仓库 remote 与 GitTributary 远程配置"}
            </div>
          </div>
          {recentRepos[0] && !overview && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openRepo(recentRepos[0])} title="打开最近仓库">
              <Clock className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={openFromDialog} title="打开仓库">
            <FolderOpen className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={refresh} title="刷新">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
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
              <Button variant="outline" size="sm" className="h-8" onClick={() => openRepo(recentRepos[0])}>
                <Clock className="size-3.5" /> {shortPath(recentRepos[0])}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8" onClick={openFromDialog}>
              <FolderOpen className="size-3.5" /> 选择仓库
            </Button>
          </div>
        </div>
      )}

      {/* 远程配置列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Globe className="size-4" /> 已配置远程仓库
            <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[9px]">{remotes.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {remotes.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无远程仓库配置</p>
          ) : (
            remotes.map((r) => {
              const isConfigCenter = r.source === "gittributary_config";
              const isLocalRemote = r.source === "local_git_config";
              const key = remoteKey(r);
              const draft = remoteDrafts[key] ?? { url: r.url, token: "", showToken: false };
              const isBusy = remoteBusyKey === key;
              const isExpanded = expandedRemoteKeys[key] ?? false;
              return (
              <div key={`${r.source}:${key}`} className="flex flex-col rounded-md border px-2.5 py-2">
                <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(0,1.2fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{repositoryName(r)}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{r.name}</div>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {r.repo_path ?? "配置中心工作副本"}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{r.url}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 px-0"
                    onClick={() => setExpandedRemoteKeys((current) => ({ ...current, [key]: !isExpanded }))}
                    title={isExpanded ? "收起" : "展开"}
                  >
                    <ChevronDown className={`size-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </Button>
                </div>
                {isExpanded && (
                  <div className="mt-3 flex flex-col gap-3 border-t pt-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{sourceLabel(r.source)}</Badge>
                      {r.purpose.map((item) => (
                        <Badge key={item} variant="outline" className="h-5 px-1.5 text-[9px]">{purposeLabel(item)}</Badge>
                      ))}
                      <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{credentialLabel(r.credential_mode)}</Badge>
                      <Badge variant="outline" className="h-5 px-1.5 text-[9px]">能力 {r.capabilities}</Badge>
                      {r.push_url && <Badge variant="outline" className="h-5 px-1.5 text-[9px]">push-url</Badge>}
                      {!isLocalRemote && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">{verifyLabel(r.verify_status)}</Badge>
                      )}
                    </div>
                    {r.push_url && (
                      <span className="truncate font-mono text-[10px] text-muted-foreground">push {r.push_url}</span>
                    )}
                    {r.credential_ref && (
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{r.credential_ref}</span>
                    )}
                    {isLocalRemote && (
                      <div className="rounded-md bg-muted/20 p-3">
                        <div className="grid grid-cols-[72px_1fr] items-center gap-2">
                          <span className="text-[11px] font-medium text-muted-foreground">URL</span>
                          <Input
                            value={draft.url}
                            onChange={(e) => updateRemoteDraft(key, { url: e.target.value })}
                            placeholder="https://github.com/user/repo.git"
                            className="h-8 text-xs"
                          />
                          <span className="text-[11px] font-medium text-muted-foreground">Token</span>
                          <div className="relative">
                            <Input
                              type={draft.showToken ? "text" : "password"}
                              value={draft.token}
                              onChange={(e) => updateRemoteDraft(key, { token: e.target.value })}
                              placeholder="必填: 保存前重新校验"
                              className="h-8 pr-8 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => updateRemoteDraft(key, { showToken: !draft.showToken })}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                            >
                              {draft.showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => handleUpdateRemote(r)}
                            disabled={isBusy || !draft.url.trim() || !draft.token.trim()}
                          >
                            <Save className="size-3.5" /> {isBusy ? "校验中" : "保存"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveRemote(r)}
                            disabled={isBusy}
                          >
                            <Trash2 className="size-3.5" /> 删除
                          </Button>
                        </div>
                      </div>
                    )}
                    {isConfigCenter && (
                      <div className="rounded-md bg-muted/30 p-3">
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-[72px_1fr] items-center gap-2 rounded-md border bg-background/70 p-2">
                            <span className="text-[11px] font-medium text-muted-foreground">URL</span>
                            <Input
                              value={configUrl}
                              onChange={(e) => setConfigUrl(e.target.value)}
                              placeholder="https://github.com/org/config-repo.git"
                              className="h-8 text-xs"
                            />
                            <span className="text-[11px] font-medium text-muted-foreground">Token</span>
                            <div className="relative">
                              <Input
                                type={showConfigToken ? "text" : "password"}
                                value={configToken}
                                onChange={(e) => setConfigToken(e.target.value)}
                                placeholder="留空则沿用已保存 Token"
                                className="h-8 pr-8 text-xs"
                              />
                              <button type="button" onClick={() => setShowConfigToken(!showConfigToken)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                                {showConfigToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-[72px_1fr] items-center gap-2 px-2">
                            <span className="text-[11px] text-muted-foreground">分支</span>
                            <Input
                              value={configBranch}
                              onChange={(e) => setConfigBranch(e.target.value)}
                              placeholder="main"
                              className="h-8 text-xs"
                            />
                            <span className="text-[11px] text-muted-foreground">本地工作副本</span>
                            <div className="truncate rounded-md border bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                              {syncConfig?.local_database_path ?? "保存后由数据中心分配"}
                            </div>
                          </div>
                        </div>
                        {configCheck && (
                          <div className={`mt-2 rounded-md px-2 py-1.5 text-[11px] ${configCheck.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                            {configCheck.message}
                            {configCheck.ok && configCheck.default_branch && (
                              <span className="ml-2 text-muted-foreground">默认分支 {configCheck.default_branch}</span>
                            )}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          <Button variant="outline" size="sm" className="h-8" onClick={handleCheckConfigRepo} disabled={!configUrl.trim() || checkingConfig}>
                            <ShieldCheck className="size-3.5" /> {checkingConfig ? "验证中" : "验证"}
                          </Button>
                          <Button size="sm" className="h-8" onClick={handleSaveConfigRemote} disabled={!configUrl.trim()}>
                            <Save className="size-3.5" /> 保存
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={handleUnbindConfigRemote}>
                            <Unplug className="size-3.5" /> 解绑
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })
          )}

        </CardContent>
      </Card>

      {/* Clone 远程仓库 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Plus className="size-4" /> Clone 远程仓库
            <Badge variant="outline" className="text-[9px] text-destructive/70">仅本地 · L0</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-[88px_1fr] items-center gap-2">
            <span className="text-[11px] text-muted-foreground">URL</span>
            <div className="relative">
              <Link className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <span className="text-[11px] text-muted-foreground">保存位置</span>
            <div className="grid min-w-0 grid-cols-[1fr_auto] gap-2">
              <Input
                value={cloneParentPath}
                onChange={(e) => setCloneParentPath(e.target.value)}
                placeholder="/Users/mi/code"
                className="h-8 text-xs"
              />
              <Button variant="outline" size="sm" className="h-8 w-8 px-0" onClick={selectClonePathFromDialog} title="选择本地文件夹">
                <FolderOpen className="size-3.5" />
              </Button>
            </div>
            <span className="text-[11px] text-muted-foreground">Access Token</span>
            <div className="relative">
              <Input
                type={showCloneToken ? "text" : "password"}
                value={cloneToken}
                onChange={(e) => setCloneToken(e.target.value)}
                placeholder="必填: Clone 前校验仓库访问权限"
                className="h-8 pr-8 text-xs"
              />
              <button type="button" onClick={() => setShowCloneToken(!showCloneToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showCloneToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              Clone 前会用 Token 读取远程 refs;仓库会创建在保存位置下。
            </p>
            <Button size="sm" className="h-8" onClick={handleCloneRemote}
              disabled={!cloneParentPath.trim() || addingRemote || !cloneUrl.trim() || !cloneToken.trim()}>
              <Save className="size-3.5" /> {addingRemote ? "Clone 中" : "Clone"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {!hasConfigRemote && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="size-4" /> 配置中心远程
              <Badge variant="outline" className="text-[9px]">数据中心同步</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[88px_1fr] items-center gap-2 rounded-md border bg-muted/20 p-2">
                <span className="text-[11px] font-medium text-muted-foreground">URL</span>
                <Input
                  value={configUrl}
                  onChange={(e) => setConfigUrl(e.target.value)}
                  placeholder="https://github.com/org/config-repo.git"
                  className="h-8 text-xs"
                />
                <span className="text-[11px] font-medium text-muted-foreground">Access Token</span>
                <div className="relative">
                  <Input
                    type={showConfigToken ? "text" : "password"}
                    value={configToken}
                    onChange={(e) => setConfigToken(e.target.value)}
                    placeholder="配置中心必须显式配置"
                    className="h-8 pr-8 text-xs"
                  />
                  <button type="button" onClick={() => setShowConfigToken(!showConfigToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {showConfigToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[88px_1fr] items-center gap-2 px-2">
                <span className="text-[11px] text-muted-foreground">分支</span>
                <Input
                  value={configBranch}
                  onChange={(e) => setConfigBranch(e.target.value)}
                  placeholder="main"
                  className="h-8 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">本地工作副本</span>
                <div className="truncate rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                  保存后由数据中心分配
                </div>
              </div>
            </div>
            {configCheck && (
              <div className={`rounded-md px-2 py-1.5 text-[11px] ${configCheck.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                {configCheck.message}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                成功保存后会拉取到本地工作副本,并作为 GitTributary 远程配置进入上方列表。
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8" onClick={handleCheckConfigRepo} disabled={!configUrl.trim() || checkingConfig}>
                  <ShieldCheck className="size-3.5" /> {checkingConfig ? "验证中" : "验证"}
                </Button>
                <Button size="sm" className="h-8" onClick={handleSaveConfigRemote}
                  disabled={!configUrl.trim() || !configToken.trim()}>
                  <Save className="size-3.5" /> 保存
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
