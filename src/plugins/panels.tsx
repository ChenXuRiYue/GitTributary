import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen,
  Send,
  FileDown,
  RefreshCw,
  GitBranch as GitBranchIcon,
  FilePlus2,
  FilePen,
  FileX,
  FileQuestion,
  ChevronRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DiffViewer } from "@/components/DiffViewer";
import { cn } from "@/lib/utils";

/** 通用区块卡片 */
function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Types matching Rust structs ───────────────────────────────────────

interface RepoOverview {
  path: string;
  current_branch: string;
  is_dirty: boolean;
  changed_count: number;
  remote_url: string | null;
}

interface FileStatus {
  path: string;
  kind: string;
  staged: boolean;
}

interface CommitInfo {
  id: string;
  short_id: string;
  message: string;
  author: string;
  time: string;
}

interface FileDiff {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

// ─── ChangeKind → Icon / Color mapping ────────────────────────────────

function StatusIcon({ kind, staged }: { kind: string; staged: boolean }) {
  const iconClass = "size-3.5";
  switch (kind) {
    case "Added":
      return <FilePlus2 className={cn(iconClass, "text-green-600")} />;
    case "Modified":
      return <FilePen className={cn(iconClass, "text-yellow-600")} />;
    case "Deleted":
      return <FileX className={cn(iconClass, "text-red-500")} />;
    case "Untracked":
      return <FileQuestion className={cn(iconClass, "text-muted-foreground")} />;
    default:
      return <FilePen className={cn(iconClass, staged ? "text-primary" : "text-muted-foreground")} />;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "Added": return "A";
    case "Modified": return "M";
    case "Deleted": return "D";
    case "Renamed": return "R";
    case "Untracked": return "?";
    case "Conflicted": return "!";
    default: return "?";
  }
}

// ─── Git Panel (Platform-level Git capabilities) ──────────────────────

export function GitPanel() {
  const [overview, setOverview] = useState<RepoOverview | null>(null);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const ov = await invoke<RepoOverview>("get_overview");
      setOverview(ov);
      const st = await invoke<FileStatus[]>("get_status");
      setStatuses(st);
      setChecked(new Set(st.map((s) => s.path)));
      setError(null);
    } catch {
      // not opened yet
    }
  }, []);

  const openDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    try {
      const ov = await invoke<RepoOverview>("open_repo", { path: selected });
      setOverview(ov);
      const st = await invoke<FileStatus[]>("get_status");
      setStatuses(st);
      setChecked(new Set(st.map((s) => s.path)));
      setError(null);
      setResult(null);
      setSelectedFile(null);
      setFileDiff(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleCheck = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (checked.size === statuses.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(statuses.map((s) => s.path)));
    }
  };

  const doCommit = async () => {
    if (!message.trim() || checked.size === 0) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      let info: CommitInfo;
      if (checked.size === statuses.length) {
        info = await invoke<CommitInfo>("commit_all", { message });
      } else {
        const paths = Array.from(checked);
        info = await invoke<CommitInfo>("commit_selected", { paths, message });
      }
      setResult(`提交成功 [${info.short_id}] ${info.message}`);
      setMessage("");
      setSelectedFile(null);
      setFileDiff(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const selectFile = async (path: string) => {
    if (selectedFile === path) {
      // 点击相同文件关闭预览
      setSelectedFile(null);
      setFileDiff(null);
      return;
    }
    setSelectedFile(path);
    setDiffLoading(true);
    try {
      const diff = await invoke<FileDiff>("get_file_diff", { path });
      setFileDiff(diff);
    } catch {
      setFileDiff(null);
    } finally {
      setDiffLoading(false);
    }
  };

  // Auto-refresh after opening
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      {/* 仓库选择 */}
      <Block title="工作仓库">
        <div className="flex items-center gap-2">
          <Input
            value={overview?.path ?? ""}
            placeholder="未选择工作目录…"
            readOnly
            className="text-xs"
          />
          <Button variant="outline" onClick={openDir}>
            <FolderOpen /> 选择目录
          </Button>
        </div>
        {overview && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <GitBranchIcon className="size-3.5" />
              {overview.current_branch}
            </span>
            {overview.remote_url && (
              <span className="truncate max-w-[200px]">{overview.remote_url}</span>
            )}
            <span>{overview.changed_count} 项变更</span>
          </div>
        )}
      </Block>

      {/* 变更列表 */}
      {overview && (
        <Block title="变更概览">
          {statuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">工作区干净,无变更。</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked.size === statuses.length}
                  onChange={toggleAll}
                  className="size-3.5 accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  {checked.size}/{statuses.length} 已选
                </span>
              </div>
              <ScrollArea className="max-h-56">
                <ul className="flex flex-col gap-0.5 text-sm">
                  {statuses.map((s, i) => (
                    <li
                      key={i}
                      onClick={() => selectFile(s.path)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
                        selectedFile === s.path
                          ? "bg-accent"
                          : "hover:bg-accent/50",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(s.path)}
                        onClick={(e) => toggleCheck(s.path, e)}
                        onChange={() => {}}
                        className="size-3.5 accent-primary"
                      />
                      <ChevronRight
                        className={cn(
                          "size-3 text-muted-foreground transition-transform",
                          selectedFile === s.path && "rotate-90",
                        )}
                      />
                      <Badge
                        variant="secondary"
                        className={cn(
                          "w-5 justify-center text-[10px] font-bold",
                          s.staged && "ring-1 ring-primary/40",
                        )}
                      >
                        {kindLabel(s.kind)}
                      </Badge>
                      <StatusIcon kind={s.kind} staged={s.staged} />
                      <span className="flex-1 truncate text-muted-foreground">
                        {s.path}
                      </span>
                      {s.staged && (
                        <Badge variant="outline" className="text-[10px]">
                          staged
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </>
          )}
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="size-3.5" /> 刷新
            </Button>
          </div>
        </Block>
      )}

      {/* Diff 预览 */}
      {selectedFile && overview && (
        <div>
          {diffLoading ? (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              加载 diff 中…
            </div>
          ) : fileDiff ? (
            <DiffViewer
              patch={fileDiff.patch}
              filePath={fileDiff.path}
              additions={fileDiff.additions}
              deletions={fileDiff.deletions}
            />
          ) : (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              无法加载 diff
            </div>
          )}
        </div>
      )}

      {/* 提交 */}
      {overview && (
        <Block title="提交变更">
          <div className="flex flex-col gap-3">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="提交信息…"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {checked.size === statuses.length
                  ? "暂存所有变更并创建提交"
                  : `暂存 ${checked.size}/${statuses.length} 个文件并创建提交`}
              </span>
              <Button onClick={doCommit} disabled={loading || !message.trim() || checked.size === 0}>
                <Send /> 提交{checked.size < statuses.length ? ` (${checked.size})` : ""}
              </Button>
            </div>
            {result && (
              <p className="text-xs text-green-600">{result}</p>
            )}
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        </Block>
      )}
    </>
  );
}

// ─── Other panels (unchanged, placeholder) ────────────────────────────

export function ReviewPanel() {
  return (
    <>
      <Block title="复习曲线">
        <p className="text-sm text-muted-foreground">
          基于遗忘曲线提示今天该回顾的笔记。
        </p>
      </Block>
      <Block title="今日待复习">
        <ul className="flex flex-col gap-2 text-sm">
          <li>算法 · 并查集</li>
          <li>Rust · 所有权与借用</li>
          <li>设计 · 状态机模式</li>
        </ul>
      </Block>
      <Block title="导出">
        <Button variant="outline">
          <FileDown /> 导出当周复习 PDF
        </Button>
      </Block>
    </>
  );
}

export function AiPanel() {
  return (
    <>
      <Block title="AI 助手">
        <p className="text-sm text-muted-foreground">
          活用 AI，打造博学、富有洞察力的笔记助手。
        </p>
      </Block>
      <Block title="对话">
        <div className="flex flex-col gap-3">
          <div className="bg-muted text-foreground self-start rounded-lg px-3 py-2 text-sm">
            你好，我可以帮你总结、检索、生成提交信息。
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="问点什么…" />
            <Button>
              <Send /> 发送
            </Button>
          </div>
        </div>
      </Block>
    </>
  );
}

export function DatabasePanel() {
  return (
    <>
      <Block title="笔记数据库">
        <p className="text-sm text-muted-foreground">
          为「笔记库 + AI」而生的数据库视图。
        </p>
      </Block>
      <Block title="标签 / 元数据">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">#工具书</Badge>
          <Badge variant="outline">#日记</Badge>
          <Badge variant="outline">#算法</Badge>
          <Badge variant="outline">#待整理</Badge>
        </div>
      </Block>
    </>
  );
}

function SettingRow({
  label,
  defaultChecked,
}: {
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm">{label}</span>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}

export function SettingsPanel() {
  return (
    <>
      <Block title="通用">
        <SettingRow label="启用非 Git 模式" />
        <SettingRow label="监听目录变更" defaultChecked />
      </Block>
      <Block title="安全">
        <SettingRow label="个人信息脱敏" />
        <SettingRow label="日记加密" />
      </Block>
      <Block title="插件">
        <Button variant="outline">管理插件…</Button>
      </Block>
    </>
  );
}
