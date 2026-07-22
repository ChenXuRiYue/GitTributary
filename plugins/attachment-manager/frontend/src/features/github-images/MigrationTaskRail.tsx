import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileText,
  LoaderCircle,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import type { ImageMigrationTaskRecord } from "../../types";
import { migrationError } from "./model";

const SHORT_TIME = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const FULL_TIME = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function MigrationTaskRail({
  repoPath,
  history,
}: {
  repoPath: string;
  history: ImageMigrationTaskRecord[];
}) {
  const tasks = useMemo(
    () => history.filter((task) => task.repoPath === repoPath),
    [history, repoPath],
  );
  const [selectedId, setSelectedId] = useState<string | null>(tasks[0]?.id ?? null);
  const running = tasks.find((task) => task.status === "running") ?? null;
  const completed = tasks.filter((task) => task.status !== "running");
  const previousRunningId = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const runningId = running?.id ?? null;
    if (runningId && previousRunningId.current !== runningId) {
      setSelectedId(runningId);
    }
    previousRunningId.current = runningId;
  }, [running?.id]);

  useEffect(() => {
    if (selectedId && !tasks.some((task) => task.id === selectedId)) {
      setSelectedId(tasks[0]?.id ?? null);
    }
  }, [selectedId, tasks]);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  return (
    <aside className="border-border/50 flex min-h-0 min-w-0 flex-col overflow-hidden border-t md:border-l md:border-t-0">
      {selected ? (
        <TaskDetails task={selected} now={now} onBack={() => setSelectedId(null)} />
      ) : (
        <TaskList
          tasks={tasks}
          running={running}
          completed={completed}
          onSelect={setSelectedId}
        />
      )}
    </aside>
  );
}

