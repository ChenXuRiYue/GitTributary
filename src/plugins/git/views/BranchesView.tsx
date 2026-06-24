import { GitBranch } from "lucide-react";

export function BranchesView() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <GitBranch className="size-8 opacity-30" />
      <p className="text-sm">分支管理</p>
      <p className="text-xs opacity-60">创建、切换、合并、删除分支</p>
    </div>
  );
}
