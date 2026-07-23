import { useEffect, useRef, useState } from "react";

import { siteUiStore } from "../../store";
import { defaultPublishDraft, makePublishTarget } from "../publish";
import { parseSiteWorkspaceConfigState } from "../state";
import type {
  PublishRepoCandidate,
  RemoteConfigEntry,
  SiteWorkspaceGroup,
} from "../types";

interface WorkspaceRepoOption {
  id: string;
  path: string;
  name: string;
  remotes: RemoteConfigEntry[];
}

type WorkspaceEditorDraft = Omit<SiteWorkspaceGroup, "documentScope" | "runHistory">;

export interface WorkspaceEditorUiState {
  version: 1;
  viewingGroupId: string | null;
  draft: WorkspaceEditorDraft | null;
  updatedAt: number;
}

const WORKSPACE_EDITOR_UI_KEY = "workspace.editor.v1";

function toWorkspaceEditorDraft(group: SiteWorkspaceGroup): WorkspaceEditorDraft {
  return {
    id: group.id,
    name: group.name,
    sourceRepoPath: group.sourceRepoPath,
    target: group.target,
    env: group.env,
    updatedAt: group.updatedAt,
  };
}

export function makeWorkspaceEditorUiState(
  viewingGroupId: string | null,
  draft: SiteWorkspaceGroup | null,
  updatedAt = Date.now(),
): WorkspaceEditorUiState {
  return {
    version: 1,
    viewingGroupId,
    draft: draft ? toWorkspaceEditorDraft(draft) : null,
    updatedAt,
  };
}

export function parseWorkspaceEditorUiState(value: unknown): WorkspaceEditorUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<WorkspaceEditorUiState>;
  if (state.version !== 1) return null;
  if (state.viewingGroupId !== null && typeof state.viewingGroupId !== "string") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  if (state.draft === null) return state as WorkspaceEditorUiState;
  if (!state.draft || typeof state.draft !== "object") return null;
  const parsed = parseSiteWorkspaceConfigState({
    version: 1,
    groups: [state.draft],
    activeGroupId: (state.draft as { id?: unknown }).id,
    updatedAt: state.updatedAt,
  });
  const draft = parsed?.groups[0];
  if (!draft) return null;
  return {
    version: 1,
    viewingGroupId: state.viewingGroupId ?? null,
    draft: toWorkspaceEditorDraft(draft),
    updatedAt: state.updatedAt,
  };
}

function repoNameFromPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function buildWorkspaceRepoOptions(remotes: RemoteConfigEntry[]): WorkspaceRepoOption[] {
  const groups = new Map<string, RemoteConfigEntry[]>();
  remotes.forEach((remote) => {
    const path = remote.repo_path?.trim();
    if (!path) return;
    const group = groups.get(path) ?? [];
    group.push(remote);
    groups.set(path, group);
  });
  return Array.from(groups.entries())
    .sort(([a], [b]) => repoNameFromPath(a).localeCompare(repoNameFromPath(b)))
    .map(([path, items]) => ({
      id: path,
      path,
      name: repoNameFromPath(path),
      remotes: items,
    }));
}

function groupsEqual(a: SiteWorkspaceGroup, b: SiteWorkspaceGroup): boolean {
  return a.id === b.id
    && a.name === b.name
    && a.sourceRepoPath === b.sourceRepoPath
    && JSON.stringify(a.target) === JSON.stringify(b.target)
    && JSON.stringify(a.env) === JSON.stringify(b.env);
}

