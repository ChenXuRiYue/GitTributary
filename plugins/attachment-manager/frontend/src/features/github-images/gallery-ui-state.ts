import { createPluginStore } from "../../store";
import type { GitHubImageLibrary, GitRemoteBinding } from "../../types";

export type GalleryPage =
  | { id: "home" }
  | { id: "repository"; library: GitHubImageLibrary; existing: boolean };

interface GalleryUiState {
  version: 1;
  page: GalleryPage;
  updatedAt: number;
}

export const galleryUiStore = createPluginStore("ui");
export const GALLERY_UI_STATE_KEY = "gallery.v1";

function parseRemote(value: unknown): GitRemoteBinding | null {
  if (!value || typeof value !== "object") return null;
  const remote = value as Partial<GitRemoteBinding>;
  if (typeof remote.repoPath !== "string" || typeof remote.name !== "string" || typeof remote.url !== "string") return null;
  return { repoPath: remote.repoPath, name: remote.name, url: remote.url };
}

function parseLibrary(value: unknown): GitHubImageLibrary | null {
  if (!value || typeof value !== "object") return null;
  const library = value as Partial<GitHubImageLibrary>;
  if (typeof library.id !== "string" || !library.id) return null;
  if (typeof library.name !== "string" || typeof library.branch !== "string" || typeof library.directory !== "string") return null;
  const remote = library.remote === null ? null : parseRemote(library.remote);
  if (library.remote !== null && !remote) return null;
  return {
    id: library.id,
    name: library.name,
    remote,
    branch: library.branch,
    directory: library.directory,
    suggestedRemoteUrl: typeof library.suggestedRemoteUrl === "string" ? library.suggestedRemoteUrl : undefined,
  };
}

export function parseGalleryUiState(value: unknown): GalleryUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as { version?: unknown; page?: unknown; updatedAt?: unknown };
  if (state.version !== 1 || !state.page || typeof state.page !== "object") return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  const page = state.page as { id?: unknown; library?: unknown; existing?: unknown };
  if (page.id === "home") return { version: 1, page: { id: "home" }, updatedAt: state.updatedAt };
  if (page.id !== "repository" || typeof page.existing !== "boolean") return null;
  const library = parseLibrary(page.library);
  if (!library) return null;
  return {
    version: 1,
    page: { id: "repository", library, existing: page.existing },
    updatedAt: state.updatedAt,
  };
}
