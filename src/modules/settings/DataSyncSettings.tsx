import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  GitBranch,
  Link2,
  RefreshCw,
  Unplug,
} from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import { DataSpaceSection } from "./DataSpaceSection";

interface DataCenterCredentialStatus {
  has_token: boolean;
  token_masked: string | null;
}

export interface SyncConfig {
  url: string;
  branch: string;
  active_environment_id?: string | null;
  local_database_path?: string | null;
  auto_sync: boolean;
  interval_seconds: number;
}

interface RemoteRepository {
  name: string;
  url: string;
  repo_path: string | null;
  source: string;
  credential_mode: string;
}

interface Notice {
  tone: "success" | "error" | "progress";
  message: string;
}

interface ConfigRepoCheckReport {
  ok: boolean;
  message: string;
  default_branch: string | null;
}

interface DataSyncSettingsProps {
  embedded?: boolean;
  syncConfig?: SyncConfig | null;
  onSyncConfigChange?: (config: SyncConfig | null) => void;
}

const compactButtonClass = "h-7 gap-1 px-2 text-[11px] [&_svg]:size-3";

function remoteKey(remote: RemoteRepository): string {
  return `${remote.repo_path ?? ""}::${remote.name}`;
}

function remoteLabel(remote: RemoteRepository): string {
  const repository = remote.repo_path
    ?.replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  return repository ? `${repository} / ${remote.name}` : remote.name;
}

