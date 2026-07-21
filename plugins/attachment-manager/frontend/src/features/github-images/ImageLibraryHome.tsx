import { ArrowRight, Folder, GitBranch, Images, Plus, Settings2 } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type { GitHubImageLibrary } from "../../types";

export function ImageLibraryHome({
  libraries,
  loading,
  isBindingAvailable,
  onAdd,
  onManage,
  onMigrate,
}: {
  libraries: GitHubImageLibrary[];
  loading: boolean;
  isBindingAvailable: (library: GitHubImageLibrary) => boolean;
  onAdd: () => void;
  onManage: (library: GitHubImageLibrary) => void;
  onMigrate: (library: GitHubImageLibrary) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="border-border/50 flex min-h-12 items-center gap-3 border-b px-1 pb-3">
        <Images className="size-4" />
        <div>
          <h2 className="gt-title-panel">图库</h2>
          <div className="text-muted-foreground gt-caption">{libraries.length} 个 Git 远程绑定</div>
        </div>
        <Button className="ml-auto" size="sm" onClick={onAdd} disabled={loading}>
          <Plus />
          添加图库
        </Button>
      </div>

      {libraries.length === 0 ? (
        <div className="text-muted-foreground flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <Images className="size-7" />
          <span className="gt-body">尚未配置图库</span>
          <Button variant="outline" size="sm" onClick={onAdd} disabled={loading}>
            <Plus />
            添加图库
          </Button>
        </div>
      ) : (
        <div className="divide-border/50 divide-y">
          {libraries.map((library) => {
            const available = isBindingAvailable(library);
            return (
              <div key={library.id} className="hover:bg-accent/20 flex min-h-20 items-center gap-3 px-2 py-3 transition-colors">
                <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
                  <Images className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="gt-body-strong truncate">{library.name}</span>
                    <Badge variant={available ? "secondary" : "outline"} className="h-5 px-1.5 gt-caption">
                      {available ? "已绑定" : "待绑定"}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground gt-caption mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex min-w-0 items-center gap-1">
                      <GitBranch className="size-3" />
                      <span className="truncate">{library.remote?.url ?? library.suggestedRemoteUrl ?? "未选择 Git 远程"}</span>
                    </span>
                    <span>{library.branch}</span>
                    <span className="flex items-center gap-1"><Folder className="size-3" />{library.directory || "仓库根目录"}</span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onManage(library)} title="管理图库仓库">
                  <Settings2 />
                </Button>
                <Button size="sm" onClick={() => onMigrate(library)} disabled={!available}>
                  迁移图片
                  <ArrowRight />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
