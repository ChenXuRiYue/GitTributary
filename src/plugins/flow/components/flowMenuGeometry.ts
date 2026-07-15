import type { FlowTreeSelection } from "./flowBrowserTypes";

export const FLOW_ACTION_MENU_WIDTH = 152;

const FLOW_ACTION_ROW_HEIGHT = 32;
const FLOW_ACTION_MENU_PADDING_Y = 8;

export function flowActionMenuHeight(selection: FlowTreeSelection) {
  return (selection.type === "folder" ? 3 : 2) * FLOW_ACTION_ROW_HEIGHT + FLOW_ACTION_MENU_PADDING_Y;
}
