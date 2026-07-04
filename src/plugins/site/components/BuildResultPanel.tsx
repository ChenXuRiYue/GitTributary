import {
  Badge,
} from "@/components/ui/badge";
import {
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Globe2,
  Loader2,
  Play,
  Settings2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { credentialLabel } from "../publish";
import { formatDuration, shortPath } from "../state";
import type { SiteBuildReport, SitePublishReport, SiteRunRecord, SiteWorkspaceGroup } from "../types";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate font-medium" title={value}>{value}</span>
    </div>
  );
}

function TaskSummary({
  task,
  onEditTask,
}: {
  task: SiteWorkspaceGroup | null;
  onEditTask: () => void;
}) {
  if (!task) {
    return (
      <section className="rounded-lg border border-dashed bg-card px-5 py-6 text-center">
        <Settings2 className="mx-auto size-7 text-muted-foreground" />
        <div className="gt-body-strong mt-2">还没有可执行的发布任务</div>
        <p className="gt-caption mt-1 text-muted-foreground">先去「发布任务」创建并配置一个任务。</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onEditTask}>
          <Settings2 className="size-3.5" />
          去配置发布任务
        </Button>
      </section>
    );
  }

  const target = task.target;

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
        <div className="min-w-0">
          <div className="gt-title-panel truncate">{task.name || "未命名任务"}</div>
          <p className="gt-caption mt-0.5 truncate text-muted-foreground">
            {task.sourceRepoPath ? shortPath(task.sourceRepoPath) : "未绑定源仓库"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onEditTask}>
          <Settings2 className="size-3.5" />
          编辑配置
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted/40 px-3 py-2">
          <GitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="gt-caption text-muted-foreground">源仓库</div>
            <div className="gt-body-strong truncate">{task.sourceRepoPath ? shortPath(task.sourceRepoPath) : "未配置"}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted/40 px-3 py-2">
          <Globe2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="gt-caption text-muted-foreground">发布仓库</div>
            <div className="gt-body-strong truncate">
              {target ? (target.targetRepoName || target.targetRepoUrl) : "未配置"}
            </div>
            {target && (
              <div className="gt-caption mt-0.5 truncate text-muted-foreground">
                {target.remoteName}/{target.targetBranch} · {target.publishDir === "/" ? "/root" : `/${target.publishDir}`}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReadinessHint({
  hasSourceRepo,
  hasDocumentScope,
  hasPublishTarget,
  onEditTask,
  onEditScope,
}: {
  hasSourceRepo: boolean;
  hasDocumentScope: boolean;
  hasPublishTarget: boolean;
  onEditTask: () => void;
  onEditScope: () => void;
}) {
  const items: { label: string; ready: boolean; onFix: () => void; fixLabel: string }[] = [
    { label: "源仓库", ready: hasSourceRepo, onFix: onEditTask, fixLabel: "去配置" },
    { label: "文档范围", ready: hasDocumentScope, onFix: onEditScope, fixLabel: "去勾选" },
    { label: "发布仓库", ready: hasPublishTarget, onFix: onEditTask, fixLabel: "去配置" },
  ];
  const allReady = items.every((item) => item.ready);
  if (allReady) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0 text-amber-600" />
        <div className="gt-body-strong">还差一些配置才能执行</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.filter((item) => !item.ready).map((item) => (
          <Button key={item.label} size="sm" variant="outline" onClick={item.onFix}>
            {item.label} · {item.fixLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}

function BuildResultSummary({ report }: { report: SiteBuildReport }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mt-0 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-3">
        <Metric label="页面" value={String(report.pageCount)} />
        <Metric label="资源" value={String(report.assetCount)} />
        <Metric label="耗时" value={formatDuration(report.durationMs)} />
      </div>
      {(report.warnings.length > 0 || report.brokenLinks.length > 0) && (
        <div className="mt-3 flex flex-col gap-1.5">
          {report.warnings.slice(0, 6).map((warning) => (
            <div key={`${warning.path}-${warning.message}`} className="gt-caption rounded-md bg-muted px-3 py-2">
              {warning.path}: {warning.message}
            </div>
          ))}
          {report.brokenLinks.slice(0, 6).map((link) => (
            <div key={`${link.source}-${link.target}`} className="gt-caption rounded-md bg-muted px-3 py-2">
              {link.source}: {link.target} ({link.kind})
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 truncate font-mono text-[11px] text-muted-foreground" title={report.indexHtml}>
        {report.indexHtml}
      </div>
    </div>
  );
}

function PublishResultSummary({ report }: { report: SitePublishReport }) {
  const shortCommit = report.commit?.slice(0, 7) ?? "无新提交";
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <div className="truncate gt-body-strong">
            {report.pushed ? "已推送" : "已生成"}
          </div>
        </div>
        <Badge variant="secondary" className="h-5 px-1.5 gt-caption">{shortCommit}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <Metric label="分支" value={`${report.remoteName}/${report.branch}`} />
        <Metric label="Pages 源" value={`${report.branch} ${report.publishDir === "/" ? "/root" : `/${report.publishDir}`}`} />
        <Metric label="复制" value={`${report.copiedFileCount} 文件`} />
        <Metric label="变更" value={`${report.changedCount} 项`} />
        <Metric label="凭证" value={report.credentialRef ? `${credentialLabel(report.credentialMode)} / ${report.credentialRef}` : credentialLabel(report.credentialMode)} />
        <Metric label="耗时" value={formatDuration(report.durationMs)} />
      </div>
      <div className="mt-3 truncate font-mono text-[11px] text-muted-foreground" title={report.publishPath}>
        {report.publishPath}
      </div>
    </div>
  );
}

function RunHistoryList({ history }: { history: SiteRunRecord[] }) {
  if (history.length === 0) return null;
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <div className="gt-title-panel">近期执行</div>
        <p className="gt-caption mt-1 text-muted-foreground">最近 {history.length} 次构建 / 发布记录，最新的在最前。</p>
      </div>
      <ul className="divide-y">
        {history.map((record) => {
          const ok = record.status === "succeeded";
          const kindLabel = record.kind === "build" ? "构建" : "发布";
          return (
            <li key={record.id} className="flex items-start gap-3 px-5 py-3">
              {ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={ok ? "secondary" : "destructive"} className="h-5 px-1.5 gt-caption">{kindLabel}</Badge>
                  <span className="gt-caption text-muted-foreground">{new Date(record.startedAt).toLocaleString()}</span>
                  <span className="gt-caption text-muted-foreground">{formatDuration(record.durationMs)}</span>
                  {typeof record.pageCount === "number" && (
                    <span className="gt-caption text-muted-foreground">{record.pageCount} 页面</span>
                  )}
                  {record.commit && (
                    <Badge variant="outline" className="h-5 px-1.5 gt-caption font-mono">{record.commit.slice(0, 7)}</Badge>
                  )}
                </div>
                <p className="gt-caption mt-1 truncate text-muted-foreground" title={record.message}>{record.message}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function BuildResultPanel({
  task,
  hasSourceRepo,
  hasDocumentScope,
  canBuild,
  isBuilding,
  canPublish,
  isPublishing,
  buildReport,
  publishReport,
  onBuild,
  onPublish,
  onOpenIndex,
  onRevealOutput,
  onEditTask,
  onEditScope,
}: {
  task: SiteWorkspaceGroup | null;
  hasSourceRepo: boolean;
  hasDocumentScope: boolean;
  canBuild: boolean;
  isBuilding: boolean;
  canPublish: boolean;
  isPublishing: boolean;
  buildReport: SiteBuildReport | null;
  publishReport: SitePublishReport | null;
  onBuild: () => void;
  onPublish: () => void;
  onOpenIndex: () => void;
  onRevealOutput: () => void;
  onEditTask: () => void;
  onEditScope: () => void;
}) {
  const hasPublishTarget = Boolean(task?.target);

  return (
    <div className="flex flex-col gap-4">
      <TaskSummary task={task} onEditTask={onEditTask} />

      {task && (
        <ReadinessHint
          hasSourceRepo={hasSourceRepo}
          hasDocumentScope={hasDocumentScope}
          hasPublishTarget={hasPublishTarget}
          onEditTask={onEditTask}
          onEditScope={onEditScope}
        />
      )}

      {task && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-5 py-4">
          <div>
            <div className="gt-body-strong">执行</div>
            <p className="gt-caption text-muted-foreground">构建仅生成静态站点;发布会构建后同步、提交并推送到发布仓库。</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onBuild} disabled={!canBuild}>
              {isBuilding ? <Loader2 className="animate-spin" /> : <Play />}
              构建
            </Button>
            <Button onClick={onPublish} disabled={!canPublish}>
              {isPublishing ? <Loader2 className="animate-spin" /> : <Play />}
              发布
            </Button>
          </div>
        </section>
      )}

      {buildReport ? (
        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
            <div>
              <div className="gt-title-panel">构建结果</div>
              <p className="gt-caption mt-1 text-muted-foreground">
                {buildReport.pageCount} 个页面 · {buildReport.assetCount} 个资源 · {formatDuration(buildReport.durationMs)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onRevealOutput}>
                <FolderOpen /> 输出目录
              </Button>
              <Button size="sm" onClick={onOpenIndex}>
                <ExternalLink /> 打开站点
              </Button>
            </div>
          </div>
          <div className="p-5">
            <BuildResultSummary report={buildReport} />
          </div>
        </section>
      ) : (
        <section className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-8 text-center">
          <CheckCircle2 className="size-7 text-muted-foreground" />
          <div className="gt-body-strong mt-2">还没有构建结果</div>
          <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
            点击上方「构建」或「发布」后,这里会显示输出目录、链接检查和提示信息。
          </p>
        </section>
      )}

      {publishReport && (
        <section className="rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <div className="gt-title-panel">发布结果</div>
            <p className="gt-caption mt-1 text-muted-foreground">最近一次发布到发布仓库的记录。</p>
          </div>
          <div className="p-5">
            <PublishResultSummary report={publishReport} />
          </div>
        </section>
      )}

      {task && <RunHistoryList history={task.runHistory} />}
    </div>
  );
}
