export const EXTENSION_API_VERSION = 1 as const;

/** A navigation view contributed by an installed extension. */
export interface ExtensionViewContribution {
  pluginId: string;
  generation: number;
  pluginName: string;
  pluginVersion: string;
  viewId: string;
  title: string;
  description: string;
  entryUrl: string;
  iconUrl: string | null;
}

export interface ExtensionCallRequest {
  pluginId: string;
  generation: number;
  method: string;
  payload: unknown;
}

export interface ExtensionBridgeRequest {
  type: "noteaura:request";
  id: string;
  method: string;
  payload?: unknown;
}

export interface ExtensionBridgeResponse {
  type: "noteaura:response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface ExtensionHostReadyMessage {
  type: "noteaura:host-ready";
  apiVersion: typeof EXTENSION_API_VERSION;
  sessionId: string;
  pluginId: string;
  generation: number;
  viewId: string;
  theme: "light" | "dark";
}

export interface ExtensionPluginReadyMessage {
  type: "noteaura:plugin-ready";
  apiVersion: typeof EXTENSION_API_VERSION;
  sessionId: string;
}

export type ExtensionModalBackdrop = "standard" | "immersive";

export interface ExtensionPluginModalStateMessage {
  type: "noteaura:modal-state";
  apiVersion: typeof EXTENSION_API_VERSION;
  sessionId: string;
  open: boolean;
  backdrop: ExtensionModalBackdrop;
}

export interface ExtensionContributionsState {
  contributions: ExtensionViewContribution[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}
