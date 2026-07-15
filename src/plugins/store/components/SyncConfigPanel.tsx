import { AlertCircle, Cloud, GitBranch, Layers, Plus, RefreshCw, Save, Unplug, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ConfigRepoCheckReport, DataCenterConfigCredentialStatus, SyncConfigPayload } from "../types";
import { isConfigCenterUrl } from "../utils";
import { ConfigRepoCheckMessage } from "./ConfigRepoCheckMessage";

interface SyncConfigPanelProps {
  syncConfig: SyncConfigPayload | null;
  credential: DataCenterConfigCredentialStatus | null;
  remoteUrl: string;
  token: string;
  branch: string;
  checkStatus: ConfigRepoCheckReport | null;
  checkingRepo: boolean;
  syncingNow: boolean;
  environments: string[];
  activeEnvironmentValue: string;
  activeEnvironmentLabel: string;
  newEnvironmentName: string;
  onClose: () => void;
  onRemoteUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onCheck: () => void;
  onSave: () => void;
  onSync: () => void;
  onSwitchEnvironment: (name: string) => void;
  onNewEnvironmentNameChange: (value: string) => void;
  onCreateEnvironment: () => void;
}

export function SyncConfigPanel(props: SyncConfigPanelProps) {
  const hasCredential = Boolean(props.credential?.has_token);
  const canUseRepo = isConfigCenterUrl(props.remoteUrl) && (Boolean(props.token.trim()) || hasCredential);

  return (
    <div className="absolute right-4 top-12 z-20 w-[480px] max-w-[calc(100%-32px)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="mb-3 flex items-center gap-2">
        <Cloud className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">远程 Git 数据配置中心</div>
          <div className="truncate text-[10px] text-muted-foreground">仓库承载多套环境配置,同步必须使用专用 Token</div>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={props.onClose}><X className="size-3.5" /></Button>
      </div>

      <div className="mb-3 rounded-md border border-border/70 bg-muted/20 px-2 py-2">
        <div className="mb-2 flex items-center gap-2">
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium">数据中心配置仓库</span>
          {props.syncConfig?.url && <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[9px]">已绑定</Badge>}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="text-[11px] text-muted-foreground">配置中心仓库必须使用 HTTPS URL 和明确的 Access Token。系统凭据、SSH Agent 或 SSH Key 不用于数据中心同步。</div>
          </div>
          <div className="grid grid-cols-[88px_1fr] items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">仓库 URL</span>
            <Input value={props.remoteUrl} onChange={(event) => props.onRemoteUrlChange(event.target.value)} placeholder="https://github.com/user/gt-config.git" className="h-7 text-xs" />
            <span className="text-[11px] font-medium text-muted-foreground">Access Token</span>
            <Input type="password" value={props.token} onChange={(event) => props.onTokenChange(event.target.value)} placeholder={hasCredential ? "留空则沿用已保存 Token" : "必填: 配置中心专用 Token"} className="h-7 text-xs" />
            <span className="text-[11px] text-muted-foreground">分支</span>
            <Input value={props.branch} onChange={(event) => props.onBranchChange(event.target.value)} className="h-7 text-xs" />
            <span className="text-[11px] text-muted-foreground">本地工作副本</span>
            <div className="truncate rounded-md border bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{props.syncConfig?.local_database_path ?? "保存后由数据中心分配"}</div>
          </div>
          {props.checkStatus && <ConfigRepoCheckMessage report={props.checkStatus} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={props.onCheck} disabled={!canUseRepo || props.checkingRepo}>
              <Unplug className="size-3.5" /> {props.checkingRepo ? "验证中" : "验证"}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={props.onSave} disabled={!canUseRepo}>
              <Save className="size-3.5" /> 保存并绑定
            </Button>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={props.onSync}
              disabled={!props.syncConfig || !isConfigCenterUrl(props.syncConfig.url) || !hasCredential || props.syncingNow}
              title="pull → import → export → commit → push"
            >
              <RefreshCw className={cn("size-3.5", props.syncingNow && "animate-spin")} /> {props.syncingNow ? "同步中" : "立即同步"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border/70 bg-muted/20 px-2 py-2">
        <div className="mb-2 flex items-center gap-2">
          <Layers className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium">环境配置</span>
          <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[9px]">{props.activeEnvironmentLabel}</Badge>
        </div>
        <div className="grid grid-cols-[76px_1fr_auto] items-center gap-2">
          <span className="text-[11px] text-muted-foreground">当前环境</span>
          {props.environments.length > 0 ? (
            <select value={props.activeEnvironmentValue} onChange={(event) => event.target.value && props.onSwitchEnvironment(event.target.value)} className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none">
              {props.environments.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
            </select>
          ) : <div className="flex h-7 items-center rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">默认</div>}
          <span />
          <span className="text-[11px] text-muted-foreground">新增环境</span>
          <Input value={props.newEnvironmentName} onChange={(event) => props.onNewEnvironmentNameChange(event.target.value)} placeholder="test / staging / prod" className="h-7 text-xs" />
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={props.onCreateEnvironment} disabled={!props.newEnvironmentName.trim()} title="基于当前 public 数据创建环境(Phase 1 仅同步 data 命名空间)">
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
