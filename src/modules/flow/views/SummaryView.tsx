import { CheckCircle2, Code2, Eye, FilePenLine, ListPlus, Play, Radio, Workflow } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/utils";
import { Metric, SectionHeader } from "../components/shared";
import type { FlowRecord, FlowRunReport } from "../types";
import { flowFileName, formatTime, normalizeFolder, runStatusText, runStatusTone, shortJson, statusTone, triggerText } from "../utils";

export function SummaryView({
  record,
  canOperate,
  isRunning,
  lastRun,
  onEdit,
  onRun,
  onToggle,
}: {
  record: FlowRecord;
  canOperate: boolean;
  isRunning: boolean;
  lastRun: FlowRunReport | null;
  onEdit: () => void;
  onRun: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { summary } = record;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <section className="rounded-md border">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="gt-title-panel truncate">{summary.name}</h3>
              <Badge variant="outline" className={cn("h-5 border", statusTone(record.enabled))}>
                {record.enabled ? "已启用" : "已暂停"}
              </Badge>
            </div>
            {summary.description && (
              <p className="gt-body mt-1 text-muted-foreground">{summary.description}</p>
            )}
            <p className="gt-code mt-1 truncate text-muted-foreground">{summary.id}</p>
          </div>
          {canOperate && (
            <div className="flex shrink-0 items-center gap-2">
              <Switch checked={record.enabled} onCheckedChange={onToggle} />
              <Button variant="outline" size="sm" onClick={onRun} disabled={isRunning}>
                <Play className="size-3.5" />
                {isRunning ? "运行中" : "运行一次"}
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Code2 className="size-3.5" />
                编辑 YAML
              </Button>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-3">
          <Metric label="来源" value={`flows/${normalizeFolder(record.folder, summary)}/${flowFileName(summary.id)}`} icon={FilePenLine} />
          <Metric label="触发器" value={`${summary.triggers.length}`} icon={Radio} />
          <Metric label="步骤" value={`${summary.step_count}`} icon={ListPlus} />
        </div>
      </section>

      <section className="rounded-md border">
        <SectionHeader icon={Radio} title="触发入口" />
        {summary.triggers.length === 0 ? (
          <p className="gt-body px-4 py-3 text-muted-foreground">未声明触发器。</p>
        ) : summary.triggers.map((trigger) => (
          <div key={trigger.kind} className="border-b px-4 py-3 last:border-b-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="gt-body-strong">{trigger.label}</p>
              <Badge variant="outline" className="h-5 border-slate-200 bg-slate-50 text-slate-600">
                {triggerText(trigger)}
              </Badge>
            </div>
            {trigger.detail && <p className="gt-caption mt-0.5 text-muted-foreground">{trigger.detail}</p>}
            {trigger.filters && Object.keys(trigger.filters).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(trigger.filters).map(([key, values]) => (
                  <Badge key={key} variant="outline" className="h-5 border-border bg-background text-muted-foreground">
                    {key}: {values.join(", ")}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="rounded-md border">
        <SectionHeader icon={Workflow} title="步骤摘要" aside={`${summary.jobs.length} jobs`} />
        {summary.jobs.map((job) => (
          <div key={job.id} className="border-b last:border-b-0">
            <div className="border-b bg-muted/25 px-4 py-2">
              <p className="gt-body-strong">{job.name || job.id}</p>
            </div>
            {job.steps.map((step, index) => (
              <div key={`${job.id}-${step.id ?? step.uses}-${index}`} className="grid grid-cols-[2rem_1fr] gap-3 border-b px-4 py-2.5 last:border-b-0">
                <span className="gt-caption text-muted-foreground">{index + 1}</span>
                <div className="min-w-0">
                  <p className="gt-code truncate">{step.uses}</p>
                  {(step.id || step.name) && (
                    <p className="gt-caption mt-0.5 text-muted-foreground">{step.name || step.id}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="rounded-md border">
        <SectionHeader
          icon={Play}
          title="最近执行"
          aside={lastRun ? formatTime(lastRun.finished_at || lastRun.started_at) : "尚未运行"}
        />
        {!lastRun ? (
          <p className="gt-body px-4 py-3 text-muted-foreground">
            操作模式下点击“运行一次”后,这里会展示本次 run 的触发来源、节点状态和错误信息。
          </p>
        ) : (
          <div>
            <div className="grid gap-0 border-b md:grid-cols-4">
              <Metric label="状态" value={runStatusText(lastRun.status)} icon={CheckCircle2} />
              <Metric label="触发" value={lastRun.trigger} icon={Radio} />
              <Metric label="Run ID" value={lastRun.run_id} icon={Workflow} />
              <Metric label="原因" value={lastRun.reason} icon={Eye} />
            </div>
            {lastRun.error && (
              <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">
                {lastRun.error}
              </div>
            )}
            {lastRun.jobs.map((job) => (
              <div key={job.job_id} className="border-b last:border-b-0">
                <div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-4 py-2">
                  <p className="gt-body-strong">{job.job_id}</p>
                  <Badge variant="outline" className={cn("h-5 border", runStatusTone(job.status))}>
                    {runStatusText(job.status)}
                  </Badge>
                </div>
                {job.nodes.map((node, index) => (
                  <div key={`${node.job_id}-${node.node_id}-${index}`} className="grid grid-cols-[2rem_1fr_auto] gap-3 border-b px-4 py-2.5 last:border-b-0">
                    <span className="gt-caption text-muted-foreground">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="gt-code truncate">{node.node_id}</p>
                        <span className="gt-caption truncate text-muted-foreground">{node.uses}</span>
                      </div>
                      {node.message && <p className="gt-caption mt-0.5 text-muted-foreground">{node.message}</p>}
                      {node.error && <p className="gt-caption mt-0.5 text-red-700">{node.error}</p>}
                      {node.outputs !== undefined && (
                        <p className="gt-caption mt-0.5 truncate text-muted-foreground">outputs: {shortJson(node.outputs)}</p>
                      )}
                    </div>
                    <Badge variant="outline" className={cn("h-5 border", runStatusTone(node.status))}>
                      {runStatusText(node.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-md border">
        <SectionHeader icon={FilePenLine} title="存储信息" />
        <div className="grid md:grid-cols-2">
          <div className="border-b px-4 py-3 md:border-b-0 md:border-r">
            <p className="gt-label text-muted-foreground">创建时间</p>
            <p className="gt-body mt-1">{formatTime(record.created_at)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="gt-label text-muted-foreground">更新时间</p>
            <p className="gt-body mt-1">{formatTime(record.updated_at)}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
