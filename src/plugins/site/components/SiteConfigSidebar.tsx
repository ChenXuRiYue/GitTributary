import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

import { shortPath } from "../state";

export function SiteConfigSidebar({
  repoPath,
  siteTitle,
  outputDir,
  withSearch,
  copyAssets,
  recentRepos,
  onRepoPathChange,
  onSiteTitleChange,
  onOutputDirChange,
  onWithSearchChange,
  onCopyAssetsChange,
  onChooseRepo,
  onChooseOutput,
  onSelectRecentRepo,
}: {
  repoPath: string;
  siteTitle: string;
  outputDir: string;
  withSearch: boolean;
  copyAssets: boolean;
  recentRepos: string[];
  onRepoPathChange: (value: string) => void;
  onSiteTitleChange: (value: string) => void;
  onOutputDirChange: (value: string) => void;
  onWithSearchChange: (value: boolean) => void;
  onCopyAssetsChange: (value: boolean) => void;
  onChooseRepo: () => void;
  onChooseOutput: () => void;
  onSelectRecentRepo: (path: string) => void;
}) {
  return (
    <aside className="border-border flex min-h-0 flex-col border-r bg-sidebar/30">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 p-5">
          <section className="space-y-3">
            <div>
              <div className="gt-body-strong">仓库</div>
              <p className="gt-caption text-muted-foreground">选择要捕捉文档的本地仓库。</p>
            </div>
            <div className="flex gap-2">
              <Input value={repoPath} onChange={(event) => onRepoPathChange(event.target.value)} placeholder="仓库路径" />
              <Button variant="outline" size="icon" onClick={onChooseRepo} title="选择仓库">
                <FolderOpen />
              </Button>
            </div>
            {recentRepos.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {recentRepos.slice(0, 4).map((path) => (
                  <button
                    type="button"
                    key={path}
                    onClick={() => onSelectRecentRepo(path)}
                    className="rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {shortPath(path)}
                  </button>
                ))}
              </div>
            )}
          </section>

          <Separator />

          <section className="space-y-3">
            <div>
              <div className="gt-body-strong">输出</div>
              <p className="gt-caption text-muted-foreground">默认写入仓库内 `.gittributary/site`。</p>
            </div>
            <Input value={siteTitle} onChange={(event) => onSiteTitleChange(event.target.value)} placeholder="站点标题" />
            <div className="flex gap-2">
              <Input value={outputDir} onChange={(event) => onOutputDirChange(event.target.value)} placeholder="输出目录" />
              <Button variant="outline" size="icon" onClick={onChooseOutput} title="选择输出目录">
                <FolderOpen />
              </Button>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="gt-body-strong">构建选项</div>
            <div className="rounded-md border bg-background px-3 py-2">
              <div className="text-sm">阅读主题</div>
              <p className="gt-caption mt-1 text-muted-foreground">生成后在网页右上角切换亮色/暗色。</p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
              <span className="text-sm">生成搜索索引</span>
              <Switch checked={withSearch} onCheckedChange={onWithSearchChange} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
              <span className="text-sm">复制图片与资源</span>
              <Switch checked={copyAssets} onCheckedChange={onCopyAssetsChange} />
            </label>
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
