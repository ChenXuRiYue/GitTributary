import { AlertTriangle, ArrowLeft, GitBranch, Images } from "lucide-react";

import { Button } from "@/shared/ui/button";

import type { AttachmentScanReport, GitHubImageLibrary } from "../../types";
import { ImageMigrationList } from "./ImageMigrationList";
import { ImageMigrationResult } from "./ImageMigrationResult";
import { useGitHubImageMigration } from "./useGitHubImageMigration";

export function ImageMigrationPage({
  library,
  report,
  onBack,
  onCompleted,
}: {
  library: GitHubImageLibrary;
  report: AttachmentScanReport | null;
  onBack: () => void;
  onCompleted: () => Promise<void>;
}) {
  const migration = useGitHubImageMigration(report, library, onCompleted);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-4">
      <div className="border-border/50 flex min-h-12 items-center gap-2 border-b pb-3">
        <Button variant="ghost" size="icon" onClick={onBack} title="返回图库">
          <ArrowLeft />
        </Button>
        <Images className="size-4" />
        <div className="min-w-0">
          <h2 className="gt-title-panel">图片迁移 · {library.name}</h2>
          <div className="text-muted-foreground gt-caption flex min-w-0 items-center gap-2">
            <GitBranch className="size-3" />
            <span className="truncate">{library.remote?.url}</span>
            <span>{library.branch}</span>
            <span>{library.directory ? `/${library.directory}` : "仓库根目录"}</span>
          </div>
        </div>
      </div>
      <ImageMigrationList
        candidates={migration.candidates}
        selectedPaths={migration.selectedPaths}
        selectedCount={migration.selectedCount}
        selectedNotes={migration.selectedNotes}
        selectedBytes={migration.selectedBytes}
        migrating={migration.migrating}
        onSelectAll={migration.selectAll}
        onToggle={migration.togglePath}
        onMigrate={() => void migration.migrate()}
      />
      {migration.error && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive gt-body flex items-start gap-2 border px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="break-all">{migration.error}</span>
        </div>
      )}
      {migration.result && (
        <ImageMigrationResult
          result={migration.result}
          retrying={migration.migrating}
          onRetry={() => void migration.retryFailures()}
        />
      )}
    </div>
  );
}
