import type { DomainSort } from "./features/domains/model";
import type { Filter, LinkFilter, SortMode, ViewMode } from "./features/inventory/model";
import { createPluginStore } from "./store";

export type AttachmentModule = "inventory" | "domains" | "gallery" | "migration";

export interface AttachmentUiState {
  version: 1;
  activeModule: AttachmentModule;
  inventory: {
    selectedPath: string | null; query: string; filter: Filter; linkFilter: LinkFilter;
    viewMode: ViewMode; sortMode: SortMode; page: number;
  };
  domains: {
    selectedDomain: string | null; selectedPath: string | null; query: string; sort: DomainSort;
    domainPage: number; resourcePage: number; resourceKind: LinkFilter;
  };
  migration: {
    selectedTaskId: string | null; selectedPaths: string[] | null;
    query: string; expandedFiles: string[];
  };
  layout: { inventoryWidth: number; detailWidth: number };
  updatedAt: number;
}

export const attachmentUiStore = createPluginStore("ui");
export const ATTACHMENT_UI_STATE_KEY = "workspace.v1";

const MODULES = new Set<AttachmentModule>(["inventory", "domains", "gallery", "migration"]);
const FILTERS = new Set<Filter>(["all", "orphan", "image", "audio", "link"]);
const LINK_FILTERS = new Set<LinkFilter>(["all", "image", "audio", "video", "website", "download", "unknown"]);
const VIEW_MODES = new Set<ViewMode>(["grid", "list"]);
const SORT_MODES = new Set<SortMode>(["name", "size", "references"]);
const DOMAIN_SORTS = new Set<DomainSort>(["resources", "images", "references", "notes"]);

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseAttachmentUiState(value: unknown): AttachmentUiState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<AttachmentUiState>;
  const inventory = state.inventory as Partial<AttachmentUiState["inventory"]> | undefined;
  const domains = state.domains as Partial<AttachmentUiState["domains"]> | undefined;
  const migration = state.migration as Partial<AttachmentUiState["migration"]> | undefined;
  const layout = state.layout as Partial<AttachmentUiState["layout"]> | undefined;
  if (state.version !== 1 || !MODULES.has(state.activeModule as AttachmentModule)) return null;
  if (!inventory || !nullableString(inventory.selectedPath) || typeof inventory.query !== "string") return null;
  if (!FILTERS.has(inventory.filter as Filter) || !LINK_FILTERS.has(inventory.linkFilter as LinkFilter)) return null;
  if (!VIEW_MODES.has(inventory.viewMode as ViewMode) || !SORT_MODES.has(inventory.sortMode as SortMode)) return null;
  if (!Number.isInteger(inventory.page) || (inventory.page ?? -1) < 0) return null;
  if (!domains || !nullableString(domains.selectedDomain) || !nullableString(domains.selectedPath)) return null;
  if (typeof domains.query !== "string" || !DOMAIN_SORTS.has(domains.sort as DomainSort)) return null;
  if (!Number.isInteger(domains.domainPage) || (domains.domainPage ?? -1) < 0) return null;
  if (!Number.isInteger(domains.resourcePage) || (domains.resourcePage ?? -1) < 0) return null;
  if (!LINK_FILTERS.has(domains.resourceKind as LinkFilter)) return null;
  if (!migration || !nullableString(migration.selectedTaskId)) return null;
  const selectedPaths = migration.selectedPaths === undefined
    ? null
    : migration.selectedPaths;
  const query = migration.query === undefined ? "" : migration.query;
  const expandedFiles = migration.expandedFiles === undefined ? [] : migration.expandedFiles;
  if (selectedPaths !== null && (!Array.isArray(selectedPaths) || selectedPaths.some((path) => typeof path !== "string"))) return null;
  if (typeof query !== "string") return null;
  if (!Array.isArray(expandedFiles) || expandedFiles.some((path) => typeof path !== "string")) return null;
  if (!layout || typeof layout.inventoryWidth !== "number" || !Number.isFinite(layout.inventoryWidth)) return null;
  if (typeof layout.detailWidth !== "number" || !Number.isFinite(layout.detailWidth)) return null;
  if (typeof state.updatedAt !== "number" || !Number.isFinite(state.updatedAt)) return null;
  return {
    ...state,
    migration: {
      selectedTaskId: migration.selectedTaskId ?? null,
      selectedPaths,
      query,
      expandedFiles,
    },
  } as AttachmentUiState;
}
