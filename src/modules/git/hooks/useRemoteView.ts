import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { GitViewProps, RepoOverview } from "../types";

export interface RemoteInfo {
  name: string;
  url: string;
  push_url: string | null;
  repo_path: string | null;
  source: string;
  purpose: string[];
  credential_mode: string;
  credential_ref: string | null;
  commit_name: string | null;
  commit_email: string | null;
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

export interface RemoteDraft {
  url: string;
  token: string;
  commitName: string;
  commitEmail: string;
  showToken: boolean;
}

interface AddRemoteDraft extends RemoteDraft {
  name: string;
}

export function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}

export function remoteKey(remote: Pick<RemoteInfo, "name" | "repo_path">): string {
  return `${remote.repo_path ?? "app"}:${remote.name}`;
}

function repositoryNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/?#]+$/, "");
  const lastSegment = trimmed.split(/[/:]/).filter(Boolean).pop() ?? "";
  return lastSegment.replace(/\.git$/, "") || "remote";
}

export function repositoryName(remote: Pick<RemoteInfo, "name" | "repo_path" | "url">): string {
  const pathName = remote.repo_path?.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return pathName || repositoryNameFromUrl(remote.url) || remote.name;
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "local_git_config": return "当前仓库 .git/config";
    case "gittributary_config": return "GitTributary 配置";
    case "system_discovered": return "系统发现";
    case "imported": return "导入";
    default: return source;
  }
}

