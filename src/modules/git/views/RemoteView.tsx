import {
  ChevronDown, Eye, EyeOff, FolderOpen, Globe, Link,
  Plus, Save, ShieldCheck, Trash2, Unplug,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import type { GitViewProps } from "../types";
import { RemoteViewHeader, RemoteViewNotices } from "../components/RemoteViewHeader";
import {
  credentialLabel, purposeLabel, remoteKey, repositoryName,
  sourceLabel, useRemoteView, verifyLabel,
} from "../hooks/useRemoteView";

export function RemoteView({
  overview,
  recentRepos,
  sessionGeneration,
  openRepository,
  refreshRepository,
}: GitViewProps) {
  const {
    remotes, syncConfig,
    cloneUrl, setCloneUrl, cloneParentPath, setCloneParentPath,
    cloneToken, setCloneToken, cloneCommitName, setCloneCommitName,
    cloneCommitEmail, setCloneCommitEmail, showCloneToken, setShowCloneToken,
    configUrl, setConfigUrl, configBranch, setConfigBranch,
    configToken, setConfigToken, showConfigToken, setShowConfigToken,
    checkingConfig, addingRemote, addRemoteDraft, setAddRemoteDraft, savingNewRemote,
    remoteDrafts, remoteBusyKey, expandedRemoteKeys, setExpandedRemoteKeys,
    configCheck, status, error, refresh, openRepo, openFromDialog,
    selectClonePathFromDialog, handleCloneRemote, handleAddRemote, updateRemoteDraft,
    handleUpdateRemote, handleRemoveRemote, handleCheckConfigRepo,
    handleSaveConfigRemote, handleUnbindConfigRemote, hasConfigRemote,
  } = useRemoteView({
    overview,
    sessionGeneration,
    openRepository,
    refreshRepository,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <RemoteViewHeader
        overview={overview}
        recentRepos={recentRepos}
        onOpenRepo={(path) => void openRepo(path)}
        onOpenDialog={() => void openFromDialog()}
        onRefresh={() => void refresh()}
      />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <RemoteViewNotices
        overview={overview}
        recentRepos={recentRepos}
        status={status}
        error={error}
        onOpenRepo={(path) => void openRepo(path)}
        onOpenDialog={() => void openFromDialog()}
      />

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
              const draft = remoteDrafts[key] ?? {
                url: r.url,
                token: "",
                commitName: r.commit_name ?? "",
                commitEmail: r.commit_email ?? "",
                showToken: false,
              };
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
                    {(r.commit_name || r.commit_email) && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        提交身份 {r.commit_name || "全局名称"} &lt;{r.commit_email || "全局邮箱"}&gt;
                      </span>
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
                          <span className="text-[11px] font-medium text-muted-foreground">提交名称</span>
                          <Input
                            value={draft.commitName}
                            onChange={(e) => updateRemoteDraft(key, { commitName: e.target.value })}
                            placeholder="留空则使用安全配置"
                            className="h-8 text-xs"
                          />
                          <span className="text-[11px] font-medium text-muted-foreground">提交邮箱</span>
                          <Input
                            value={draft.commitEmail}
                            onChange={(e) => updateRemoteDraft(key, { commitEmail: e.target.value })}
                            placeholder="留空则使用安全配置"
                            className="h-8 text-xs"
                          />
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

      {overview && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plus className="size-4" /> 新增远程仓库
              <Badge variant="outline" className="text-[9px]">当前仓库</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-[88px_1fr] items-center gap-2">
              <span className="text-[11px] text-muted-foreground">名称</span>
              <Input
                value={addRemoteDraft.name}
                onChange={(e) => setAddRemoteDraft((draft) => ({ ...draft, name: e.target.value }))}
                placeholder="origin"
                className="h-8 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">URL</span>
              <Input
                value={addRemoteDraft.url}
                onChange={(e) => setAddRemoteDraft((draft) => ({ ...draft, url: e.target.value }))}
                placeholder="https://github.com/user/repo.git"
                className="h-8 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">Access Token</span>
              <div className="relative">
                <Input
                  type={addRemoteDraft.showToken ? "text" : "password"}
                  value={addRemoteDraft.token}
                  onChange={(e) => setAddRemoteDraft((draft) => ({ ...draft, token: e.target.value }))}
                  placeholder="必填: 保存前校验仓库访问权限"
                  className="h-8 pr-8 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setAddRemoteDraft((draft) => ({ ...draft, showToken: !draft.showToken }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {addRemoteDraft.showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <span className="text-[11px] text-muted-foreground">提交名称</span>
              <Input
                value={addRemoteDraft.commitName}
                onChange={(e) => setAddRemoteDraft((draft) => ({ ...draft, commitName: e.target.value }))}
                placeholder="留空则使用安全配置"
                className="h-8 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">提交邮箱</span>
              <Input
                value={addRemoteDraft.commitEmail}
                onChange={(e) => setAddRemoteDraft((draft) => ({ ...draft, commitEmail: e.target.value }))}
                placeholder="留空则使用安全配置"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                提交身份会保存在远程仓库配置中;为空时提交使用安全配置中的全局名称和邮箱。
              </p>
              <Button
                size="sm"
                className="h-8"
                onClick={handleAddRemote}
                disabled={savingNewRemote || !addRemoteDraft.name.trim() || !addRemoteDraft.url.trim() || !addRemoteDraft.token.trim()}
              >
                <Save className="size-3.5" /> {savingNewRemote ? "校验中" : "新增"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
            <span className="text-[11px] text-muted-foreground">提交名称</span>
            <Input
              value={cloneCommitName}
              onChange={(e) => setCloneCommitName(e.target.value)}
              placeholder="留空则使用安全配置"
              className="h-8 text-xs"
            />
            <span className="text-[11px] text-muted-foreground">提交邮箱</span>
            <Input
              value={cloneCommitEmail}
              onChange={(e) => setCloneCommitEmail(e.target.value)}
              placeholder="留空则使用安全配置"
              className="h-8 text-xs"
            />
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