export function DataSyncSettings({
  embedded = false,
  syncConfig: externalSyncConfig,
  onSyncConfigChange,
}: DataSyncSettingsProps = {}) {
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [credential, setCredential] = useState<DataCenterCredentialStatus | null>(null);
  const [remotes, setRemotes] = useState<RemoteRepository[]>([]);
  const [selectedRemoteKey, setSelectedRemoteKey] = useState("");
  const [spaces, setSpaces] = useState<string[]>(["default"]);
  const [activeSpace, setActiveSpace] = useState("default");
  const [showDirectBind, setShowDirectBind] = useState(false);
  const [directUrl, setDirectUrl] = useState("");
  const [directToken, setDirectToken] = useState("");
  const [showDirectToken, setShowDirectToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"bind" | "direct-bind" | "sync" | "space" | "create-space" | "unbind" | "refresh" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const updateSyncConfig = useCallback((config: SyncConfig | null) => {
    setSyncConfig(config);
    onSyncConfigChange?.(config);
  }, [onSyncConfigChange]);

  const load = useCallback(async () => {
    try {
      const [config, credentialStatus, spaceIds, remoteEntries] = await Promise.all([
        invoke<SyncConfig | null>("sync_get_config"),
        invoke<DataCenterCredentialStatus>("get_data_center_config_credential_status"),
        invoke<string[]>("sync_list_environments"),
        invoke<RemoteRepository[]>("get_remote_configs"),
      ]);
      const reusableRemotes = remoteEntries
        .filter((remote) => remote.source === "local_git_config")
        .filter((remote) => remote.repo_path && remote.url.startsWith("https://"))
        .filter((remote) => ["repo_token", "app_global_token"].includes(remote.credential_mode))
        .sort((left, right) => remoteLabel(left).localeCompare(remoteLabel(right)));
      const space = config?.active_environment_id || "default";
      const boundRemote = reusableRemotes.find((remote) => remote.url === config?.url);
      updateSyncConfig(config);
      setCredential(credentialStatus);
      setRemotes(reusableRemotes);
      setSelectedRemoteKey((current) => {
        if (boundRemote) return remoteKey(boundRemote);
        if (reusableRemotes.some((remote) => remoteKey(remote) === current)) return current;
        return reusableRemotes[0] ? remoteKey(reusableRemotes[0]) : "";
      });
      setActiveSpace(space);
      setSpaces(Array.from(new Set(["default", ...spaceIds, space])).sort());
      setNotice(null);
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setLoading(false);
    }
  }, [updateSyncConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (externalSyncConfig !== undefined) setSyncConfig(externalSyncConfig);
  }, [externalSyncConfig]);

  const hasCredential = Boolean(credential?.has_token);
  const canSync = Boolean(syncConfig && hasCredential);
  const selectedRemote = remotes.find((remote) => remoteKey(remote) === selectedRemoteKey) ?? null;
  const repositoryLabel = useMemo(() => {
    if (!syncConfig?.url) return "未配置";
    const normalized = syncConfig.url.replace(/[/?#]+$/, "").replace(/\.git$/, "");
    return normalized.split("/").filter(Boolean).pop() || "已配置";
  }, [syncConfig]);

  const handleBind = async () => {
    if (!selectedRemote?.repo_path) return;
    setBusyAction("bind");
    setNotice({ tone: "progress", message: "正在连接软件数据远程仓库..." });
    try {
      await invoke("bind_data_center_config_remote", {
        repoPath: selectedRemote.repo_path,
        remoteName: selectedRemote.name,
      });
      await load();
      setNotice({ tone: "success", message: "软件数据远程仓库已绑定" });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefreshRemotes = async () => {
    setBusyAction("refresh");
    await load();
    setBusyAction(null);
  };

  const handleDirectBind = async () => {
    const url = directUrl.trim();
    const token = directToken.trim();
    if (!url || !token) return;
    setBusyAction("direct-bind");
    setNotice({ tone: "progress", message: "正在连接软件数据远程仓库..." });
    try {
      const report = await invoke<ConfigRepoCheckReport>("check_data_center_config_repo", {
        url,
        token,
      });
      if (!report.ok) throw new Error(report.message);
      const sameRemote = syncConfig?.url === url;
      await invoke("update_data_center_config_remote", {
        config: {
          url,
          branch: report.default_branch || "main",
          active_environment_id: sameRemote
            ? syncConfig.active_environment_id || "default"
            : "default",
          local_database_path: sameRemote ? syncConfig.local_database_path ?? null : null,
          auto_sync: syncConfig?.auto_sync ?? true,
          interval_seconds: syncConfig?.interval_seconds ?? 300,
        },
        token,
        clearToken: false,
      });
      setDirectToken("");
      setShowDirectToken(false);
      setShowDirectBind(false);
      await load();
      setNotice({ tone: "success", message: "软件数据远程仓库已绑定" });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSync = async () => {
    if (!canSync) return;
    setBusyAction("sync");
    setNotice({ tone: "progress", message: "正在同步..." });
    try {
      const message = await invoke<string>("sync_now");
      setNotice({ tone: "success", message: message || "同步完成" });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSpaceChange = async (space: string) => {
    if (!space || space === activeSpace || !syncConfig) return;
    const previous = activeSpace;
    setActiveSpace(space);
    setBusyAction("space");
    try {
      await invoke("sync_switch_environment", { environmentId: space });
      updateSyncConfig({ ...syncConfig, active_environment_id: space });
      setNotice({ tone: "success", message: `已切换到环境 ${space}` });
    } catch (error) {
      setActiveSpace(previous);
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateSpace = async (space: string): Promise<boolean> => {
    setBusyAction("create-space");
    try {
      await invoke("sync_create_space", { spaceId: space });
      setSpaces((current) => Array.from(new Set([...current, space])).sort());
      setActiveSpace(space);
      if (syncConfig) updateSyncConfig({ ...syncConfig, active_environment_id: space });
      setNotice({ tone: "success", message: `环境 ${space} 已创建` });
      return true;
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnbind = async () => {
    if (!syncConfig || !window.confirm("解绑远程数据仓库?")) return;
    setBusyAction("unbind");
    try {
      await invoke("unbind_data_center_config_remote", { clearToken: true });
      updateSyncConfig(null);
      setCredential(null);
      setActiveSpace("default");
      setSpaces(["default"]);
      setNotice({ tone: "success", message: "软件数据远程仓库已解绑" });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className={cn(
      "flex w-full flex-col gap-6",
      !embedded && "mx-auto max-w-3xl px-4 py-4 sm:px-6",
    )}>
      <section aria-labelledby="software-data-remote-heading">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
            <Cloud className="size-3.5" />
          </div>
          <h2 id="software-data-remote-heading" className="min-w-0 flex-1 na-title-section">远程仓库</h2>
          <Badge variant={syncConfig ? "secondary" : "outline"} className="h-5 max-w-44 truncate px-1.5 text-[10px]">
            {syncConfig && <CheckCircle2 className="size-3" />}
            {loading ? "读取中" : repositoryLabel}
          </Badge>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => void handleRefreshRemotes()}
              disabled={busyAction !== null}
              aria-label="刷新远程仓库"
              title="刷新远程仓库"
            >
              <RefreshCw className={cn("size-3.5", busyAction === "refresh" && "animate-spin")} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => setShowDirectBind((visible) => !visible)}
              disabled={busyAction !== null}
              aria-label="直接绑定"
              aria-expanded={showDirectBind}
              title="直接输入仓库地址"
            >
              <Link2 className="size-3.5" />
            </Button>
            {syncConfig && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => void handleUnbind()}
                disabled={busyAction !== null}
                aria-label="解绑远程仓库"
                title="解绑远程仓库"
              >
                <Unplug className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
          <label htmlFor="data-sync-remote" className="na-label text-muted-foreground">远程仓库</label>
          <div className="flex min-w-0 items-center gap-2">
            <select
              id="data-sync-remote"
              value={selectedRemoteKey}
              onChange={(event) => setSelectedRemoteKey(event.target.value)}
              disabled={loading || busyAction !== null || remotes.length === 0}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {remotes.length === 0 ? (
                <option value="">暂无可绑定仓库</option>
              ) : remotes.map((remote) => (
                <option key={remoteKey(remote)} value={remoteKey(remote)}>
                  {remoteLabel(remote)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              className={compactButtonClass}
              onClick={() => void handleBind()}
              disabled={!selectedRemote || busyAction !== null}
            >
              <GitBranch />
              {busyAction === "bind" ? "绑定中" : "绑定"}
            </Button>
          </div>
        </div>

        {showDirectBind && (
          <form
            className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              void handleDirectBind();
            }}
          >
            <label htmlFor="data-sync-direct-url" className="na-label text-muted-foreground">仓库地址</label>
            <Input
              id="data-sync-direct-url"
              type="url"
              value={directUrl}
              onChange={(event) => setDirectUrl(event.target.value)}
              placeholder="https://github.com/org/data.git"
              className="h-8 text-xs"
              disabled={busyAction !== null}
              autoFocus
            />
            <label htmlFor="data-sync-direct-token" className="na-label text-muted-foreground">Access Token</label>
            <div className="relative">
              <Input
                id="data-sync-direct-token"
                type={showDirectToken ? "text" : "password"}
                value={directToken}
                onChange={(event) => setDirectToken(event.target.value)}
                className="h-8 pr-8 text-xs"
                disabled={busyAction !== null}
              />
              <button
                type="button"
                onClick={() => setShowDirectToken((visible) => !visible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showDirectToken ? "隐藏 Token" : "显示 Token"}
                title={showDirectToken ? "隐藏 Token" : "显示 Token"}
              >
                {showDirectToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </button>
            </div>
            <div className="sm:col-start-2 flex justify-end gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={compactButtonClass}
                onClick={() => setShowDirectBind(false)}
                disabled={busyAction !== null}
              >
                取消
              </Button>
              <Button
                type="submit"
                size="sm"
                className={compactButtonClass}
                disabled={!directUrl.trim() || !directToken.trim() || busyAction !== null}
              >
                {busyAction === "direct-bind" ? <RefreshCw className="animate-spin" /> : <Link2 />}
                {busyAction === "direct-bind" ? "绑定中" : "确认绑定"}
              </Button>
            </div>
          </form>
        )}
      </section>

      {syncConfig && (
        <DataSpaceSection
          spaces={spaces}
          activeSpace={activeSpace}
          bound
          canSync={canSync}
          busyAction={busyAction}
          onSpaceChange={(space) => void handleSpaceChange(space)}
          onCreateSpace={handleCreateSpace}
          onSync={() => void handleSync()}
        />
      )}

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-center gap-2 border-t px-1 pt-3 na-caption",
            notice.tone === "error" && "text-destructive",
            notice.tone === "success" && "text-emerald-700 dark:text-emerald-300",
            notice.tone === "progress" && "text-muted-foreground",
          )}
        >
          {notice.tone === "progress"
            ? <RefreshCw className="size-3.5 animate-spin" />
            : <CheckCircle2 className="size-3.5" />}
          <span>{notice.message}</span>
        </div>
      )}
    </div>
  );
}
