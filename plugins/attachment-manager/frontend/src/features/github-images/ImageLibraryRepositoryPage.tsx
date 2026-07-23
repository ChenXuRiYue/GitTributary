import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  GitBranch,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import type {
  GitHubImageConfig,
  GitHubImageConfigCheck,
  GitHubImageLibrary,
  GitRemoteBinding,
  GitRemoteConfigEntry,
} from "../../types";
import { bindingKey, migrationError, remoteBinding, remoteEntryKey } from "./model";

export function ImageLibraryRepositoryPage({
  initialLibrary,
  existing,
  onDraftChange,
  remotes,
  saving,
  onBack,
  onSave,
  onDelete,
  onAddRemote,
  onRefresh,
}: {
  initialLibrary: GitHubImageLibrary;
  existing: boolean;
  onDraftChange: (library: GitHubImageLibrary) => void;
  remotes: GitRemoteConfigEntry[];
  saving: boolean;
  onBack: () => void;
  onSave: (library: GitHubImageLibrary) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddRemote: (draft: { name: string; url: string; token: string }) => Promise<GitRemoteBinding>;
  onRefresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(initialLibrary);
  const [addingRemote, setAddingRemote] = useState(false);
  const [remoteDraft, setRemoteDraft] = useState({ name: "image-cloud", url: "", token: "" });
  const [showToken, setShowToken] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<GitHubImageConfigCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const selectedKey = draft.remote ? bindingKey(draft.remote) : "";
  const selectedEntry = useMemo(
    () => remotes.find((entry) => remoteEntryKey(entry) === selectedKey) ?? null,
    [remotes, selectedKey],
  );

  const updateDraft = (updater: (current: GitHubImageLibrary) => GitHubImageLibrary) => {
    setDraft((current) => {
      const next = updater(current);
      onDraftChange(next);
      return next;
    });
  };

  const selectRemote = (entry: GitRemoteConfigEntry) => {
    const binding = remoteBinding(entry);
    if (!binding) return;
    updateDraft((current) => ({ ...current, remote: binding, suggestedRemoteUrl: undefined }));
    setCheck(null);
    setError(null);
  };

  const addRemote = async () => {
    setError(null);
    try {
      const binding = await onAddRemote(remoteDraft);
      updateDraft((current) => ({ ...current, remote: binding, suggestedRemoteUrl: undefined }));
      setRemoteDraft({ name: "image-cloud", url: "", token: "" });
      setAddingRemote(false);
    } catch (reason) {
      setError(migrationError(reason));
    }
  };

  const checkConnection = async () => {
    if (!draft.remote) return;
    setChecking(true);
    setCheck(null);
    setError(null);
    try {
      const config: GitHubImageConfig = {
        remote: draft.remote,
        branch: draft.branch,
        directory: draft.directory,
      };
      setCheck(await invoke<GitHubImageConfigCheck>("attachments_check_github_image_config", { config }));
    } catch (reason) {
      setError(migrationError(reason));
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setError(null);
    try {
      await onSave(draft);
    } catch (reason) {
      setError(migrationError(reason));
    }
  };

  const remove = async () => {
    try {
      await onDelete(draft.id);
      setDeletionRequested(false);
    } catch (reason) {
      setError(migrationError(reason));
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl pb-4">
      <div className="border-border/50 flex min-h-12 items-center gap-2 border-b pb-3">
        <Button variant="ghost" size="icon" onClick={onBack} title="返回图库配置">
          <ArrowLeft />
        </Button>
        <div>
          <h2 className="na-title-panel">图库仓库</h2>
          <div className="text-muted-foreground na-caption">{existing ? "管理 Git 远程绑定" : "添加 Git 远程绑定"}</div>
        </div>
        {existing && (
          <Button variant="ghost" size="icon" className="text-destructive ml-auto" onClick={() => setDeletionRequested(true)} disabled={saving} title="删除图库">
            <Trash2 />
          </Button>
        )}
        <Button size="sm" className={existing ? "" : "ml-auto"} onClick={() => void save()} disabled={saving || !draft.name.trim() || !draft.remote}>
          {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
          保存图库
        </Button>
      </div>

      <section className="border-border/50 grid gap-3 border-b py-4 sm:grid-cols-3">
        <Field label="图库名称" value={draft.name} onChange={(name) => updateDraft((current) => ({ ...current, name }))} />
        <Field label="目标分支" value={draft.branch} onChange={(branch) => updateDraft((current) => ({ ...current, branch }))} />
        <Field label="图片目录" value={draft.directory} onChange={(directory) => updateDraft((current) => ({ ...current, directory }))} />
      </section>

      <section className="border-border/50 border-b py-4">
        <div className="mb-3 flex items-center gap-2">
          <GitBranch className="size-4" />
          <h3 className="na-title-section">选择 Git 远程</h3>
          <Badge variant="outline" className="h-5 px-1.5 na-caption">{remotes.length}</Badge>
          <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={() => void onRefresh()} title="刷新 Git 远程">
            <RefreshCw />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAddingRemote((current) => !current)}>
            <Plus />
            添加仓库
          </Button>
        </div>

        {remotes.length === 0 ? (
          <div className="text-muted-foreground na-body border-border/60 border border-dashed px-4 py-8 text-center">
            Git 模块中没有带可用 Token 的 HTTPS GitHub 远程
          </div>
        ) : (
          <div className="divide-border/40 divide-y border-y">
            {remotes.map((entry) => {
              const binding = remoteBinding(entry);
              if (!binding) return null;
              const selected = remoteEntryKey(entry) === selectedKey;
              return (
                <label key={remoteEntryKey(entry)} className="hover:bg-accent/20 flex cursor-pointer items-center gap-3 px-2 py-3">
                  <input type="radio" name="git-remote" checked={selected} onChange={() => selectRemote(entry)} className="accent-primary size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="na-body-strong flex items-center gap-2">
                      <span>{entry.name}</span>
                      {entry.credential_mode !== "system" && <Badge variant="secondary" className="h-5 px-1.5 na-caption">Git 凭证</Badge>}
                    </div>
                    <div className="text-muted-foreground na-caption truncate" title={entry.url}>{entry.url}</div>
                    <div className="text-muted-foreground na-caption truncate" title={entry.repo_path ?? undefined}>{entry.repo_path}</div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </section>

      {addingRemote && (
        <section className="border-border/50 border-b py-4">
          <div className="mb-3 flex items-center gap-2">
            <Plus className="size-4" />
            <h3 className="na-title-section">添加到 Git 远程</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-[180px_minmax(220px,1fr)_minmax(180px,1fr)_auto] sm:items-end">
            <Field label="远程名称" value={remoteDraft.name} onChange={(name) => setRemoteDraft((current) => ({ ...current, name }))} />
            <Field label="GitHub HTTPS URL" value={remoteDraft.url} onChange={(url) => setRemoteDraft((current) => ({ ...current, url }))} />
            <div>
              <label className="na-label text-muted-foreground mb-1.5 block">Access Token</label>
              <div className="relative">
                <Input type={showToken ? "text" : "password"} value={remoteDraft.token} onChange={(event) => setRemoteDraft((current) => ({ ...current, token: event.target.value }))} className="h-8 pr-9" />
                <button type="button" onClick={() => setShowToken((current) => !current)} className="text-muted-foreground absolute right-1 top-1 flex size-6 items-center justify-center" title={showToken ? "隐藏 Token" : "显示 Token"}>
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button size="sm" onClick={() => void addRemote()} disabled={saving || !remoteDraft.name.trim() || !remoteDraft.url.trim() || !remoteDraft.token.trim()}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
              添加
            </Button>
          </div>
        </section>
      )}

      {draft.remote && (
        <section className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="na-body-strong truncate">{selectedEntry?.name ?? draft.remote.name}</div>
              <div className="text-muted-foreground na-caption truncate">{draft.remote.url}</div>
            </div>
            {check && (
              <span className="text-primary na-caption flex items-center gap-1">
                <CheckCircle2 className="size-3.5" />
                已连接 · {check.private ? "私有仓库" : "公开仓库"}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => void checkConnection()} disabled={checking}>
              {checking ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
              {checking ? "正在检查" : "检查连接"}
            </Button>
          </div>
        </section>
      )}

      {error && <div className="border-destructive/40 bg-destructive/5 text-destructive na-body border px-4 py-3">{error}</div>}
      <ConfirmDialog
        open={deletionRequested}
        title="确认删除图库"
        description={`删除图库“${draft.name}”？Git 远程仓库不会被删除。`}
        confirmLabel="删除图库"
        destructive
        busy={saving}
        onCancel={() => setDeletionRequested(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="na-label text-muted-foreground mb-1.5 block">{label}</label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-8" />
    </div>
  );
}
