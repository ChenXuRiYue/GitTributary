import { callExtension, extensionErrorMessage } from "./api";
import {
  EXTENSION_API_VERSION,
  type ExtensionBridgeRequest,
  type ExtensionHostReadyMessage,
  type ExtensionModalBackdrop,
  type ExtensionPluginModalStateMessage,
  type ExtensionPluginReadyMessage,
  type ExtensionViewContribution,
} from "./types";

const MAX_PENDING_REQUESTS = 32;

function isBridgeRequest(value: unknown): value is ExtensionBridgeRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<ExtensionBridgeRequest>;
  return request.type === "noteaura:request"
    && typeof request.id === "string"
    && request.id.length > 0
    && request.id.length <= 128
    && typeof request.method === "string"
    && request.method.length > 0
    && request.method.length <= 128;
}

function isPluginReadyMessage(
  value: unknown,
  sessionId: string,
): value is ExtensionPluginReadyMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ExtensionPluginReadyMessage>;
  return message.type === "noteaura:plugin-ready"
    && message.apiVersion === EXTENSION_API_VERSION
    && message.sessionId === sessionId;
}

function isPluginModalStateMessage(
  value: unknown,
  sessionId: string,
): value is ExtensionPluginModalStateMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ExtensionPluginModalStateMessage>;
  return message.type === "noteaura:modal-state"
    && message.apiVersion === EXTENSION_API_VERSION
    && message.sessionId === sessionId
    && typeof message.open === "boolean"
    && (message.backdrop === "standard" || message.backdrop === "immersive");
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export interface AttachedExtensionBridge {
  pluginPort: MessagePort;
  sessionId: string;
  dispose: () => void;
}

export interface ExtensionBridgeOptions {
  onReady?: () => void;
  onModalBackdropChange?: (backdrop: ExtensionModalBackdrop | null) => void;
}

/** Bind one MessagePort to one immutable plugin identity. */
export function attachExtensionBridge(
  contribution: ExtensionViewContribution,
  options: ExtensionBridgeOptions = {},
): AttachedExtensionBridge {
  const channel = new MessageChannel();
  const sessionId = crypto.randomUUID();
  let pending = 0;
  let disposed = false;
  let ready = false;
  let modalBackdrop: ExtensionModalBackdrop | null = null;

  channel.port1.onmessage = (event: MessageEvent<unknown>) => {
    if (disposed) return;
    if (isPluginReadyMessage(event.data, sessionId)) {
      if (!ready) {
        ready = true;
        options.onReady?.();
      }
      return;
    }
    if (isPluginModalStateMessage(event.data, sessionId)) {
      const nextBackdrop = event.data.open ? event.data.backdrop : null;
      if (nextBackdrop !== modalBackdrop) {
        modalBackdrop = nextBackdrop;
        options.onModalBackdropChange?.(modalBackdrop);
      }
      return;
    }
    if (!isBridgeRequest(event.data)) return;
    const request = event.data;

    if (pending >= MAX_PENDING_REQUESTS) {
      channel.port1.postMessage({
        type: "noteaura:response",
        id: request.id,
        ok: false,
        error: { code: "TOO_MANY_REQUESTS", message: "扩展请求过于频繁" },
      });
      return;
    }

    pending += 1;
    void callExtension({
      pluginId: contribution.pluginId,
      generation: contribution.generation,
      method: request.method,
      payload: request.payload ?? null,
    }).then((result) => {
      if (disposed) return;
      channel.port1.postMessage({
        type: "noteaura:response",
        id: request.id,
        ok: true,
        result,
      });
    }).catch((error: unknown) => {
      if (disposed) return;
      const message = extensionErrorMessage(error);
      channel.port1.postMessage({
        type: "noteaura:response",
        id: request.id,
        ok: false,
        error: { code: "EXTENSION_CALL_FAILED", message },
      });
    }).finally(() => {
      pending = Math.max(0, pending - 1);
    });
  };
  channel.port1.start();
  return {
    pluginPort: channel.port2,
    sessionId,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (modalBackdrop !== null) {
        modalBackdrop = null;
        options.onModalBackdropChange?.(null);
      }
      channel.port1.close();
      channel.port2.close();
    },
  };
}

export function notifyExtensionReady(
  frame: HTMLIFrameElement,
  contribution: ExtensionViewContribution,
  port: MessagePort,
  sessionId: string,
) {
  const message: ExtensionHostReadyMessage = {
    type: "noteaura:host-ready",
    apiVersion: EXTENSION_API_VERSION,
    sessionId,
    pluginId: contribution.pluginId,
    generation: contribution.generation,
    viewId: contribution.viewId,
    theme: currentTheme(),
  };
  frame.contentWindow?.postMessage(message, "*", [port]);
}
