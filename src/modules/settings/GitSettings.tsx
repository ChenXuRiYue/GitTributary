import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";

import { createJsonStore } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";

interface GitCredentials {
  username: string | null;
  email: string | null;
  remote_url: string | null;
  token_masked: string | null;
  has_token: boolean;
  ssh_key_path: string | null;
  has_ssh_passphrase: boolean;
}

export interface GitSettingsUiState {
  version: 1;
  username: string;
  email: string;
  remoteUrl: string;
  sshPath: string;
  updatedAt: number;
}

interface Notice {
  tone: "success" | "error";
  message: string;
}

const gitSettingsUiStore = createJsonStore("ui-state");
// Keep the historical key so drafts survive the move from Git > Credentials.
const GIT_SETTINGS_UI_STATE_KEY = "git.safety.draft.v1";
const compactButtonClass = "h-8 px-2.5 text-xs";

export function parseGitSettingsUiState(value: unknown): GitSettingsUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<GitSettingsUiState>;
  if (state.version !== 1) return null;
  if (typeof state.username !== "string" || typeof state.email !== "string") return null;
  if (typeof state.remoteUrl !== "string" || typeof state.sshPath !== "string") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    version: 1,
    username: state.username,
    email: state.email,
    remoteUrl: state.remoteUrl,
    sshPath: state.sshPath,
    updatedAt: state.updatedAt,
  };
}

function SettingSection({
  id,
  icon: Icon,
  title,
  badge,
  children,
}: {
  id: string;
  icon: typeof UserRound;
  title: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
          <Icon className="size-3.5" />
        </div>
        <h2 id={id} className="min-w-0 flex-1 na-title-section">{title}</h2>
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{badge}</Badge>
      </div>
      {children}
    </section>
  );
}

function SettingsNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2 border-t px-1 pt-3 na-caption",
        notice.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300",
      )}
    >
      {notice.tone === "success" && <CheckCircle2 className="size-3.5" />}
      <span>{notice.message}</span>
    </div>
  );
}

