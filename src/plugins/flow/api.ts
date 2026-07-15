import { invoke } from "@tauri-apps/api/core";

import type {
  EventDefinition,
  FlowListItem,
  FlowNodeDefinition,
  FlowNodeSpec,
  FlowRecord,
  FlowRunReport,
  FlowSummary,
} from "./types";

export const flowApi = {
  list: () => invoke<FlowListItem[]>("flow_list"),
  listFolders: () => invoke<string[]>("flow_list_folders"),
  eventCatalog: () => invoke<EventDefinition[]>("flow_event_catalog"),
  nodeCatalog: () => invoke<FlowNodeDefinition[]>("flow_node_catalog"),
  nodes: (id: string) => invoke<FlowNodeSpec[]>("flow_nodes", { id }),
  get: (id: string) => invoke<FlowRecord | null>("flow_get", { id }),
  validate: (workflow: string) => invoke<FlowSummary>("flow_validate", { workflow }),
  save: (workflow: string, folder: string) => invoke<FlowRecord>("flow_save", {
    request: { workflow, folder },
  }),
  setEnabled: (id: string, enabled: boolean) => invoke<FlowRecord>("flow_set_enabled", {
    id,
    enabled,
  }),
  run: (id: string) => invoke<FlowRunReport>("flow_run", {
    id,
    request: {
      intent: null,
      inputs: {},
    },
  }),
  delete: (id: string) => invoke("flow_delete", { id }),
  createFolder: (path: string) => invoke<string[]>("flow_create_folder", { path }),
  deleteFolder: (path: string) => invoke<string[]>("flow_delete_folder", { path }),
};
