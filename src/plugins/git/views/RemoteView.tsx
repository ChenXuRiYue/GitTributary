import { useCallback, useEffect, useState } from "react";
import {
  Upload,
  Download,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  Key,
  Eye,
  EyeOff,
  Globe,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RemoteInfo {
  name: string;
  url: string;
  push_url: string | null;
}

export function RemoteView() {
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [projectToken, setProjectToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null); // which action is loading

  const refresh = useCallback(async () => {
    try {
      const r = await invoke<RemoteInfo[]>("get_remotes");
      setRemotes(r);
      setError(null);
    } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  };

  const handleAddRemote = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    try {
      await invoke("add_remote", { name: newName.trim(), url: newUrl.trim() });
      setNewName(""); setNewUrl("");
      flash("远程已添加");
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const handleRemoveRemote = async (name: string) => {
    try {
      await invoke("remove_remote", { name });
      flash("远程已删除");
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const handleFetch = async (remote: string) => {
    setLoading("fetch"); setError(null);
    try {
      await invoke("git_fetch", { remote });
      flash("Fetch 完成");
    } catch (e) { setError(String(e)); }
    finally { setLoading(null); }
  };

  const handlePush = async (remote: string) => {
    setLoading("push"); setError(null);
    try {
      // 获取当前分支
      const overview = await invoke<{ current_branch: string }>("get_overview");
      await invoke("git_push", { remote, branch: overview.current_branch });
      flash("Push 完成");
    } catch (e) { setError(String(e)); }
    finally { setLoading(null); }
  };

  const handlePull = async (remote: string) => {
    setLoading("pull"); setError(null);
    try {
      const overview = await invoke<{ current_branch: string }>("get_overview");
      await invoke("git_pull", { remote, branch: overview.current_branch });
      flash("Pull 完成");
    } catch (e) { setError(String(e)); }
    finally { setLoading(null); }
  };

  const handleSetProjectToken = async () => {
    if (!projectToken.trim()) return;
    try {
      await invoke("set_project_token", { token: projectToken.trim() });
      setProjectToken("");
      flash("项目 Token 已保存(仅本地)");
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {status && <div className="rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary">{status}</div>}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</div>}

      {/* 远程仓库列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Globe className="size-4" /> 远程仓库
            <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5" onClick={refresh}>
              <RefreshCw className="size-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {remotes.length === 0 ? (
            <p className="text-xs text-muted-foreground">无远程仓库配置</p>
          ) : (
            remotes.map((r) => (
              <div key={r.name} className="flex items-center gap-2 rounded-md border p-2">
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-xs font-medium">{r.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{r.url}</span>
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleFetch(r.name)}
                  disabled={!!loading} title="Fetch">
                  <Download className={cn("size-3.5", loading === "fetch" && "animate-spin")} />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handlePull(r.name)}
                  disabled={!!loading} title="Pull">
                  <Download className="size-3.5 text-primary" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handlePush(r.name)}
                  disabled={!!loading} title="Push">
                  <Upload className="size-3.5 text-green-600" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => handleRemoveRemote(r.name)}
                  title="删除">
                  <Trash2 className="size-3 text-destructive" />
                </Button>
              </div>
            ))
          )}

          {/* 添加远程 */}
          <div className="flex items-center gap-2 border-t pt-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="名称 (如 origin)" className="h-7 w-24 text-xs" />
            <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
              placeholder="URL (git@github.com:...)" className="h-7 flex-1 text-xs" />
            <Button size="sm" className="h-7" onClick={handleAddRemote}
              disabled={!newName.trim() || !newUrl.trim()}>
              <Plus className="size-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 项目级 Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="size-4" /> 项目级 Token
            <Badge variant="outline" className="text-[9px] text-destructive/70">仅本地 · L0</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-[10px] text-muted-foreground">
            优先级:项目级 Token → 公共级 Token → SSH Key → Agent
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showToken ? "text" : "password"}
                value={projectToken}
                onChange={(e) => setProjectToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                className="h-7 pr-8 text-xs"
              />
              <button type="button" onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            <Button size="sm" className="h-7" onClick={handleSetProjectToken}
              disabled={!projectToken.trim()}>
              <Save className="size-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
