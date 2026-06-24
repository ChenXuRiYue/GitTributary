import { History } from "lucide-react";

export function HistoryView() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <History className="size-8 opacity-30" />
      <p className="text-sm">提交历史</p>
      <p className="text-xs opacity-60">时间线、文件级历史与统计</p>
    </div>
  );
}
