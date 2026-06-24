import { Timer } from "lucide-react";

export function AutoView() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Timer className="size-8 opacity-30" />
      <p className="text-sm">自动备份</p>
      <p className="text-xs opacity-60">定时提交、文件监听与累积打标规则</p>
    </div>
  );
}
