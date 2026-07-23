import {
  Check,
  CheckCircle2,
  ChevronDown,
  FolderTree,
  Plus,
  Settings2,
  TriangleAlert,
} from "lucide-react";

import { DomainTrail, type DomainTrailItem } from "@/shared/components/DomainTrail";
import { IconNav } from "@/shared/components/IconNav";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/lib/utils";

import { BuildResultPanel } from "../components/BuildResultPanel";
import { CapturePanel } from "../components/CapturePanel";
import { WorkspaceConfigPanel } from "../components/WorkspaceConfigPanel";
import { isRunRecordInProgress, shortPath } from "../state";
import { isSiteViewId, siteNavItems, SITE_MORE_STATE_KEY } from "../sitePanelModel";
import { useSiteActions } from "../hooks/useSiteActions";
import { useSiteCoreState } from "../hooks/useSiteCoreState";
import { useSiteWorkspace } from "../hooks/useSiteWorkspace";

export function SitePanelView({
  core,
  workspace,
  actions,
}: {
  core: ReturnType<typeof useSiteCoreState>;
  workspace: ReturnType<typeof useSiteWorkspace>;
  actions: ReturnType<typeof useSiteActions>;
}) {
  const {
    activeViewId, workspaceGroups, activeWorkspaceGroupId, remoteConfigs,
    loadRemoteConfigs, updateWorkspaceGroup, captureViewMode, setCaptureViewMode,
    captureFilters, setCaptureFilters, scanReport, selectedPaths, setSelectedPaths,
    openCapturePaths, buildReport, publishReport, workspaceMenuOpen,
    setWorkspaceMenuOpen, message, error, workspaceMenuRef, selectSiteView,
  } = core;
  const {
    captureTree, selectedCaptureTree, captureList, rawCaptureList,
    selectedCount, selectedMarkdownCount, allCapturedSelected, documentScopeDirty,
    canBuild, activeBuildRunning, canPublish, activePublishRunning,
    activeWorkspaceGroup, activeTaskRunning, publishCandidates, workspaceLabel,
    currentWorkspaceGroupId, workspacePathLabel, saveDocumentScope,
  } = workspace;
  const {
    createWorkspaceGroup, selectWorkspaceGroup, deleteWorkspaceGroup,
    selectWorkspaceFromMenu, selectDefaults, toggleAllSelection,
    toggleCapturePathOpen, toggleCandidate, runBuild, runPublish,
    openIndex, revealOutput,
  } = actions;
  const workspacePanel = (
    <WorkspaceConfigPanel
      groups={workspaceGroups}
      activeGroupId={activeWorkspaceGroupId}
      remoteConfigs={remoteConfigs}
      publishCandidates={publishCandidates}
      onCreateGroup={createWorkspaceGroup}
      onSelectGroup={selectWorkspaceGroup}
      onUpdateGroup={updateWorkspaceGroup}
      onDeleteGroup={deleteWorkspaceGroup}
      onRefreshRemoteConfigs={loadRemoteConfigs}
    />
  );

  const capturePanel = (
    <CapturePanel
      scanReport={scanReport}
      captureTree={captureTree}
      selectedCaptureTree={selectedCaptureTree}
      captureList={captureList}
      captureViewMode={captureViewMode}
      filters={captureFilters}
      totalCount={rawCaptureList.length}
      filteredCount={captureList.length}
      selectedPaths={selectedPaths}
      openCapturePaths={openCapturePaths}
      selectedCount={selectedCount}
      selectedMarkdownCount={selectedMarkdownCount}
      allCapturedSelected={allCapturedSelected}
      dirty={documentScopeDirty}
      onSave={saveDocumentScope}
      onViewModeChange={setCaptureViewMode}
      onFiltersChange={setCaptureFilters}
      onSelectDefaults={selectDefaults}
      onToggleAll={toggleAllSelection}
      onToggleOpen={toggleCapturePathOpen}
      onToggleCandidate={toggleCandidate}
      onToggleGroup={(paths) => {
        setSelectedPaths((current) => {
          const next = new Set(current);
          const allSelected = paths.every((path) => next.has(path));
          paths.forEach((path) => {
            if (allSelected) next.delete(path);
            else next.add(path);
          });
          return next;
        });
      }}
    />
  );

  const resultPanel = (
    <BuildResultPanel
      task={activeWorkspaceGroup}
      hasSourceRepo={Boolean(activeWorkspaceGroup?.sourceRepoPath.trim())}
      hasDocumentScope={selectedCount > 0}
      canBuild={canBuild}
      isBuilding={activeBuildRunning}
      canPublish={canPublish}
      isPublishing={activePublishRunning}
      buildReport={buildReport}
      publishReport={publishReport}
      onBuild={runBuild}
      onPublish={runPublish}
      onOpenIndex={openIndex}
      onRevealOutput={revealOutput}
      onEditTask={() => selectSiteView("workspace")}
      onEditScope={() => selectSiteView("capture")}
    />
  );

  const activePanel = (() => {
    switch (activeViewId) {
      case "workspace": return workspacePanel;
      case "capture": return capturePanel;
      case "result": return resultPanel;
      default: return workspacePanel;
    }
  })();

  const useFullCanvas = activeViewId === "workspace" || activeViewId === "capture" || activeViewId === "result";
  const activeDomainView = siteNavItems.find((item) => item.id === activeViewId) ?? siteNavItems[0];
  const domainTrailItems: DomainTrailItem[] = [
    { id: "site", label: "发布" },
    {
      id: activeDomainView.id,
      label: activeDomainView.name,
    },
  ];
  const configuredWorkspaceCount = workspaceGroups.filter((group) => (
    Boolean(group.sourceRepoPath.trim()) && Boolean(group.target)
  )).length;
  const primaryDomainStats = `任务:${workspaceGroups.length} 已配:${configuredWorkspaceCount}`;
  const secondaryDomainStats = (() => {
    switch (activeViewId) {
      case "workspace":
        return `已配:${configuredWorkspaceCount}/${workspaceGroups.length}`;
      case "capture":
        return `候选:${rawCaptureList.length} 已选:${selectedCount} md:${selectedMarkdownCount}`;
      case "result":
        if (activeTaskRunning) {
          const runningCount = activeWorkspaceGroup?.runHistory.filter(isRunRecordInProgress).length ?? 0;
          return `运行中:${runningCount} 记录:${activeWorkspaceGroup?.runHistory.length ?? 0}`;
        }
        if (publishReport) return `页面:${publishReport.build.pageCount} 变更:${publishReport.changedCount}`;
        if (buildReport) return `页面:${buildReport.pageCount} 资源:${buildReport.assetCount}`;
        return `记录:${activeWorkspaceGroup?.runHistory.length ?? 0}`;
      default:
        return "-";
    }
  })();
  const headerStats = [secondaryDomainStats, primaryDomainStats];

  const statusBanner = (message || error) ? (
    <div className={cn(
      "flex items-start gap-3 border-b px-5 py-3",
      error ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-primary/15 bg-primary/5",
    )}>
      {error ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" />}
      <div className="na-body">{error || message}</div>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border flex shrink-0 items-center gap-4 border-b px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DomainTrail items={domainTrailItems} />
          <span className="shrink-0 text-muted-foreground/60 na-body">/</span>
          <div ref={workspaceMenuRef} className="relative min-w-0 shrink">
            <button
              type="button"
              className="flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded px-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label={`切换发布任务: ${workspaceLabel}`}
              aria-haspopup="menu"
              aria-expanded={workspaceMenuOpen}
              onClick={() => setWorkspaceMenuOpen((open) => !open)}
              title={workspaceLabel}
            >
              <span className="min-w-0 truncate na-body">{workspaceLabel}</span>
              <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", workspaceMenuOpen && "rotate-180")} />
            </button>

            {workspaceMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg sm:w-80"
              >
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                  <div className="min-w-0">
                    <div className="na-body-strong truncate">{workspaceLabel}</div>
                    <div className="na-caption truncate text-muted-foreground">
                      {workspacePathLabel ? shortPath(workspacePathLabel) : "未绑定源仓库"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      selectSiteView("workspace");
                    }}
                  >
                    <Settings2 className="size-3.5" />
                    设置
                  </Button>
                </div>

                <div className="max-h-72 overflow-y-auto p-1">
                  {workspaceGroups.length === 0 ? (
                    <div className="px-3 py-6 text-center">
                      <Settings2 className="mx-auto size-6 text-muted-foreground" />
                      <div className="na-body-strong mt-2">暂无发布任务</div>
                      <p className="na-caption mt-1 text-muted-foreground">先新建一个发布任务。</p>
                    </div>
                  ) : (
                    workspaceGroups.map((group) => {
                      const isCurrent = group.id === currentWorkspaceGroupId;
                      const sourcePath = group.sourceRepoPath.trim();
                      return (
                        <button
                          key={group.id}
                          type="button"
                          role="menuitem"
                          className={cn(
                            "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                            isCurrent ? "bg-primary/8 text-foreground" : "hover:bg-accent hover:text-accent-foreground",
                          )}
                          onClick={() => selectWorkspaceFromMenu(group)}
                        >
                          <span className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md border",
                            isCurrent ? "border-primary/30 bg-primary/10 text-primary" : "bg-background text-muted-foreground",
                          )}>
                            {isCurrent ? <Check className="size-3.5" /> : <FolderTree className="size-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="na-body-strong block truncate">{group.name || "未命名任务"}</span>
                            <span className="na-caption block truncate text-muted-foreground">
                              {sourcePath ? shortPath(sourcePath) : "未绑定源仓库"}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-2 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      createWorkspaceGroup(true);
                      selectSiteView("workspace");
                    }}
                  >
                    <Plus className="size-3.5" />
                    新建任务
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={activeViewId === "workspace" ? "secondary" : "outline"}
                    className="h-8 px-2"
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      selectSiteView("workspace");
                    }}
                  >
                    <Settings2 className="size-3.5" />
                    任务设置
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 text-right md:flex">
          {headerStats.map((stat, index) => (
            <div key={`${index}.${stat}`} className="flex items-center gap-2">
              {index > 0 && <span className="text-muted-foreground/40 na-caption">/</span>}
              <span className="text-foreground na-caption font-medium">{stat}</span>
            </div>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
          <IconNav
            items={siteNavItems}
            activeId={activeViewId}
            onSelect={(id) => {
              if (isSiteViewId(id)) selectSiteView(id);
            }}
            size="sm"
            moreStateKey={SITE_MORE_STATE_KEY}
          />
        </div>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {useFullCanvas ? (
            <>
              {statusBanner}
              <div className="min-h-0 flex-1 overflow-hidden">
                {activePanel}
              </div>
            </>
          ) : (
            <ScrollArea className="w-full flex-1">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-7 py-6">
                {statusBanner}
                {activePanel}
              </div>
            </ScrollArea>
          )}
        </main>
      </div>
    </div>
  );
}
