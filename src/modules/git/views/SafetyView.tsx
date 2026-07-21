import { useCallback, useEffect, useState } from "react";
import { Shield, Eye, EyeOff, Save, Trash2, Key } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface GitCredentials {
  username: string | null;
  email: string | null;
  remote_url: string | null;
  token_masked: string | null;
  has_token: boolean;
  ssh_key_path: string | null;
  has_ssh_passphrase: boolean;
}

export function SafetyView() {
  const [creds, setCreds] = useState<GitCredentials | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [sshPath, setSshPath] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const c = await invoke<GitCredentials>("get_git_credentials");
      setCreds(c);
      setUsername(c.username ?? "");
      setEmail(c.email ?? "");
      setRemoteUrl(c.remote_url ?? "");
      setSshPath(c.ssh_key_path ?? "");
    } catch { /* initial load */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const savePublic = async () => {
    try {
      if (username) await invoke("set_git_username", { username });
      if (email) await invoke("set_git_email", { email });
      if (remoteUrl) await invoke("set_git_remote_url", { url: remoteUrl });
      setStatus("已保存");
      setTimeout(() => setStatus(null), 2000);
      await refresh();
    } catch (e) { setStatus(String(e)); }
  };

  const saveToken = async () => {
    if (!token.trim()) return;
    try {
      await invoke("set_git_token", { token: token.trim() });
      setToken("");
      setStatus("Token 已保存(仅本地)");
      setTimeout(() => setStatus(null), 2000);
      await refresh();
    } catch (e) { setStatus(String(e)); }
  };

  const clearToken = async () => {
    try {
      await invoke("clear_git_token");
      setStatus("Token 已清除");
      setTimeout(() => setStatus(null), 2000);
      await refresh();
    } catch (e) { setStatus(String(e)); }
  };

  const saveSshKey = async () => {
    if (!sshPath.trim()) return;
    try {
      await invoke("set_git_ssh_key", { path: sshPath.trim(), passphrase: null });
      setStatus("SSH 密钥路径已保存(仅本地)");
      setTimeout(() => setStatus(null), 2000);
      await refresh();
    } catch (e) { setStatus(String(e)); }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {status && (
        <div className="rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary">{status}</div>
      )}

      {/* 基本信息(Public,可同步) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Shield className="size-4" />
            Git 账户
            <Badge variant="secondary" className="text-[9px]">可同步</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">用户名</span>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="GitHub 用户名" className="h-8 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">邮箱</span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="git commit 邮箱" className="h-8 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">仓库 URL</span>
            <Input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="git@github.com:user/repo.git" className="h-8 text-xs" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={savePublic}><Save className="size-3.5" /> 保存</Button>
          </div>
        </CardContent>
      </Card>

      {/* Access Token(Private,仅本地) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="size-4" />
            Access Token
            <Badge variant="outline" className="text-[9px] text-destructive/70">仅本地</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {creds?.has_token && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">当前:</span>
              <code className="rounded bg-muted px-2 py-0.5">••••••••</code>
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={clearToken}>
                <Trash2 className="size-3 text-destructive" />
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                className="h-8 pr-8 text-xs"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <Button size="sm" onClick={saveToken} disabled={!token.trim()}>
              <Save className="size-3.5" /> 保存
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Token 仅存储在本地设备,永不同步到远程。用于 HTTPS 方式推送。
          </p>
        </CardContent>
      </Card>

      {/* SSH 密钥(Private,仅本地) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="size-4" />
            SSH 密钥
            <Badge variant="outline" className="text-[9px] text-destructive/70">仅本地</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">密钥路径</span>
            <Input value={sshPath} onChange={(e) => setSshPath(e.target.value)} placeholder="~/.ssh/id_ed25519" className="h-8 text-xs" />
            <Button size="sm" onClick={saveSshKey} disabled={!sshPath.trim()}>
              <Save className="size-3.5" />
            </Button>
          </div>
          {creds?.ssh_key_path && (
            <p className="text-[10px] text-muted-foreground">
              当前: <code className="rounded bg-muted px-1">{creds.ssh_key_path}</code>
              {creds.has_ssh_passphrase && <span className="ml-1">(有 passphrase)</span>}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
