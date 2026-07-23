import { AlertTriangle } from "lucide-react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import type {
  AttachmentScanReport,
  ImageMigrationFileScope,
  ImageMigrationSettings,
} from "../../types";
import { defaultMigrationFileScope } from "./migration-file-scope";
import { ImageMigrationList } from "./ImageMigrationList";
import { useGitHubImageMigration } from "./useGitHubImageMigration";

const DEFAULT_FILE_SCOPE = defaultMigrationFileScope();

export function ImageMigrationPage({
  report,
  settings,
  running,
  disabled,
  initialSelectedPaths,
  onSelectedPathsChange,
  query,
  onQueryChange,
  expandedFiles,
  onExpandedFilesChange,
  onScopeChange,
  onStart,
}: {
  report: AttachmentScanReport | null;
  settings: ImageMigrationSettings;
  running: boolean;
  disabled?: boolean;
  initialSelectedPaths?: Set<string> | null;
  onSelectedPathsChange?: (paths: Set<string>) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
  expandedFiles?: Set<string>;
  onExpandedFilesChange?: (paths: Set<string>) => void;
  onScopeChange: (scope: ImageMigrationFileScope) => void;
  onStart: (paths: string[], noteCount: number) => Promise<void>;
}) {
  const migration = useGitHubImageMigration(report, initialSelectedPaths, onSelectedPathsChange);
  const confirmMigration = () => {
    const pending = migration.confirmMigration();
    if (!pending) return;
    void onStart(pending.paths, pending.noteCount).catch((reason) => {
      migration.setError(reason instanceof Error ? reason.message : String(reason));
    });
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ImageMigrationList
        repoPath={report?.repoPath ?? ""}
        candidates={migration.candidates}
        selectedPaths={migration.selectedPaths}
        selectedNotes={migration.selectedNotes}
        selectedBytes={migration.selectedBytes}
        scope={settings.fileScope ?? DEFAULT_FILE_SCOPE}
        migrating={running}
        disabled={disabled}
        query={query}
        onQueryChange={onQueryChange}
        expandedFiles={expandedFiles}
        onExpandedFilesChange={onExpandedFilesChange}
        onScopeChange={onScopeChange}
        onSelectPaths={migration.selectPaths}
        onReplaceSelection={migration.replaceSelection}
        onMigrate={() => void migration.migrate()}
      />
      {migration.error && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive na-body flex shrink-0 items-start gap-2 border px-3 py-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="break-all">{migration.error}</span>
        </div>
      )}
      <ConfirmDialog
        open={migration.confirmation !== null}
        title="确认附件迁移"
        description={migration.confirmation
          ? settings.localFilePolicy === "delete_after_success"
            ? `将上传 ${migration.confirmation.imageCount} 张图片，并修改 ${migration.confirmation.noteCount} 篇 Markdown。迁移成功且引用替换完成后，将删除对应的本地图片。`
            : `将上传 ${migration.confirmation.imageCount} 张图片，并修改 ${migration.confirmation.noteCount} 篇 Markdown。原图片会保留。`
          : ""}
        confirmLabel="确认迁移"
        busy={running}
        onCancel={migration.cancelMigration}
        onConfirm={confirmMigration}
      />
    </div>
  );
}
