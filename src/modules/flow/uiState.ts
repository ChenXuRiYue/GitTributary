import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createJsonStore } from "@/shared/lib/store";
import type { FlowListItem, FlowListMode, FlowRecord, FlowSection, ViewMode } from "./types";

export type StoredFlowSelection = { type: "flow"; id: string } | { type: "folder"; path: string } | null;

export interface FlowUiState {
  version: 1;
  section: FlowSection;
  selection: StoredFlowSelection;
  mode: ViewMode;
  listMode: FlowListMode;
  fileListWidth: number;
  editor: { flowId: string | null; folder: string; yaml: string } | null;
  updatedAt: number;
}

export const flowUiStore = createJsonStore("ui-state");
export const FLOW_UI_STATE_KEY = "flow.workspace.v1";
export const FLOW_EVENT_UI_STATE_KEY = "flow.events.v1";
export const FLOW_NODE_UI_STATE_KEY = "flow.nodes.v1";

export interface FlowEventUiState {
  version: 1;
  query: string; domainFilter: string; stabilityFilter: string;
  filterabilityFilter: "all" | "filterable" | "plain";
  selectedType: string | null; updatedAt: number;
}

export interface FlowNodeUiState {
  version: 1;
  query: string; typeFilter: string;
  sourceFilter: "all" | "core" | "plugin";
  usageFilter: "all" | "used" | "unused";
  schemaFilter: "all" | "input" | "output" | "plain";
  selectedUses: string | null; updatedAt: number;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseFlowEventUiState(value: unknown): FlowEventUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<FlowEventUiState>;
  if (state.version !== 1) return null;
  if (typeof state.query !== "string" || typeof state.domainFilter !== "string") return null;
  if (typeof state.stabilityFilter !== "string" || !isNullableString(state.selectedType)) return null;
  if (state.filterabilityFilter !== "all"
    && state.filterabilityFilter !== "filterable"
    && state.filterabilityFilter !== "plain") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return state as FlowEventUiState;
}

export function parseFlowNodeUiState(value: unknown): FlowNodeUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<FlowNodeUiState>;
  if (state.version !== 1) return null;
  if (typeof state.query !== "string" || typeof state.typeFilter !== "string") return null;
  if (state.sourceFilter !== "all" && state.sourceFilter !== "core" && state.sourceFilter !== "plugin") return null;
  if (state.usageFilter !== "all" && state.usageFilter !== "used" && state.usageFilter !== "unused") return null;
  if (state.schemaFilter !== "all" && state.schemaFilter !== "input"
    && state.schemaFilter !== "output" && state.schemaFilter !== "plain") return null;
  if (!isNullableString(state.selectedUses)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return state as FlowNodeUiState;
}

export function parseFlowUiState(value: unknown): FlowUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<FlowUiState>;
  if (state.version !== 1) return null;
  if (state.section !== "flows" && state.section !== "events" && state.section !== "nodes") return null;
  if (state.mode !== "read" && state.mode !== "operate") return null;
  if (state.listMode !== "tree" && state.listMode !== "list") return null;
  if (typeof state.fileListWidth !== "number" || !Number.isFinite(state.fileListWidth)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  if (state.selection !== null) {
    if (!state.selection || typeof state.selection !== "object") return null;
    if (state.selection.type === "flow") {
      if (typeof state.selection.id !== "string" || !state.selection.id) return null;
    } else if (state.selection.type === "folder") {
      if (typeof state.selection.path !== "string" || !state.selection.path) return null;
    } else {
      return null;
    }
  }
  if (state.editor !== null) {
    if (!state.editor || typeof state.editor !== "object") return null;
    if (state.editor.flowId !== null && typeof state.editor.flowId !== "string") return null;
    if (typeof state.editor.folder !== "string" || typeof state.editor.yaml !== "string") return null;
  }
  return state as FlowUiState;
}

type Setter<T> = Dispatch<SetStateAction<T>>;

export function useFlowUiState(options: {
  state: Omit<FlowUiState, "version" | "selection" | "editor" | "updatedAt"> & {
    selectedId: string | null; selectedFolder: string | null; isEditingYaml: boolean;
    editorFolder: string; editorYaml: string;
  };
  setters: {
    section: Setter<FlowSection>; mode: Setter<ViewMode>; listMode: Setter<FlowListMode>;
    fileListWidth: Setter<number>; selectedId: Setter<string | null>; selectedFolder: Setter<string | null>;
    selectedRecord: Setter<FlowRecord | null>; editorFolder: Setter<string>; editorYaml: Setter<string>;
    isEditingYaml: Setter<boolean>;
  };
  loadFlows: (preferredId?: string | null) => Promise<{ list: FlowListItem[]; folders: string[] }>;
}) {
  const { state, setters, loadFlows } = options;
  const [hydrated, setHydrated] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    void flowUiStore.get<unknown>(FLOW_UI_STATE_KEY).then(async (raw) => {
      if (generationRef.current !== generation) return;
      const cached = parseFlowUiState(raw);
      if (cached) {
        setters.section(cached.section); setters.mode(cached.mode); setters.listMode(cached.listMode);
        setters.fileListWidth(Math.min(720, Math.max(240, cached.fileListWidth)));
      }
      const preferredId = cached?.selection?.type === "flow" ? cached.selection.id : null;
      const loaded = await loadFlows(preferredId);
      if (generationRef.current !== generation) return;
      if (cached?.selection?.type === "folder" && loaded.folders.includes(cached.selection.path)) {
        setters.selectedId(null); setters.selectedRecord(null); setters.selectedFolder(cached.selection.path);
        setters.editorFolder(cached.selection.path);
      }
      if (cached?.editor) {
        const flowId = cached.editor.flowId && loaded.list.some((flow) => flow.id === cached.editor?.flowId)
          ? cached.editor.flowId : null;
        setters.selectedId(flowId); setters.selectedFolder(flowId ? null : cached.editor.folder);
        setters.editorYaml(cached.editor.yaml); setters.editorFolder(cached.editor.folder); setters.isEditingYaml(true);
      }
    }).catch(async () => {
      if (generationRef.current === generation) await loadFlows();
    }).finally(() => {
      if (generationRef.current === generation) setHydrated(true);
    });
    return () => { if (generationRef.current === generation) generationRef.current += 1; };
  }, [loadFlows]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      const selection = state.selectedId ? { type: "flow" as const, id: state.selectedId }
        : state.selectedFolder ? { type: "folder" as const, path: state.selectedFolder } : null;
      void flowUiStore.set(FLOW_UI_STATE_KEY, {
        version: 1, section: state.section, selection, mode: state.mode, listMode: state.listMode,
        fileListWidth: state.fileListWidth,
        editor: state.isEditingYaml ? {
          flowId: state.selectedId, folder: state.editorFolder, yaml: state.editorYaml,
        } : null,
        updatedAt: Date.now(),
      } satisfies FlowUiState).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [hydrated, state.editorFolder, state.editorYaml, state.fileListWidth, state.isEditingYaml,
    state.listMode, state.mode, state.section, state.selectedFolder, state.selectedId]);
}
