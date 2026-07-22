import { AlertTriangle, CircleCheck, LoaderCircle, RotateCcw } from "lucide-react";

import { Button } from "@/shared/ui/button";

import type { GitHubImageMigrationFailure, GitHubImageMigrationReport } from "../../types";
import { migrationError } from "./model";

export function ImageMigrationResult({
  result,
  retrying,
  onRetry,
}: {
  result: GitHubImageMigrationReport;
  retrying: boolean;
  onRetry: () => void;
}) {
  const uploadedCount = result.migrated.filter((item) => item.uploaded).length;
  const reusedCount = result.migrated.length - uploadedCount;
  const failures = [...result.failed, ...result.failedNotes, ...result.failedDeletes];
  const completedWithoutErrors = failures.length === 0;
  return (
    <section className="border-border/60 border">
      <div className="border-border/50 flex items-center gap-2 border-b px-4 py-2.5">
        {completedWithoutErrors
          ? <CircleCheck className="text-primary size-4" />
          : <AlertTriangle className="text-destructive size-4" />}
        <h2 className="gt-title-panel">迁移结果</h2>
        <span className="text-muted-foreground gt-caption ml-auto">{result.durationMs} ms</span>
        {result.failed.length > 0 && (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
            重试 {result.failed.length} 项
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
        <ResultMetric label="新上传" value={uploadedCount} />
        <ResultMetric label="已存在" value={reusedCount} />
        <ResultMetric label="修改笔记" value={result.changedNotes} />
        <ResultMetric label="替换引用" value={result.replacedReferences} />
      </div>
      {failures.length > 0 && (
        <div className="divide-border/30 divide-y">
          {failures.map((failure, index) => (
            <FailureRow key={`${failure.path}:${index}`} failure={failure} />
          ))}
        </div>
      )}
    </section>
  );
}

function ResultMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-3">
      <div className="gt-label text-muted-foreground">{label}</div>
      <div className="gt-title-panel mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function FailureRow({ failure }: { failure: GitHubImageMigrationFailure }) {
  return (
    <div className="grid gap-1 px-4 py-2 sm:grid-cols-[minmax(160px,1fr)_minmax(200px,2fr)]">
      <span className="gt-body-strong truncate" title={failure.path}>{failure.path}</span>
      <span className="text-destructive gt-caption break-all">{migrationError(failure.error)}</span>
    </div>
  );
}
