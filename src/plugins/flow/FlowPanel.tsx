import { FolderTree, Plus, RefreshCcw } from "lucide-react";

import { IconNav } from "@/components/IconNav";
import { ResizeHandle } from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FlowFileBrowser } from "./components/FlowFileBrowser";
import { FlowFloatingActions, FlowFolderCreateInput } from "./components/FlowContextMenu";
import { FlowHeader } from "./components/FlowHeader";
import { EmptyState, ModeToggle } from "./components/shared";
import { useFlowPanel } from "./hooks/useFlowPanel";
import { flowNavItems } from "./registry";
import type { FlowSection } from "./types";
import { EventCatalogView } from "./views/EventCatalogView";
import { NodeCatalogView } from "./views/NodeCatalogView";
import { SummaryView } from "./views/SummaryView";
import { YamlEditor } from "./views/YamlEditor";

export function FlowPanel() {
  const {
    section,
    flows,
    events,
    nodeDefinitions,
    flowNodes,
    folders,
    selectedId,
    selectedFolder,
    selectedRecord,
    mode,
    isEditingYaml,
    listMode,
    setListMode,
    fileListWidth,
    setFileListWidth,
    editorYaml,
    setEditorYaml,
    editorFolder,
    setEditorFolder,
    contextMenu,
    flowMenuOpen,
    setFlowMenuOpen,
    folderCreateDraft,
    setFolderCreateDraft,
    editorStatus,
    editorError,
    lastRun,
    isLoading,
    isEventsLoading,
    isNodeDefinitionsLoading,
    isFlowNodesLoading,
    isSaving,
    isRunningFlow,
    loadError,
    flowMenuRef,
    canOperate,
    enabledCount,
    startCreate,
    startCreateInFolder,
    startEdit,
    startEditFlowById,
    changeMode,
    saveWorkflow,
    toggleEnabled,
    runSelectedFlow,
    deleteSelected,
    deleteFlowById,
    cancelEdit,
    selectTreeItem,
    openContextMenu,
    closeContextMenu,
    beginCreateChildFolder,
    commitFolderCreateDraft,
    changeSection,
    deleteFolderByPath,
    refreshActiveSection,
    selectFlowFromMenu,
    createFlowFromMenu,
  } = useFlowPanel();

  const toolbarSummary = (() => {
    if (section === "events") return `事件:${events.length}`;
    if (section === "nodes") return `动作:${nodeDefinitions.length} 当前节点:${flowNodes.length}`;
    return `模式:${canOperate ? "操作" : "预览"} Flow:${flows.length}`;
  })();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <FlowHeader
        section={section}
        flows={flows}
        selectedId={selectedId}
        selectedFolder={selectedFolder}
        selectedRecord={selectedRecord}
        isEditingYaml={isEditingYaml}
        eventCount={events.length}
        nodeDefinitionCount={nodeDefinitions.length}
        flowNodeCount={flowNodes.length}
        folderCount={folders.length}
        enabledCount={enabledCount}
        menuOpen={flowMenuOpen}
        menuRef={flowMenuRef}
        setMenuOpen={setFlowMenuOpen}
        onChangeSection={changeSection}
        onSelectFlow={selectFlowFromMenu}
        onCreateFlow={createFlowFromMenu}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-border/50 py-2">
          <IconNav
            items={flowNavItems}
            activeId={section}
            onSelect={(id) => changeSection(id as FlowSection)}
            size="sm"
            moreStateKey="flow.nav.more.open"
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
            <span className="min-w-0 truncate gt-caption text-muted-foreground">{toolbarSummary}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 px-0"
                onClick={refreshActiveSection}
                title="刷新"
              >
                <RefreshCcw className="size-3.5" />
              </Button>
              {section === "flows" && <ModeToggle mode={mode} onChange={changeMode} />}
            </div>
          </div>

        {loadError && (
          <div className="shrink-0 border-b bg-red-50 px-4 py-2 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {section === "events" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <EventCatalogView events={events} isLoading={isEventsLoading} />
          </div>
        ) : section === "nodes" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <NodeCatalogView
              definitions={nodeDefinitions}
              nodes={flowNodes}
              selectedFlow={selectedRecord}
              isLoading={isNodeDefinitionsLoading || isFlowNodesLoading}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <aside
              className="flex min-h-0 shrink-0 flex-col border-r"
              style={{ width: `${fileListWidth}px` }}
            >
              <FlowFileBrowser
                flows={flows}
                folders={folders}
                selectedId={selectedId}
                selectedFolder={selectedFolder}
                onSelect={selectTreeItem}
                onContextMenu={openContextMenu}
                canOperate={canOperate}
                listMode={listMode}
                onListModeChange={setListMode}
              />
            </aside>

            <ResizeHandle
              direction="horizontal"
              size={fileListWidth}
              onResize={setFileListWidth}
              minSize={240}
              snapTo={320}
            />

            <div className="min-h-0 flex-1 overflow-hidden">
              {isEditingYaml ? (
                <YamlEditor
                  yaml={editorYaml}
                  folder={editorFolder}
                  folders={folders}
                  status={editorStatus}
                  error={editorError}
                  isSaving={isSaving}
                  onChange={setEditorYaml}
                  onFolderChange={setEditorFolder}
                  onSave={saveWorkflow}
                  onCancel={cancelEdit}
                  onDelete={selectedRecord ? deleteSelected : undefined}
                />
              ) : isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载 Flow...</div>
              ) : selectedRecord ? (
                <ScrollArea className="h-full" orientation="both">
                  <SummaryView
                    record={selectedRecord}
                    canOperate={canOperate}
                    isRunning={isRunningFlow}
                    lastRun={lastRun}
                    onEdit={startEdit}
                    onRun={runSelectedFlow}
                    onToggle={toggleEnabled}
                  />
                </ScrollArea>
              ) : selectedFolder ? (
                <div className="flex h-full min-h-[420px] items-center justify-center p-6">
                  <div className="w-full max-w-md rounded-md border bg-background p-5 text-center">
                    <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-muted">
                      <FolderTree className="size-5 text-muted-foreground" />
                    </div>
                    <h3 className="gt-title-panel mt-3">{selectedFolder}</h3>
                    {canOperate && (
                      <>
                        <p className="gt-body mt-2 text-muted-foreground">选中文件夹后添加 Flow,会直接保存到这个目录。</p>
                        <Button className="mt-4" size="sm" onClick={startCreate}>
                          <Plus className="size-3.5" />
                          添加 Flow
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState canOperate={canOperate} onCreate={startCreate} />
              )}
            </div>
          </div>
        )}

        {section === "flows" && canOperate && contextMenu && (
          <FlowFloatingActions
            menu={contextMenu}
            onBeginCreateChildFolder={beginCreateChildFolder}
            onCreateFlow={(folder) => {
              closeContextMenu();
              startCreateInFolder(folder);
            }}
            onDeleteFolder={(folder) => {
              closeContextMenu();
              void deleteFolderByPath(folder);
            }}
            onEditFlow={(id) => {
              closeContextMenu();
              void startEditFlowById(id);
            }}
            onDeleteFlow={(id) => {
              closeContextMenu();
              void deleteFlowById(id);
            }}
          />
        )}
        {section === "flows" && canOperate && folderCreateDraft && (
          <FlowFolderCreateInput
            draft={folderCreateDraft}
            onChange={(value) => setFolderCreateDraft((draft) => draft ? { ...draft, value } : draft)}
            onCommit={() => {
              void commitFolderCreateDraft();
            }}
            onCancel={() => setFolderCreateDraft(null)}
          />
        )}
      </div>
    </div>
    </div>
  );
}