export function GitSettings() {
  const [credentials, setCredentials] = useState<GitCredentials | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [sshPath, setSshPath] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);

  const refreshCredentials = useCallback(async () => {
    const nextCredentials = await invoke<GitCredentials>("get_git_credentials");
    setCredentials(nextCredentials);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      invoke<GitCredentials>("get_git_credentials").catch(() => null),
      gitSettingsUiStore.get<unknown>(GIT_SETTINGS_UI_STATE_KEY).catch(() => null),
    ]).then(([nextCredentials, raw]) => {
      if (cancelled) return;
      if (nextCredentials) setCredentials(nextCredentials);
      const cached = parseGitSettingsUiState(raw);
      setUsername(cached?.username ?? nextCredentials?.username ?? "");
      setEmail(cached?.email ?? nextCredentials?.email ?? "");
      setRemoteUrl(cached?.remoteUrl ?? nextCredentials?.remote_url ?? "");
      setSshPath(cached?.sshPath ?? nextCredentials?.ssh_key_path ?? "");
    }).finally(() => {
      if (!cancelled) setUiStateHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;
    const timeout = window.setTimeout(() => {
      void gitSettingsUiStore.set(GIT_SETTINGS_UI_STATE_KEY, {
        version: 1,
        username,
        email,
        remoteUrl,
        sshPath,
        updatedAt: Date.now(),
      } satisfies GitSettingsUiState).catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [email, remoteUrl, sshPath, uiStateHydrated, username]);

  const runAction = async (action: string, message: string, task: () => Promise<void>) => {
    setBusyAction(action);
    setNotice(null);
    try {
      await task();
      setNotice({ tone: "success", message });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const saveIdentity = () => runAction("identity", "提交身份已保存", async () => {
    if (username.trim()) await invoke("set_git_username", { username: username.trim() });
    if (email.trim()) await invoke("set_git_email", { email: email.trim() });
    await refreshCredentials();
  });

  const saveRemote = () => runAction("remote", "默认远端地址已保存", async () => {
    await invoke("set_git_remote_url", { url: remoteUrl.trim() });
    await refreshCredentials();
  });

  const saveToken = () => runAction("token", "Access Token 已保存", async () => {
    await invoke("set_git_token", { token: token.trim() });
    setToken("");
    await refreshCredentials();
  });

  const clearToken = () => runAction("clear-token", "Access Token 已清除", async () => {
    await invoke("clear_git_token");
    await refreshCredentials();
  });

  const saveSshKey = () => runAction("ssh", "SSH 密钥路径已保存", async () => {
    await invoke("set_git_ssh_key", { path: sshPath.trim(), passphrase: null });
    await refreshCredentials();
  });

  const busy = busyAction !== null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
          <SettingSection id="git-identity-heading" icon={UserRound} title="全局提交身份" badge="所有仓库">
            <form
              className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center"
              onSubmit={(event) => {
                event.preventDefault();
                void saveIdentity();
              }}
            >
              <label htmlFor="git-username" className="na-label text-muted-foreground">用户名</label>
              <Input id="git-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="张三" className="h-8 text-xs" disabled={busy} />
              <label htmlFor="git-email" className="na-label text-muted-foreground">邮箱</label>
              <Input id="git-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" className="h-8 text-xs" disabled={busy} />
              <p className="sm:col-start-2 na-caption text-muted-foreground">未设置仓库提交身份时使用</p>
              <div className="flex justify-end sm:col-start-2">
                <Button type="submit" size="sm" className={compactButtonClass} disabled={busy || (!username.trim() && !email.trim())}>
                  <Save />
                  {busyAction === "identity" ? "保存中" : "保存身份"}
                </Button>
              </div>
            </form>
          </SettingSection>

          <details className="group rounded-md bg-muted/20">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                <KeyRound className="size-3.5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="na-body-strong">默认访问与凭据</p>
                <p className="mt-0.5 na-caption text-muted-foreground">远端地址 · HTTPS · SSH</p>
              </div>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">仅本机</Badge>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="flex flex-col gap-6 border-t border-border/50 px-3 py-3">
              <SettingSection id="git-remote-heading" icon={GitBranch} title="默认远端" badge="本机偏好">
                <form
                  className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRemote();
                  }}
                >
                  <label htmlFor="git-remote-url" className="na-label text-muted-foreground">仓库 URL</label>
                  <Input id="git-remote-url" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="git@github.com:user/repo.git" className="h-8 text-xs" disabled={busy} />
                  <div className="flex justify-end sm:col-start-2">
                    <Button type="submit" size="sm" className={compactButtonClass} disabled={busy || !remoteUrl.trim()}>
                      <Save />
                      {busyAction === "remote" ? "保存中" : "保存地址"}
                    </Button>
                  </div>
                </form>
              </SettingSection>

              <SettingSection id="git-token-heading" icon={KeyRound} title="默认 HTTPS 凭据" badge="仅本机">
                <form
                  className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveToken();
                  }}
                >
                  <span className="na-label text-muted-foreground">当前状态</span>
                  <div className="flex min-h-8 items-center gap-2">
                    <Badge variant={credentials?.has_token ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                      {credentials?.has_token && <CheckCircle2 className="size-3" />}
                      {credentials?.has_token ? "已配置" : "未配置"}
                    </Badge>
                    {credentials?.has_token && (
                      <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => void clearToken()} disabled={busy} aria-label="清除 Access Token" title="清除 Access Token">
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                  <label htmlFor="git-access-token" className="na-label text-muted-foreground">Access Token</label>
                  <div className="flex min-w-0 gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <Input id="git-access-token" type={showToken ? "text" : "password"} value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_xxxxxxxxxxxx" className="h-8 pr-8 text-xs" disabled={busy} />
                      <button type="button" onClick={() => setShowToken((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showToken ? "隐藏 Token" : "显示 Token"} title={showToken ? "隐藏 Token" : "显示 Token"}>
                        {showToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                      </button>
                    </div>
                    <Button type="submit" size="sm" className={compactButtonClass} disabled={busy || !token.trim()}>
                      <Save />
                      {busyAction === "token" ? "保存中" : "保存"}
                    </Button>
                  </div>
                </form>
              </SettingSection>

              <SettingSection id="git-ssh-heading" icon={KeyRound} title="默认 SSH 凭据" badge="仅本机">
                <form
                  className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSshKey();
                  }}
                >
                  <label htmlFor="git-ssh-key-path" className="na-label text-muted-foreground">密钥路径</label>
                  <div className="flex min-w-0 gap-1.5">
                    <Input id="git-ssh-key-path" value={sshPath} onChange={(event) => setSshPath(event.target.value)} placeholder="~/.ssh/id_ed25519" className="h-8 min-w-0 text-xs" disabled={busy} />
                    <Button type="submit" size="sm" className={compactButtonClass} disabled={busy || !sshPath.trim()}>
                      <Save />
                      {busyAction === "ssh" ? "保存中" : "保存"}
                    </Button>
                  </div>
                  {credentials?.has_ssh_passphrase && <span className="sm:col-start-2 na-caption text-muted-foreground">已配置 Passphrase</span>}
                </form>
              </SettingSection>
            </div>
          </details>

          <SettingsNotice notice={notice} />
        </div>
      </ScrollArea>
    </div>
  );
}