export function purposeLabel(purpose: string): string {
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

export function credentialLabel(mode: string): string {
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

export function verifyLabel(status: string): string {
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

export function useRemoteView({
  overview,
  sessionGeneration,
  openRepository,
  refreshRepository,
}: Pick<GitViewProps, "overview" | "sessionGeneration" | "openRepository" | "refreshRepository">) {
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [syncConfig, setSyncConfig] = useState<SyncConfigPayload | null>(null);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneParentPath, setCloneParentPath] = useState("");
  const [cloneToken, setCloneToken] = useState("");
  const [cloneCommitName, setCloneCommitName] = useState("");
  const [cloneCommitEmail, setCloneCommitEmail] = useState("");
  const [showCloneToken, setShowCloneToken] = useState(false);
  const [configUrl, setConfigUrl] = useState("");
  const [configBranch, setConfigBranch] = useState("main");
  const [configToken, setConfigToken] = useState("");
  const [showConfigToken, setShowConfigToken] = useState(false);
  const [checkingConfig, setCheckingConfig] = useState(false);
  const [addingRemote, setAddingRemote] = useState(false);
  const [addRemoteDraft, setAddRemoteDraft] = useState<AddRemoteDraft>({
    name: "origin",
    url: "",
    token: "",
    commitName: "",
    commitEmail: "",
    showToken: false,
  });
  const [savingNewRemote, setSavingNewRemote] = useState(false);
  const [remoteDrafts, setRemoteDrafts] = useState<Record<string, RemoteDraft>>({});
  const [remoteBusyKey, setRemoteBusyKey] = useState<string | null>(null);
  const [expandedRemoteKeys, setExpandedRemoteKeys] = useState<Record<string, boolean>>({});
  const [configCheck, setConfigCheck] = useState<ConfigRepoCheckReport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    setRemoteDrafts((current) => {
      const next = { ...current };
      const activeKeys = new Set<string>();
      remotes.forEach((remote) => {
        if (remote.source !== "local_git_config") return;
        const key = remoteKey(remote);
        activeKeys.add(key);
        next[key] ??= {
          url: remote.url,
          token: "",
          commitName: remote.commit_name ?? "",
          commitEmail: remote.commit_email ?? "",
          showToken: false,
        };
      });
      Object.keys(next).forEach((key) => {
        if (!activeKeys.has(key)) delete next[key];
      });
      return next;
    });
  }, [remotes]);

  const loadRemoteConfigs = useCallback(async () => {
    setRemotes(await invoke<RemoteInfo[]>("get_remote_configs"));
  }, []);

  const refresh = useCallback(async () => {
    const requestedGeneration = sessionGeneration;
    let nextError: string | null = null;
    let nextRemotes: RemoteInfo[] | null = null;
    let nextSyncConfig: SyncConfigPayload | null | undefined;
    try {
      nextRemotes = await invoke<RemoteInfo[]>("get_remote_configs");
    } catch (cause) {
      nextError = `远程配置读取失败: ${String(cause)}`;
    }
    try {
      nextSyncConfig = await invoke<SyncConfigPayload | null>("sync_get_config");
    } catch (cause) {
      const message = `配置中心读取失败: ${String(cause)}`;
      nextError = nextError ? `${nextError}; ${message}` : message;
    }
    if (loadedGenerationRef.current !== requestedGeneration) return;
    if (nextRemotes) setRemotes(nextRemotes);
    if (nextSyncConfig !== undefined) {
      setSyncConfig(nextSyncConfig);
      if (nextSyncConfig) {
        setConfigUrl(nextSyncConfig.url);
        setConfigBranch(nextSyncConfig.branch || "main");
      }
    }
    setError(nextError);
  }, [sessionGeneration]);

  const openRepo = useCallback(async (path: string) => {
    try {
      await openRepository(path);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, [openRepository]);

  useEffect(() => {
    if (loadedGenerationRef.current === sessionGeneration) return;
    loadedGenerationRef.current = sessionGeneration;
    void refresh();
  }, [refresh, sessionGeneration]);

  const flash = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 3000);
  };
  const openFromDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) await openRepo(selected as string);
  };
  const selectClonePathFromDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) setCloneParentPath(selected as string);
  };

  const handleCloneRemote = async () => {
    if (!cloneParentPath.trim() || !cloneUrl.trim() || !cloneToken.trim()) return;
    setAddingRemote(true);
    try {
      setError(null);
      const cloned = await invoke<RepoOverview>("clone_remote_repo", {
        url: cloneUrl.trim(),
        parentPath: cloneParentPath.trim(),
        token: cloneToken.trim(),
        commitName: cloneCommitName.trim() || null,
        commitEmail: cloneCommitEmail.trim() || null,
      });
      await refreshRepository();
      setCloneUrl("");
      setCloneParentPath("");
      setCloneToken("");
      setCloneCommitName("");
      setCloneCommitEmail("");
      flash(`远程访问校验通过,仓库已 Clone 到 ${shortPath(cloned.path)}`);
      await loadRemoteConfigs();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setAddingRemote(false);
    }
  };

  const handleAddRemote = async () => {
    if (!overview || !addRemoteDraft.name.trim() || !addRemoteDraft.url.trim() || !addRemoteDraft.token.trim()) return;
    setSavingNewRemote(true);
    try {
      setError(null);
      await invoke("add_remote", {
        name: addRemoteDraft.name.trim(),
        url: addRemoteDraft.url.trim(),
        token: addRemoteDraft.token.trim(),
        commitName: addRemoteDraft.commitName.trim() || null,
        commitEmail: addRemoteDraft.commitEmail.trim() || null,
      });
      setAddRemoteDraft({ name: "origin", url: "", token: "", commitName: "", commitEmail: "", showToken: false });
      flash("远程访问校验通过,远程仓库已新增");
      await loadRemoteConfigs();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSavingNewRemote(false);
    }
  };

  const updateRemoteDraft = (key: string, patch: Partial<RemoteDraft>) => {
    setRemoteDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? { url: "", token: "", commitName: "", commitEmail: "", showToken: false }),
        ...patch,
      },
    }));
  };

  const handleUpdateRemote = async (remote: RemoteInfo) => {
    const key = remoteKey(remote);
    const draft = remoteDrafts[key] ?? {
      url: remote.url,
      token: "",
      commitName: remote.commit_name ?? "",
      commitEmail: remote.commit_email ?? "",
      showToken: false,
    };
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
        commitName: draft.commitName.trim() || null,
        commitEmail: draft.commitEmail.trim() || null,
      });
      updateRemoteDraft(key, { token: "" });
      flash("远程访问校验通过,配置已更新");
      await loadRemoteConfigs();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRemoteBusyKey(null);
    }
  };

  const handleRemoveRemote = async (remote: RemoteInfo) => {
    const key = remoteKey(remote);
    const repoPath = remote.repo_path ?? overview?.path ?? "";
    if (!repoPath || !window.confirm(`删除远程 ${remote.name}?`)) return;
    setRemoteBusyKey(key);
    try {
      setError(null);
      await invoke("remove_remote", { name: remote.name, repoPath });
      flash("远程已删除");
      await loadRemoteConfigs();
    } catch (cause) {
      setError(String(cause));
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
      if (report.ok && report.default_branch && !configBranch.trim()) setConfigBranch(report.default_branch);
    } catch (cause) {
      setConfigCheck({ ok: false, status: "error", message: String(cause), default_branch: null, refs_count: 0 });
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
    } catch (cause) {
      setError(String(cause));
    }
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
    } catch (cause) {
      setError(String(cause));
    }
  };

  return {
    remotes, syncConfig, cloneUrl, setCloneUrl, cloneParentPath, setCloneParentPath,
    cloneToken, setCloneToken, cloneCommitName, setCloneCommitName, cloneCommitEmail,
    setCloneCommitEmail, showCloneToken, setShowCloneToken, configUrl, setConfigUrl,
    configBranch, setConfigBranch, configToken, setConfigToken, showConfigToken,
    setShowConfigToken, checkingConfig, addingRemote, addRemoteDraft, setAddRemoteDraft,
    savingNewRemote, remoteDrafts, remoteBusyKey, expandedRemoteKeys, setExpandedRemoteKeys,
    configCheck, status, error, refresh, openRepo, openFromDialog, selectClonePathFromDialog,
    handleCloneRemote, handleAddRemote, updateRemoteDraft, handleUpdateRemote,
    handleRemoveRemote, handleCheckConfigRepo, handleSaveConfigRemote,
    handleUnbindConfigRemote,
    hasConfigRemote: remotes.some((remote) => remote.source === "gittributary_config"),
  };
}
