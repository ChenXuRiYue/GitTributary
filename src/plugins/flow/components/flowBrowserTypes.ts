export type FlowTreeSelection =
  | { type: "flow"; id: string }
  | { type: "folder"; path: string };

export type FlowContextMenuState = {
  left: number;
  top: number;
  selection: FlowTreeSelection;
} | null;

export type FlowPoint = { x: number; y: number };

export type FlowFolderCreateDraft = {
  parent: string;
  left: number;
  top: number;
  value: string;
} | null;
