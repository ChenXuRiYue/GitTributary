import { Shield } from "lucide-react";

export function SafetyView() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Shield className="size-8 opacity-30" />
      <p className="text-sm">安全与恢复</p>
      <p className="text-xs opacity-60">Stash 管理、工作区快照与脱敏检查</p>
    </div>
  );
}
