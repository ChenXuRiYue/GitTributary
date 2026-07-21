import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/shared/ui/badge";
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

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import { credentialLabel } from "../publish";
import { formatDuration, shortPath } from "../state";
import type { SiteBuildReport, SitePublishReport, SiteRunRecord, SiteWorkspaceGroup } from "../types";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/50 py-1.5 last:border-b-0">
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
      <section className="border-b px-5 py-8 text-center">
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
    <section className="border-b px-5 py-4">
      <div className="flex items-center justify-between gap-4">
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
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted/35 px-3 py-2">
          <GitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="gt-caption text-muted-foreground">源仓库</div>
            <div className="gt-body-strong truncate">{task.sourceRepoPath ? shortPath(task.sourceRepoPath) : "未配置"}</div>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted/35 px-3 py-2">
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
  const missing = items.filter((item) => !item.ready);
  if (missing.length === 0) return null;

  return (
    <section className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-3">
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0 text-amber-600" />
        <div className="gt-body-strong">还差一些配置才能执行</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {missing.map((item) => (
          <Button key={item.label} size="sm" variant="outline" onClick={item.onFix}>
            {item.label} · {item.fixLabel}
          </Button>
        ))}
      </div>
    </section>
  );
}

function BuildOutputDetails({ report }: { report: SiteBuildReport }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="grid grid-cols-1 gap-x-4 text-[12px] sm:grid-cols-3">
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

function PublishDetails({ report }: { report: SitePublishReport }) {
  const shortCommit = report.commit?.slice(0, 7) ?? "无新提交";
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <div className="truncate gt-body-strong">
            {report.pushed ? "已推送" : "已生成"}
          </div>
        </div>
        <Badge variant="secondary" className="h-5 px-1.5 gt-caption">{shortCommit}</Badge>
      </div>
      <div className="mt-3 grid gap-x-4 text-[12px] sm:grid-cols-2">
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

function isRecordInProgress(record: SiteRunRecord) {
  return record.status === "queued" || record.status === "running";
}

function runStatusLabel(status: SiteRunRecord["status"]) {
  switch (status) {
    case "queued": return "排队中";
    case "running": return "运行中";
    case "succeeded": return "成功";
    case "failed": return "失败";
    default: return status;
  }
}

function recordDurationLabel(record: SiteRunRecord, now: number) {
  if (isRecordInProgress(record)) {
    return `已运行 ${formatDuration(Math.max(0, now - record.startedAt))}`;
  }
  return formatDuration(record.durationMs);
}

function ExecutionRecordDetails({ record, now }: { record: SiteRunRecord; now: number }) {
  const ok = record.status === "succeeded";
  const running = isRecordInProgress(record);
  const kindLabel = record.kind === "build" ? "构建" : "发布";
  return (
    <section className="border-b px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {running ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          ) : ok ? (
            <CheckCircle2 className="size-4 shrink-0 text-primary" />
          ) : (
            <TriangleAlert className="size-4 shrink-0 text-destructive" />
          )}
          <div className="truncate gt-title-panel">{kindLabel}记录</div>
        </div>
        <Badge variant={ok || running ? "secondary" : "destructive"} className="h-5 px-1.5 gt-caption">
          {runStatusLabel(record.status)}
        </Badge>
      </div>
      <div className="mt-3 grid gap-x-4 text-[12px] sm:grid-cols-2">
        <Metric label="开始时间" value={new Date(record.startedAt).toLocaleString()} />
        <Metric label="耗时" value={recordDurationLabel(record, now)} />
        <Metric label="类型" value={kindLabel} />
        {typeof record.pageCount === "number" && <Metric label="页面" value={String(record.pageCount)} />}
        {typeof record.assetCount === "number" && <Metric label="资源" value={String(record.assetCount)} />}
        {record.commit && <Metric label="提交" value={record.commit.slice(0, 7)} />}
      </div>
      <p className="gt-caption mt-3 text-muted-foreground" title={record.message}>{record.message}</p>
    </section>
  );
}

