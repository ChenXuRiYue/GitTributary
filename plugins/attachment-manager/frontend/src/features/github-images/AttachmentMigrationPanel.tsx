import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CloudUpload, Images, LoaderCircle, Settings2 } from "lucide-react";

import { Button } from "@/shared/ui/button";

import type { AttachmentScanReport, ImageMigrationLibrarySnapshot } from "../../types";
import { repositoryLabel } from "../../lib/attachment";
import { ImageMigrationPage } from "./ImageMigrationPage";
import { defaultMigrationSettings } from "./migration-workspace";
import { MigrationSettingsPanel } from "./MigrationSettingsPanel";
import { MigrationTaskRail } from "./MigrationTaskRail";
import { useImageLibraries } from "./useImageLibraries";
import type { MigrationWorkspaceController } from "./useMigrationWorkspace";

export function AttachmentMigrationPanel({
  report,
  workspace,
  selectedTaskId,
  onSelectedTaskIdChange,
  selectedPaths,
  onSelectedPathsChange,
  query,
  onQueryChange,
  expandedFiles,
  onExpandedFilesChange,
  onOpenSettings,
}: {
  report: AttachmentScanReport | null;
  workspace: MigrationWorkspaceController;
  selectedTaskId?: string | null;
  onSelectedTaskIdChange?: (id: string | null) => void;
  selectedPaths?: Set<string> | null;
  onSelectedPathsChange?: (paths: Set<string>) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
  expandedFiles?: Set<string>;
  onExpandedFilesChange?: (paths: Set<string>) => void;
  onOpenSettings: () => void;
}) {
  const manager = useImageLibraries();
  const [editingSettings, setEditingSettings] = useState(false);
  const [localSelectedTaskId, setLocalSelectedTaskId] = useState<string | null>(null);
  const focusedTaskId = selectedTaskId === undefined ? localSelectedTaskId : selectedTaskId;
  const changeFocusedTask = useCallback((id: string | null) => {
    if (selectedTaskId === undefined) setLocalSelectedTaskId(id);
    onSelectedTaskIdChange?.(id);
  }, [onSelectedTaskIdChange, selectedTaskId]);
  const availableLibraries = useMemo(
    () => manager.libraries.filter((library) => manager.isBindingAvailable(library.remote)),
    [manager.eligibleRemotes, manager.libraries],
  );
  const repoPath = report?.repoPath ?? "";
  const storedSettings = workspace.drafts[repoPath];
  const settings = useMemo(() => {
    const targetExists = availableLibraries.some(
      (library) => library.id === storedSettings?.targetLibraryId,
    );
    return targetExists
      ? storedSettings
      : defaultMigrationSettings(availableLibraries[0]?.id ?? "");
  }, [availableLibraries, storedSettings]);
  const selectedLibrary = availableLibraries.find(
    (library) => library.id === settings.targetLibraryId,
  ) ?? null;
  const running = workspace.history.some(
    (task) => task.repoPath === repoPath && task.status === "running",
  );

  const startMigration = async (imagePaths: string[], noteCount: number) => {
    if (!report || !selectedLibrary?.remote) throw new Error("请选择可用的目标图库");
    const library: ImageMigrationLibrarySnapshot = {
      id: selectedLibrary.id,
      name: selectedLibrary.name,
      config: {
        remote: selectedLibrary.remote,
        branch: selectedLibrary.branch,
        directory: selectedLibrary.directory,
      },
    };
    workspace.updateDraft(report.repoPath, settings);
    await workspace.startMigration({
      repoPath: report.repoPath,
      library,
      settings,
      imagePaths,
      noteCount,
    });
  };

  if (manager.loading || workspace.loading) {
    return (
      <div className="text-muted-foreground flex min-h-48 items-center justify-center gap-2">
        <LoaderCircle className="size-4 animate-spin" />
        <span className="gt-body">正在读取迁移工作区</span>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col">
      <div className="border-border/50 flex min-h-10 shrink-0 items-center gap-2 border-b px-1">
        <CloudUpload className="size-4" />
        <h2 className="gt-title-panel shrink-0">附件迁移</h2>
        <span className="text-muted-foreground/50 gt-caption">/</span>
        <span className="text-muted-foreground gt-caption shrink-0">操作库</span>
        <span className="gt-body-strong min-w-0 truncate" title={repoPath}>{repositoryLabel(repoPath)}</span>
      </div>

      {(manager.error || workspace.error) && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive gt-body mt-2 flex shrink-0 items-start gap-2 border px-3 py-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="break-all">{manager.error ?? workspace.error}</span>
        </div>
      )}

      <div className="border-border/50 mt-2 grid h-[520px] min-h-[440px] min-w-0 max-h-[calc(100vh-160px)] overflow-hidden border-t md:grid-cols-[minmax(0,1fr)_272px]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {selectedLibrary ? (
            <>
              <MigrationSettingsPanel
                settings={settings}
                libraries={availableLibraries}
                onChange={(next) => workspace.updateDraft(repoPath, next)}
                onEditingChange={setEditingSettings}
                onOpenGallerySettings={onOpenSettings}
              />
              <div className="min-h-0 flex-1 px-2 pt-2">
                <ImageMigrationPage
                  report={report}
                  settings={settings}
                  running={running}
                  disabled={editingSettings}
                  initialSelectedPaths={selectedPaths === undefined ? null : selectedPaths}
                  onSelectedPathsChange={onSelectedPathsChange}
                  query={query}
                  onQueryChange={onQueryChange}
                  expandedFiles={expandedFiles}
                  onExpandedFilesChange={onExpandedFilesChange}
                  onScopeChange={(fileScope) => workspace.updateDraft(repoPath, {
                    ...settings,
                    fileScope,
                  })}
                  onStart={startMigration}
                />
              </div>
            </>
          ) : (
            <div className="text-muted-foreground flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center">
              <Images className="size-7" />
              <span className="gt-body">尚未配置可用图库</span>
              <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={onOpenSettings}>
                <Settings2 />
                配置图库
              </Button>
            </div>
          )}
        </div>
        <MigrationTaskRail
          repoPath={repoPath}
          history={workspace.history}
          selectedId={focusedTaskId}
          onSelectedIdChange={changeFocusedTask}
        />
      </div>
    </div>
  );
}
