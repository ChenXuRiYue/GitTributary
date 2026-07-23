import { createJsonStore } from "@/shared/lib/store";

export interface RemoteViewUiState {
  version: 1;
  clone: { url: string; parentPath: string; commitName: string; commitEmail: string };
  addRemote: { name: string; url: string; commitName: string; commitEmail: string };
  remoteDrafts: Record<string, { url: string; commitName: string; commitEmail: string }>;
  expandedRemoteKeys: Record<string, boolean>;
  updatedAt: number;
}

export const remoteUiStore = createJsonStore("ui-state");
export const REMOTE_UI_STATE_KEY = "git.remote.workspace.v1";

export function parseRemoteViewUiState(value: unknown): RemoteViewUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<RemoteViewUiState>;
  if (state.version !== 1 || !state.clone || !state.addRemote || !state.remoteDrafts || !state.expandedRemoteKeys) return null;
  if (typeof state.clone.url !== "string" || typeof state.clone.parentPath !== "string"
    || typeof state.clone.commitName !== "string" || typeof state.clone.commitEmail !== "string") return null;
  if (typeof state.addRemote.name !== "string" || typeof state.addRemote.url !== "string"
    || typeof state.addRemote.commitName !== "string" || typeof state.addRemote.commitEmail !== "string") return null;
  const remoteDrafts = Object.fromEntries(Object.entries(state.remoteDrafts).flatMap(([key, draft]) => {
    if (!draft || typeof draft !== "object") return [];
    const item = draft as { url?: unknown; commitName?: unknown; commitEmail?: unknown };
    return typeof item.url === "string" && typeof item.commitName === "string" && typeof item.commitEmail === "string"
      ? [[key, { url: item.url, commitName: item.commitName, commitEmail: item.commitEmail }]] : [];
  }));
  const expandedRemoteKeys = Object.fromEntries(
    Object.entries(state.expandedRemoteKeys).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
  return { ...state, remoteDrafts, expandedRemoteKeys } as RemoteViewUiState;
}