function ExecutionHistoryRail({
  history,
  selectedId,
  now,
  onSelect,
}: {
  history: SiteRunRecord[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex min-w-0 flex-col border-b bg-sidebar/70 lg:border-b-0 lg:border-r">
      <div className="shrink-0 border-b px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="gt-title-panel">执行历史</div>
          <Badge variant="outline" className="h-5 px-1.5 gt-caption">{history.length}</Badge>
        </div>
        <p className="gt-caption mt-1 text-muted-foreground">构建 / 发布记录，最新在最前。</p>
      </div>
      <div className="gt-thin-scroll min-h-0 flex-1 overflow-auto">
        {history.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
            <CheckCircle2 className="size-8 text-muted-foreground" />
            <div className="gt-body-strong">还没有执行历史</div>
            <p className="gt-caption max-w-xs text-muted-foreground">执行构建或发布后，记录会出现在这里。</p>
          </div>
        ) : (
          <ul className="divide-y">
            {history.map((record) => {
              const ok = record.status === "succeeded";
              const running = isRecordInProgress(record);
              const selected = record.id === selectedId;
              const kindLabel = record.kind === "build" ? "构建" : "发布";
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full min-w-0 items-start gap-3 px-5 py-3 text-left transition-colors",
                      selected ? "bg-background text-foreground" : "hover:bg-background/70",
                    )}
                    onClick={() => onSelect(record.id)}
                  >
                    {running ? (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                    ) : ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : (
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="gt-body-strong">{kindLabel}</span>
                        <span className="gt-caption text-muted-foreground">{recordDurationLabel(record, now)}</span>
                        {record.commit && (
                          <span className="gt-caption font-mono text-muted-foreground">{record.commit.slice(0, 7)}</span>
                        )}
                      </span>
                      <span className="gt-caption mt-1 block truncate text-muted-foreground" title={record.message}>
                        {record.message}
                      </span>
                      <span className="gt-caption mt-1 block text-muted-foreground">
                        {new Date(record.startedAt).toLocaleString()}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
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
  const history = useMemo(() => task?.runHistory ?? [], [task?.runHistory]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(history[0]?.id ?? null);
  const hasRunningRecord = history.some(isRecordInProgress);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (history.length === 0) {
      setSelectedRecordId(null);
      return;
    }
    if (isRecordInProgress(history[0]) && selectedRecordId !== history[0].id) {
      setSelectedRecordId(history[0].id);
      return;
    }
    if (!selectedRecordId || !history.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(history[0].id);
    }
  }, [history, selectedRecordId]);

  useEffect(() => {
    if (!hasRunningRecord) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [hasRunningRecord]);

  const selectedRecord = history.find((record) => record.id === selectedRecordId) ?? null;
  const hasPublishTarget = Boolean(task?.target);
  const hasCurrentDetails = Boolean(buildReport || publishReport);

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <ExecutionHistoryRail
          history={history}
          selectedId={selectedRecordId}
          now={now}
          onSelect={setSelectedRecordId}
        />

        <section className="flex min-w-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/10 px-5 py-3">
            <div className="min-w-0">
              <div className="gt-title-panel">执行详情</div>
              <p className="gt-caption mt-0.5 truncate text-muted-foreground">配置、动作和最近一次输出。</p>
            </div>
            {task && (
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={onBuild} disabled={!canBuild}>
                  {isBuilding ? <Loader2 className="animate-spin" /> : <Play />}
                  构建
                </Button>
                <Button size="sm" onClick={onPublish} disabled={!canPublish}>
                  {isPublishing ? <Loader2 className="animate-spin" /> : <Play />}
                  发布
                </Button>
              </div>
            )}
          </div>

          <div className="gt-thin-scroll min-h-0 flex-1 overflow-auto">
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

            {selectedRecord && <ExecutionRecordDetails record={selectedRecord} now={now} />}

            {hasCurrentDetails ? (
              <section className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="gt-title-panel">最近输出</div>
                    <p className="gt-caption mt-0.5 truncate text-muted-foreground">
                      构建生成静态站点；发布会构建后同步、提交并推送到发布仓库。
                    </p>
                  </div>
                  {buildReport && (
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={onRevealOutput}>
                        <FolderOpen /> 输出目录
                      </Button>
                      <Button size="sm" onClick={onOpenIndex}>
                        <ExternalLink /> 打开站点
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  {buildReport && (
                    <div className="min-w-0">
                      <div className="gt-body-strong mb-2">站点输出</div>
                      <BuildOutputDetails report={buildReport} />
                    </div>
                  )}
                  {publishReport && (
                    <div className="min-w-0">
                      <div className="gt-body-strong mb-2">发布详情</div>
                      <PublishDetails report={publishReport} />
                    </div>
                  )}
                </div>
              </section>
            ) : (
              !selectedRecord && (
                <section className="flex min-h-72 flex-col items-center justify-center px-6 py-8 text-center">
                  <CheckCircle2 className="size-8 text-muted-foreground" />
                  <div className="gt-body-strong mt-2">还没有执行详情</div>
                  <p className="gt-caption mt-1 max-w-sm text-muted-foreground">
                    点击「构建」或「发布」后，这里会显示输出目录、链接检查、提交和推送信息。
                  </p>
                </section>
              )
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
