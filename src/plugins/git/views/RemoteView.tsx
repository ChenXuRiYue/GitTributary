import { useCallback, useEffect, useState } from "react";
import {
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

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
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
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [configUrl, setConfigUrl] = useState("");
  const [configBranch, setConfigBranch] = useState("main");
  const [configToken, setConfigToken] = useState("");
  const [showConfigToken, setShowConfigToken] = useState(false);
  const [checkingConfig, setCheckingConfig] = useState(false);
  const [addingRemote, setAddingRemote] = useState(false);
  const [configCheck, setConfigCheck] = useState<ConfigRepoCheckReport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      await loadRemoteConfigs();
    } catch (e) {
      setOverview(null);
      setRemotes([]);
      const message = String(e);
      nextError = message === "尚未打开仓库" ? null : message;
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
      await loadRemoteConfigs();
      setError(null);
    } catch (e) {
      setOverview(null);
      setRemotes([]);
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

  const handleAddRemote = async () => {
    if (!overview || !newName.trim() || !newUrl.trim()) return;
    setAddingRemote(true);
    try {
      setError(null);
      await invoke("add_remote", { name: newName.trim(), url: newUrl.trim() });
      let tokenWarning: string | null = null;
      if (newToken.trim()) {
        try {
          await invoke("set_project_token", { token: newToken.trim() });
        } catch (e) {
          tokenWarning = `远程已添加,但 Token 保存失败: ${String(e)}`;
        }
      }
      setNewName(""); setNewUrl(""); setNewToken("");
      flash(tokenWarning ?? "远程已添加");
      await loadRemoteConfigs();
    } catch (e) {
      setError(String(e));
    } finally {
      setAddingRemote(false);
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
                请选择一个 Git 仓库后再新增本地 remote 配置。
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
              return (
              <div key={`${r.source}:${r.name}`} className="flex flex-col gap-3 rounded-md border px-2 py-2">
                <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium">{r.name}</span>
                    {r.push_url && <Badge variant="outline" className="h-4 px-1 text-[8px]">push-url</Badge>}
                    <Badge variant="secondary" className="h-4 px-1 text-[8px]">{verifyLabel(r.verify_status)}</Badge>
                  </div>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{r.url}</span>
                  {r.push_url && (
                    <span className="truncate font-mono text-[10px] text-muted-foreground">push {r.push_url}</span>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{sourceLabel(r.source)}</Badge>
                    {r.purpose.map((item) => (
                      <Badge key={item} variant="outline" className="h-5 px-1.5 text-[9px]">{purposeLabel(item)}</Badge>
                    ))}
                    <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{credentialLabel(r.credential_mode)}</Badge>
                    <Badge variant="outline" className="h-5 px-1.5 text-[9px]">能力 {r.capabilities}</Badge>
                  </div>
                  {r.credential_ref && (
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{r.credential_ref}</span>
                  )}
                </div>
                </div>
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
              );
            })
          )}

        </CardContent>
      </Card>

      {/* 添加远程配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Plus className="size-4" /> 新增 remote 配置
            <Badge variant="outline" className="text-[9px] text-destructive/70">仅本地 · L0</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-[88px_1fr] items-center gap-2">
            <span className="text-[11px] text-muted-foreground">名称</span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="origin"
              className="h-8 text-xs"
            />
            <span className="text-[11px] text-muted-foreground">URL</span>
            <div className="relative">
              <Link className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="git@github.com:user/repo.git"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <span className="text-[11px] text-muted-foreground">Access Token</span>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder="可选: HTTPS 推送使用"
                className="h-8 pr-8 text-xs"
              />
              <button type="button" onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              Token 会保存为当前项目凭据;仓库操作暂不在此页暴露。
            </p>
            <Button size="sm" className="h-8" onClick={handleAddRemote}
              disabled={!overview || addingRemote || !newName.trim() || !newUrl.trim()}>
              <Save className="size-3.5" /> {addingRemote ? "添加中" : "添加"}
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