function envVarId() {
  return `env.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
}

export function useWorkspaceConfigDraft({
  groups,
  activeGroupId,
  remoteConfigs,
  publishCandidates,
  onCreateGroup,
  onSelectGroup,
  onUpdateGroup,
  onDeleteGroup,
}: {
  groups: SiteWorkspaceGroup[];
  activeGroupId: string | null;
  remoteConfigs: RemoteConfigEntry[];
  publishCandidates: PublishRepoCandidate[];
  onCreateGroup: () => string | null;
  onSelectGroup: (id: string) => void;
  onUpdateGroup: (id: string, updater: (group: SiteWorkspaceGroup) => SiteWorkspaceGroup) => void;
  onDeleteGroup: (id: string) => void;
}) {
  const currentGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [restoredEditor, setRestoredEditor] = useState<WorkspaceEditorUiState | null>(null);
  const [editorStateHydrated, setEditorStateHydrated] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const restoreAppliedRef = useRef(false);
  const viewingGroup = groups.find((group) => group.id === viewingGroupId)
    ?? currentGroup
    ?? groups[0]
    ?? null;

  useEffect(() => {
    let cancelled = false;
    void siteUiStore.get<unknown>(WORKSPACE_EDITOR_UI_KEY).then((raw) => {
      if (!cancelled) setRestoredEditor(parseWorkspaceEditorUiState(raw));
    }).catch(() => {
      // Task editing remains available without draft restoration.
    }).finally(() => {
      if (!cancelled) setEditorStateHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  const [draft, setDraft] = useState<SiteWorkspaceGroup | null>(null);
  const draftGroupIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!editorStateHydrated || restoreAppliedRef.current || groups.length === 0) return;
    const restoredId = restoredEditor?.viewingGroupId;
    const preferredId = restoredId && groups.some((group) => group.id === restoredId)
      ? restoredId
      : currentGroup?.id ?? groups[0]?.id ?? null;
    const preferredGroup = groups.find((group) => group.id === preferredId) ?? null;
    const restoredDraft = restoredEditor?.draft?.id === preferredId && preferredGroup
      ? {
          ...restoredEditor.draft,
          documentScope: preferredGroup.documentScope,
          runHistory: preferredGroup.runHistory,
        }
      : null;
    setViewingGroupId(preferredId);
    setDraft(restoredDraft ?? preferredGroup);
    draftGroupIdRef.current = preferredId ?? undefined;
    restoreAppliedRef.current = true;
    setEditorReady(true);
  }, [currentGroup?.id, editorStateHydrated, groups, restoredEditor]);

  useEffect(() => {
    if (!editorReady) return;
    if (groups.length === 0) {
      setViewingGroupId(null);
      setDraft(null);
      return;
    }
    setViewingGroupId((current) => {
      if (current && groups.some((group) => group.id === current)) return current;
      return currentGroup?.id ?? groups[0]?.id ?? null;
    });
  }, [currentGroup?.id, editorReady, groups]);

  useEffect(() => {
    if (!editorReady) return;
    if (draftGroupIdRef.current === viewingGroup?.id) return;
    draftGroupIdRef.current = viewingGroup?.id;
    setDraft(viewingGroup);
  }, [editorReady, viewingGroup]);

  useEffect(() => {
    if (!editorReady) return;
    const timeout = window.setTimeout(() => {
      void siteUiStore.set(
        WORKSPACE_EDITOR_UI_KEY,
        makeWorkspaceEditorUiState(viewingGroupId, draft),
      ).catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [draft, editorReady, viewingGroupId]);

  const dirty = Boolean(draft && viewingGroup && !groupsEqual(draft, viewingGroup));
  const draftIsCurrent = Boolean(draft && draft.id === activeGroupId);
  const confirmDiscardIfDirty = () => !dirty
    || window.confirm("当前任务详情还有未保存的改动，查看其他任务/新建/删除会丢弃这些改动。确定要继续吗？");
  const handleViewGroup = (id: string) => {
    if (id !== viewingGroup?.id && confirmDiscardIfDirty()) setViewingGroupId(id);
  };
  const handleCreateGroup = () => {
    if (!confirmDiscardIfDirty()) return;
    const nextId = onCreateGroup();
    if (nextId) setViewingGroupId(nextId);
  };
  const handleDeleteGroup = (id: string) => {
    if (!confirmDiscardIfDirty()) return;
    const fallbackViewingId = groups.find((group) => group.id !== id && group.id === activeGroupId)?.id
      ?? groups.find((group) => group.id !== id)?.id
      ?? null;
    onDeleteGroup(id);
    if (id === viewingGroup?.id) setViewingGroupId(fallbackViewingId);
  };
  const handleSetCurrentGroup = () => {
    if (draft && draft.id !== activeGroupId && !dirty) onSelectGroup(draft.id);
  };
  const saveDraft = () => {
    if (!draft) return;
    onUpdateGroup(draft.id, (current) => ({
      ...draft,
      documentScope: current.documentScope,
      runHistory: current.runHistory,
    }));
  };

  const sourceRepoOptions = buildWorkspaceRepoOptions(remoteConfigs);
  const selectedSource = draft
    ? sourceRepoOptions.find((repo) => repo.path === draft.sourceRepoPath) ?? null
    : null;
  const target = draft?.target ?? null;
  const selectedCandidate = target
    ? publishCandidates.find((candidate) => candidate.id === target.targetRepoId) ?? null
    : null;
  const updateDraft = (updater: (group: SiteWorkspaceGroup) => SiteWorkspaceGroup) => {
    setDraft((current) => (current ? updater(current) : current));
  };
  const updateTarget = (
    updater: (target: NonNullable<SiteWorkspaceGroup["target"]>) => NonNullable<SiteWorkspaceGroup["target"]>,
  ) => updateDraft((group) => (group.target ? { ...group, target: updater(group.target) } : group));
  const selectPublishCandidate = (candidate: PublishRepoCandidate) => {
    updateDraft((group) => ({
      ...group,
      target: makePublishTarget(candidate, defaultPublishDraft(candidate)),
    }));
  };
  const addEnvVar = () => {
    updateDraft((group) => ({
      ...group,
      env: [...group.env, { id: envVarId(), key: "", value: "", enabled: true }],
    }));
  };

  return {
    viewingGroup,
    draft,
    dirty,
    draftIsCurrent,
    sourceRepoOptions,
    selectedSource,
    target,
    selectedCandidate,
    handleViewGroup,
    handleCreateGroup,
    handleDeleteGroup,
    handleSetCurrentGroup,
    saveDraft,
    updateDraft,
    updateTarget,
    selectPublishCandidate,
    addEnvVar,
  };
}