function TaskList({
  tasks,
  running,
  completed,
  onSelect,
}: {
  tasks: ImageMigrationTaskRecord[];
  running: ImageMigrationTaskRecord | null;
  completed: ImageMigrationTaskRecord[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/50 flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <Clock3 className="size-4" />
        <h3 className="gt-title-section">迁移任务</h3>
        <span className="text-muted-foreground gt-caption ml-auto tabular-nums">{tasks.length}</span>
      </div>
      {running && (
        <>
          <RailLabel label="进行中" count={1} />
          <TaskRow task={running} onSelect={() => onSelect(running.id)} />
        </>
      )}
      <RailLabel label="历史" count={completed.length} bordered={Boolean(running)} />
      <div className="gt-thin-scroll min-h-0 flex-1 divide-y divide-border/40 overflow-y-auto overscroll-contain">
        {completed.length === 0 ? (
          <div className="text-muted-foreground flex h-full min-h-24 flex-col items-center justify-center gap-1.5 px-3 text-center">
            <CircleDashed className="size-4" />
            <span className="gt-caption">还没有迁移记录</span>
          </div>
        ) : completed.map((task) => (
          <TaskRow key={task.id} task={task} onSelect={() => onSelect(task.id)} />
        ))}
      </div>
    </div>
  );
}

function RailLabel({ label, count, bordered = false }: { label: string; count: number; bordered?: boolean }) {
  return (
    <div className={cn(
      "border-border/50 text-muted-foreground gt-label flex min-h-8 shrink-0 items-center px-3",
      bordered && "border-t",
    )}>
      {label}
      <span className="ml-auto tabular-nums">{count}</span>
    </div>
  );
}

function TaskRow({ task, onSelect }: { task: ImageMigrationTaskRecord; onSelect: () => void }) {
  const StatusIcon = task.status === "running"
    ? LoaderCircle
    : task.status === "succeeded"
      ? CheckCircle2
      : AlertTriangle;
  return (
    <button
      type="button"
      className="hover:bg-accent/30 flex min-h-12 w-full min-w-0 items-center gap-2 border-l-2 border-transparent px-2.5 py-2 text-left transition-colors hover:border-border"
      onClick={onSelect}
    >
      <StatusIcon className={cn(
        "size-3.5 shrink-0",
        task.status === "running" && "text-primary animate-spin",
        task.status !== "running" && task.status !== "succeeded" && "text-destructive",
      )} />
      <span className="min-w-0 flex-1">
        <span className="gt-body-strong block truncate">
          {task.status === "running" ? "正在迁移" : statusLabel(task.status)} · {task.imagePaths.length} 张
        </span>
        <span className="text-muted-foreground gt-caption mt-0.5 block truncate">
          {task.library.name} · {SHORT_TIME.format(task.startedAt)}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground/60 size-3.5 shrink-0" />
    </button>
  );
}

function TaskDetails({
  task,
  now,
  onBack,
}: {
  task: ImageMigrationTaskRecord;
  now: number;
  onBack: () => void;
}) {
  const result = task.result;
  const failures = result ? [
    ...result.failed.map((failure) => ({ ...failure, kind: "图片" })),
    ...result.failedNotes.map((failure) => ({ ...failure, kind: "Markdown" })),
    ...result.failedDeletes.map((failure) => ({ ...failure, kind: "本地删除" })),
  ] : [];
  const StatusIcon = task.status === "running"
    ? LoaderCircle
    : task.status === "succeeded"
      ? CheckCircle2
      : AlertTriangle;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/50 flex min-h-10 shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onBack}
          aria-label="返回任务列表"
          title="返回任务列表"
        >
          <ArrowLeft />
        </Button>
        <h3 className="gt-title-section">任务详情</h3>
        <span className={cn(
          "gt-caption ml-auto flex items-center gap-1",
          task.status === "running" && "text-primary",
          task.status !== "running" && task.status !== "succeeded" && "text-destructive",
        )}>
          <StatusIcon className={cn("size-3.5", task.status === "running" && "animate-spin")} />
          {statusLabel(task.status)}
        </span>
      </div>

      <div className="gt-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section className="border-border/50 border-b px-3 py-3">
          <div className="flex items-start gap-2.5">
            <StatusIcon className={cn(
              "mt-0.5 size-5 shrink-0",
              task.status === "running" && "text-primary animate-spin",
              task.status !== "running" && task.status !== "succeeded" && "text-destructive",
            )} />
            <div className="min-w-0">
              <div className="gt-body-strong">{taskSummary(task.status)}</div>
              <div className="text-muted-foreground gt-caption mt-0.5">
                {task.imagePaths.length} 张图片 · {task.noteCount} 篇 Markdown
              </div>
              <div className="text-muted-foreground gt-caption mt-1">
                {FULL_TIME.format(task.startedAt)} · {durationLabel(task, now)}
              </div>
            </div>
          </div>
        </section>

        <section className="border-border/50 border-b">
          <SectionTitle>迁移设置</SectionTitle>
          <dl className="divide-border/30 divide-y px-3 pb-1">
            <DetailRow label="目标图库" value={task.library.name} />
            <DetailRow
              label="目标位置"
              value={`${task.library.config.branch}/${task.library.config.directory || "root"}`}
            />
            <DetailRow
              label="本地图片"
              value={task.settings.localFilePolicy === "keep" ? "保留" : "成功后删除"}
            />
          </dl>
        </section>

        {result && (
          <section className="border-border/50 border-b">
            <SectionTitle>迁移结果</SectionTitle>
            <div className="divide-border/40 grid grid-cols-3 divide-x px-1 pb-2">
              <ResultMetric label="图片" value={result.migrated.length} />
              <ResultMetric label="笔记" value={result.changedNotes} />
              <ResultMetric label="失败" value={failures.length} destructive={failures.length > 0} />
            </div>
            <div className="border-border/30 text-muted-foreground gt-caption flex items-center gap-3 border-t px-3 py-2">
              <span>替换引用 <strong className="text-foreground font-medium">{result.replacedReferences}</strong></span>
              {task.settings.localFilePolicy === "delete_after_success" && (
                <span>删除本地 <strong className="text-foreground font-medium">{result.deletedLocalPaths.length}</strong></span>
              )}
            </div>
          </section>
        )}

        {task.error && (
          <section className="border-border/50 border-b px-3 py-2.5">
            <div className="text-destructive gt-label mb-1">错误</div>
            <div className="text-destructive gt-caption break-all">{task.error}</div>
          </section>
        )}

        {result && result.changedNotePaths.length > 0 && (
          <section className="border-border/50 border-b">
            <SectionTitle count={result.changedNotePaths.length}>已修改 Markdown</SectionTitle>
            <div className="divide-border/30 divide-y px-3 pb-1">
              {result.changedNotePaths.map((path) => (
                <div key={path} className="gt-caption flex min-w-0 items-center gap-2 py-1.5">
                  <FileText className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="min-w-0 truncate" title={path}>{path}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {failures.length > 0 && (
          <section>
            <SectionTitle count={failures.length} destructive>失败项</SectionTitle>
            <div className="divide-border/30 divide-y px-3 pb-1">
              {failures.map((failure, index) => (
                <div key={`${failure.kind}:${failure.path}:${index}`} className="py-2">
                  <div className="gt-caption flex min-w-0 items-center gap-2">
                    <span className="text-destructive gt-label shrink-0">{failure.kind}</span>
                    <span className="min-w-0 truncate" title={failure.path}>{failure.path}</span>
                  </div>
                  <div className="text-destructive gt-caption mt-1 break-all">
                    {migrationError(failure.error)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SectionTitle({
  children,
  count,
  destructive = false,
}: {
  children: React.ReactNode;
  count?: number;
  destructive?: boolean;
}) {
  return (
    <div className={cn(
      "text-muted-foreground gt-label flex min-h-8 items-center px-3",
      destructive && "text-destructive",
    )}>
      {children}
      {count !== undefined && <span className="ml-auto tabular-nums">{count}</span>}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="gt-caption flex min-w-0 items-center justify-between gap-3 py-1.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right" title={value}>{value}</dd>
    </div>
  );
}

function ResultMetric({
  label,
  value,
  destructive = false,
}: {
  label: string;
  value: number;
  destructive?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center px-1 py-1">
      <span className={cn("gt-title-section tabular-nums", destructive && "text-destructive")}>{value}</span>
      <span className="text-muted-foreground gt-label mt-0.5">{label}</span>
    </div>
  );
}

function taskSummary(status: ImageMigrationTaskRecord["status"]) {
  switch (status) {
    case "running": return "正在迁移图片";
    case "succeeded": return "迁移已完成";
    case "partial": return "部分项目未完成";
    case "failed": return "迁移未完成";
    case "interrupted": return "迁移已中断";
  }
}

function statusLabel(status: ImageMigrationTaskRecord["status"]) {
  switch (status) {
    case "running": return "运行中";
    case "succeeded": return "成功";
    case "partial": return "部分失败";
    case "failed": return "失败";
    case "interrupted": return "已中断";
  }
}

function durationLabel(task: ImageMigrationTaskRecord, now: number) {
  const duration = Math.max(0, (task.finishedAt ?? now) - task.startedAt);
  if (duration < 1000) return `${duration} ms`;
  return `${Math.floor(duration / 1000)} 秒`;
}
