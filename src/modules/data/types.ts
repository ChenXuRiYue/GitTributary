export interface NamespaceInfo {
  name: string;
  count: number;
  visibility: "public" | "private";
}

export interface KvEntry {
  key: string;
  value: unknown;
}

export interface DataCenterConfigCredentialStatus {
  has_token: boolean;
  token_masked: string | null;
  credential_ref: string;
}

export interface SyncConfigPayload {
  url: string;
  branch: string;
  active_environment_id?: string | null;
  local_database_path?: string | null;
  auto_sync: boolean;
  interval_seconds: number;
}

export interface ConfigRepoCheckReport {
  ok: boolean;
  status: string;
  message: string;
  default_branch: string | null;
  refs_count: number;
}

export type ViewMode = "compact" | "tree" | "json";
export type StoreViewId = "detail";

export interface DataPanelUiState {
  version: 1;
  namespace: string;
  viewMode: ViewMode;
  searchQuery: string;
  updatedAt: number;
}

export interface KeyTreeNode {
  name: string;
  path: string;
  children: Map<string, KeyTreeNode>;
  entry?: KvEntry;
}

export interface JsonGroup {
  name: string;
  value: unknown;
  count: number;
}
