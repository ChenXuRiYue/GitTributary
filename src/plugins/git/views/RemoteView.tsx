import { Upload } from "lucide-react";

export function RemoteView() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      <Upload className="size-8 opacity-30" />
      <p className="text-sm">远程操作</p>
      <p className="text-xs opacity-60">推送、拉取、认证与远程仓库管理</p>
    </div>
  );
}
