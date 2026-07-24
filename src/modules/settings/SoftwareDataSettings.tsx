import { useCallback, useEffect, useState } from "react";
import { Database, FolderTree, RefreshCw, Save } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Switch } from "@/shared/ui/switch";
import { APP_DISPLAY_NAME } from "@/shared/brand";
import { cn } from "@/shared/lib/utils";
import { DataSyncSettings, type SyncConfig } from "./DataSyncSettings";

interface Notice {
  tone: "success" | "error";
  message: string;
}

const compactButtonClass = "h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5";

export function SoftwareDataSettings() {
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState("300");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      const config = await invoke<SyncConfig | null>("sync_get_config");
      setSyncConfig(config);
      setAutoSync(config?.auto_sync ?? true);
      setIntervalSeconds(String(config?.interval_seconds ?? 300));
      setNotice(null);
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSyncConfigChange = useCallback((config: SyncConfig | null) => {
    setSyncConfig(config);
    setAutoSync(config?.auto_sync ?? true);
    setIntervalSeconds(String(config?.interval_seconds ?? 300));
    setLoading(false);
  }, []);

  const save = async () => {
    if (!syncConfig) return;
    const seconds = Math.max(30, Number.parseInt(intervalSeconds, 10) || 300);
    setSaving(true);
    setNotice(null);
    try {
      const nextConfig = { ...syncConfig, auto_sync: autoSync, interval_seconds: seconds };
      await invoke("sync_set_config", { config: nextConfig });
      setSyncConfig(nextConfig);
      setIntervalSeconds(String(seconds));
      setNotice({ tone: "success", message: "软件数据同步策略已保存" });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6">
          <section aria-labelledby="software-data-location-heading">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                <Database className="size-3.5" />
              </div>
              <h2 id="software-data-location-heading" className="min-w-0 flex-1 na-title-section">软件数据位置</h2>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">本机数据</Badge>
            </div>
            <p className="mb-3 na-caption text-muted-foreground">
              {APP_DISPLAY_NAME} 产生的设置、环境、插件状态和运行记录统一存放在这里，并可独立同步。
            </p>
            <div className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-center">
              <span className="na-label text-muted-foreground">数据目录</span>
              <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted/30 px-2.5 py-2">
                <FolderTree className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {loading ? "读取中" : syncConfig?.local_database_path ?? "绑定远程仓库后自动生成"}
                </span>
              </div>
            </div>
          </section>

          <DataSyncSettings
            embedded
            syncConfig={syncConfig}
            onSyncConfigChange={handleSyncConfigChange}
          />

          {syncConfig && (
            <section aria-labelledby="software-data-sync-heading">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                  <RefreshCw className="size-3.5" />
                </div>
                <h2 id="software-data-sync-heading" className="min-w-0 flex-1 na-title-section">同步策略</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  已连接
                </Badge>
              </div>
              <div className="grid gap-3 rounded-md bg-muted/25 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="na-body-strong">自动同步软件数据</p>
                    <p className="mt-0.5 na-caption text-muted-foreground">通过软件数据远程仓库保存并同步这些数据。</p>
                  </div>
                  <Switch checked={autoSync} onCheckedChange={setAutoSync} disabled={saving} aria-label="自动同步软件数据" />
                </div>
                <div className="grid gap-2 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center">
                  <label htmlFor="software-data-interval" className="na-label text-muted-foreground">同步间隔</label>
                  <Input
                    id="software-data-interval"
                    type="number"
                    min={30}
                    step={30}
                    value={intervalSeconds}
                    onChange={(event) => setIntervalSeconds(event.target.value)}
                    className="h-8 text-xs"
                    disabled={saving}
                  />
                  <span className="na-caption text-muted-foreground">秒</span>
                </div>
                <div className="flex justify-end">
                  <Button type="button" size="sm" className={compactButtonClass} onClick={() => void save()} disabled={saving}>
                    <Save />
                    {saving ? "保存中" : "保存策略"}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {notice && (
            <div role={notice.tone === "error" ? "alert" : "status"} className={cn("border-t px-1 pt-3 na-caption", notice.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300")}>
              {notice.message}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
