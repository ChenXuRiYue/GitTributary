import { cn } from "@/shared/lib/utils";
import type { ConfigRepoCheckReport } from "../types";

export function ConfigRepoCheckMessage({ report }: { report: ConfigRepoCheckReport }) {
  return (
    <div className={cn(
      "rounded-md border px-2 py-1.5 text-[11px]",
      report.ok
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-destructive/30 bg-destructive/10 text-destructive",
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{report.ok ? "连接成功" : "连接失败"}</span>
        {report.default_branch && <span>默认分支 {report.default_branch}</span>}
        {report.ok && <span>{report.refs_count} refs</span>}
      </div>
      <div className="mt-0.5 text-muted-foreground">{report.message}</div>
    </div>
  );
}
