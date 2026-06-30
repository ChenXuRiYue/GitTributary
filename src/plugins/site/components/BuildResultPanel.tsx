import { ExternalLink, FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";

import { formatDuration, shortPath } from "../state";
import type { SiteBuildReport } from "../types";

export function BuildResultPanel({
  buildReport,
  onOpenIndex,
  onRevealOutput,
}: {
  buildReport: SiteBuildReport;
  onOpenIndex: () => void;
  onRevealOutput: () => void;
}) {
  return (
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
      <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
        <ResultStat label="Index" value={shortPath(buildReport.indexHtml)} />
        <ResultStat label="Warnings" value={String(buildReport.warnings.length)} />
        <ResultStat label="Broken links" value={String(buildReport.brokenLinks.length)} />
      </div>
      {(buildReport.warnings.length > 0 || buildReport.brokenLinks.length > 0) && (
        <div className="border-t px-5 py-4">
          <div className="gt-body-strong mb-2">提示</div>
          <div className="flex flex-col gap-2">
            {buildReport.warnings.slice(0, 6).map((warning) => (
              <div key={`${warning.path}-${warning.message}`} className="gt-caption rounded-md bg-muted px-3 py-2">
                {warning.path}: {warning.message}
              </div>
            ))}
            {buildReport.brokenLinks.slice(0, 6).map((link) => (
              <div key={`${link.source}-${link.target}`} className="gt-caption rounded-md bg-muted px-3 py-2">
                {link.source}: {link.target} ({link.kind})
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background p-3">
      <div className="gt-caption text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}
