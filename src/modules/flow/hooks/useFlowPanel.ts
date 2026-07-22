import { useCallback, useEffect, useRef, useState } from "react";

import { flowApi } from "../api";
import { DEFAULT_FLOW_FOLDER, SAMPLE_WORKFLOW } from "../constants";
import type { FlowContextMenuState, FlowFolderCreateDraft, FlowPoint, FlowTreeSelection } from "../components/flowBrowserTypes";
import { FLOW_ACTION_MENU_WIDTH, flowActionMenuHeight } from "../components/flowMenuGeometry";
import type { FlowListItem, FlowListMode, FlowRecord, FlowRunReport, FlowSection, ViewMode } from "../types";
import { normalizeFolder } from "../utils";
import { useFlowCatalogs } from "./useFlowCatalogs";

export function useFlowPanel() {
  const [section, setSection] = useState<FlowSection>("flows");
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [folders, setFolders] = useState<string[]>([DEFAULT_FLOW_FOLDER]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<FlowRecord | null>(null);
  const [mode, setMode] = useState<ViewMode>("read");
  const [isEditingYaml, setIsEditingYaml] = useState(false);
  const [listMode, setListMode] = useState<FlowListMode>("tree");
  const [fileListWidth, setFileListWidth] = useState(320);
  const [editorYaml, setEditorYaml] = useState(SAMPLE_WORKFLOW);
  const [editorFolder, setEditorFolder] = useState(DEFAULT_FLOW_FOLDER);
  const [contextMenu, setContextMenu] = useState<FlowContextMenuState>(null);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const [folderCreateDraft, setFolderCreateDraft] = useState<FlowFolderCreateDraft>(null);
  const [editorStatus, setEditorStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<FlowRunReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningFlow, setIsRunningFlow] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const flowMenuRef = useRef<HTMLDivElement | null>(null);
  const {
    events,
    nodeDefinitions,
    flowNodes,
    isEventsLoading,
    isNodeDefinitionsLoading,
    isFlowNodesLoading,
    loadEvents,
    loadNodeDefinitions,
    loadFlowNodes,
  } = useFlowCatalogs(selectedId, setLoadError);

  const canOperate = mode === "operate";
  const enabledCount = flows.filter((flow) => flow.enabled).length;

  const clearRunIfDifferent = useCallback((flowId: string | null) => {
    setLastRun((current) => {
      if (!current) return current;
      return current.flow_id === flowId ? current : null;
    });
  }, []);

  const loadFlows = useCallback(async (preferredId?: string | null) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await flowApi.list();
      const folderList = await flowApi.listFolders();
      const normalizedFolders = Array.from(new Set([
        ...folderList.map((folder) => normalizeFolder(folder)),
        ...list.map((flow) => normalizeFolder(flow.folder, flow.summary)),
      ])).sort();
      setFlows(list);
      setFolders(normalizedFolders.length > 0 ? normalizedFolders : [DEFAULT_FLOW_FOLDER]);
      const nextId = preferredId && list.some((flow) => flow.id === preferredId)
        ? preferredId
        : list[0]?.id ?? null;
      setSelectedId(nextId);
      clearRunIfDifferent(nextId);
      if (nextId) {
        setSelectedFolder(null);
      }
      if (!nextId) {
        setSelectedRecord(null);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [clearRunIfDifferent]);

  const loadRecord = useCallback(async (id: string | null) => {
    if (!id) {
      setSelectedRecord(null);
      clearRunIfDifferent(null);
      return;
    }
    try {
      const record = await flowApi.get(id);
      setSelectedRecord(record);
      clearRunIfDifferent(record?.summary.id ?? null);
      if (record && isEditingYaml) {
        setEditorYaml(record.raw_yaml);
        setEditorFolder(normalizeFolder(record.folder, record.summary));
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      setSelectedRecord(null);
    }
  }, [clearRunIfDifferent, isEditingYaml]);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  useEffect(() => {
    void loadRecord(selectedId);
  }, [loadRecord, selectedId]);

  useEffect(() => {
    if (!editorYaml.trim()) {
      setEditorStatus("idle");
      setEditorError(null);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        await flowApi.validate(editorYaml);
        if (!cancelled) {
          setEditorStatus("valid");
          setEditorError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setEditorStatus("invalid");
          setEditorError(error instanceof Error ? error.message : String(error));
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [editorYaml]);

  const startCreate = () => {
    setSelectedId(null);
    setSelectedFolder(editorFolder);
    setSelectedRecord(null);
    setLastRun(null);
    setEditorYaml(SAMPLE_WORKFLOW);
    setEditorStatus("idle");
    setEditorError(null);
    setIsEditingYaml(true);
  };

  const startCreateInFolder = (folder: string) => {
    setEditorFolder(folder);
    setSelectedId(null);
    setSelectedFolder(folder);
    setSelectedRecord(null);
    setLastRun(null);
    setEditorYaml(SAMPLE_WORKFLOW);
    setEditorStatus("idle");
    setEditorError(null);
    setIsEditingYaml(true);
  };

  const startEdit = () => {
    if (selectedRecord) {
      setEditorYaml(selectedRecord.raw_yaml);
      setEditorFolder(normalizeFolder(selectedRecord.folder, selectedRecord.summary));
    } else if (selectedFolder) {
      setEditorFolder(selectedFolder);
    }
    setEditorStatus("idle");
    setEditorError(null);
    setIsEditingYaml(true);
  };

  const startEditFlowById = async (id: string) => {
    try {
      const record = await flowApi.get(id);
      if (!record) return;
      setSelectedId(id);
      setSelectedFolder(null);
      setSelectedRecord(record);
      setLastRun(null);
      setEditorYaml(record.raw_yaml);
      setEditorFolder(normalizeFolder(record.folder, record.summary));
      setEditorStatus("idle");
      setEditorError(null);
      setIsEditingYaml(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const changeMode = (nextMode: ViewMode) => setMode(nextMode);

  const saveWorkflow = async () => {
    if (!editorYaml.trim()) {
      setEditorStatus("invalid");
      setEditorError("YAML 不能为空");
      return;
    }

    setIsSaving(true);
    try {
      const record = await flowApi.save(editorYaml, editorFolder);
      setSelectedRecord(record);
      setSelectedId(record.summary.id);
      setSelectedFolder(null);
      setLastRun(null);
      setIsEditingYaml(false);
      await loadFlows(record.summary.id);
      await loadFlowNodes(record.summary.id);
    } catch (error) {
      setEditorStatus("invalid");
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (!selectedRecord) return;
    try {
      const record = await flowApi.setEnabled(selectedRecord.summary.id, enabled);
      setSelectedRecord(record);
      await loadFlows(record.summary.id);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const runSelectedFlow = async () => {
    const id = selectedRecord?.summary.id;
    if (!id) return;
    setIsRunningFlow(true);
    setLoadError(null);
    try {
      const report = await flowApi.run(id);
      setLastRun(report);
      await loadFlows(id);
      await loadFlowNodes(id);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunningFlow(false);
    }
  };

  const deleteSelected = async () => {
    const id = selectedRecord?.summary.id;
    if (!id) return;
    try {
      await flowApi.delete(id);
      setIsEditingYaml(false);
      setLastRun(null);
      await loadFlows(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteFlowById = async (id: string) => {
    try {
      await flowApi.delete(id);
      setSelectedId(null);
      setSelectedRecord(null);
      setIsEditingYaml(false);
      setLastRun(null);
      await loadFlows(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const cancelEdit = () => {
    if (selectedRecord) {
      setEditorYaml(selectedRecord.raw_yaml);
    } else {
      setEditorYaml(SAMPLE_WORKFLOW);
    }
    setIsEditingYaml(false);
    setEditorStatus("idle");
    setEditorError(null);
  };

  const selectTreeItem = (selection: FlowTreeSelection) => {
    if (selection.type === "flow") {
      setSelectedId(selection.id);
      setSelectedFolder(null);
      setIsEditingYaml(false);
      clearRunIfDifferent(selection.id);
    } else {
      setSelectedId(null);
      setSelectedRecord(null);
      setSelectedFolder(selection.path);
      setEditorFolder(selection.path);
      setIsEditingYaml(false);
      setLastRun(null);
    }
  };

  const openContextMenu = (selection: FlowTreeSelection, point: FlowPoint) => {
    selectTreeItem(selection);
    setFolderCreateDraft(null);
    const menuHeight = flowActionMenuHeight(selection);
    setContextMenu({
      selection,
      left: Math.max(8, Math.min(point.x, window.innerWidth - FLOW_ACTION_MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(point.y, window.innerHeight - menuHeight - 8)),
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-flow-floating-actions]")) {
        return;
      }
      if (target?.closest("[data-flow-folder-create]")) {
        return;
      }
      closeContextMenu();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [contextMenu]);

  useEffect(() => {
    if (!flowMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!flowMenuRef.current?.contains(event.target as Node)) {
        setFlowMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFlowMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [flowMenuOpen]);

  const persistFolder = async (path: string) => {
    const normalizedPath = normalizeFolder(path);
    try {
      const nextFolders = await flowApi.createFolder(normalizedPath);
      setFolders(nextFolders.length > 0 ? nextFolders : [DEFAULT_FLOW_FOLDER]);
      setSelectedId(null);
      setSelectedRecord(null);
      setSelectedFolder(normalizedPath);
      setEditorFolder(normalizedPath);
      setIsEditingYaml(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const beginCreateChildFolder = (parent: string, position: { left: number; top: number }) => {
    setContextMenu(null);
    setSelectedId(null);
    setSelectedRecord(null);
    setSelectedFolder(parent);
    setEditorFolder(parent);
    setFolderCreateDraft({
      parent,
      left: position.left,
      top: position.top,
      value: "新文件夹",
    });
  };

  const commitFolderCreateDraft = async () => {
    if (!folderCreateDraft) return;
    const input = folderCreateDraft.value.trim();
    if (!input) {
      setFolderCreateDraft(null);
      return;
    }
    const path = normalizeFolder(`${folderCreateDraft.parent}/${input}`);
    setFolderCreateDraft(null);
    await persistFolder(path);
  };

  const changeSection = (nextSection: FlowSection) => {
    setSection(nextSection);
    if (nextSection === "events" || nextSection === "nodes") {
      setIsEditingYaml(false);
      setContextMenu(null);
      setFolderCreateDraft(null);
    }
  };

  const deleteFolderByPath = async (path: string) => {
    try {
      const nextFolders = await flowApi.deleteFolder(path);
      setFolders(nextFolders.length > 0 ? nextFolders : [DEFAULT_FLOW_FOLDER]);
      setSelectedFolder(null);
      await loadFlows(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshActiveSection = () => {
    if (section === "events") {
      void loadEvents();
    } else if (section === "nodes") {
      void loadNodeDefinitions();
      void loadFlowNodes(selectedId);
    } else {
      void loadFlows(selectedId);
    }
  };

  const selectFlowFromMenu = (id: string) => {
    setFlowMenuOpen(false);
    changeSection("flows");
    selectTreeItem({ type: "flow", id });
  };

  const createFlowFromMenu = () => {
    setFlowMenuOpen(false);
    changeSection("flows");
    startCreate();
  };

  return {
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
  };
}
