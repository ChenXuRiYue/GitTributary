import { beforeEach, describe, expect, it, vi } from "vitest";

import { callExtension } from "./api";
import { attachExtensionBridge, notifyExtensionReady } from "./bridge";
import { EXTENSION_API_VERSION, type ExtensionViewContribution } from "./types";

vi.mock("./api", () => ({
  callExtension: vi.fn(),
  extensionErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

const mockedCallExtension = vi.mocked(callExtension);
const contribution: ExtensionViewContribution = {
  pluginId: "com.example.publisher",
  generation: 7,
  pluginName: "Publisher",
  pluginVersion: "1.0.0",
  viewId: "main",
  title: "Publisher",
  description: "Publish notes",
  entryUrl: "plugin://publisher/index.html",
  iconUrl: null,
};

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data);
    port.start();
  });
}

beforeEach(() => {
  mockedCallExtension.mockResolvedValue({ ok: true });
});

describe("extension MessageChannel bridge", () => {
  it("accepts exactly one ready message for the negotiated version and session", async () => {
    const onReady = vi.fn();
    const bridge = attachExtensionBridge(contribution, { onReady });
    bridge.pluginPort.postMessage({
      type: "gittributary:plugin-ready",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: "wrong-session",
    });
    bridge.pluginPort.postMessage({
      type: "gittributary:plugin-ready",
      apiVersion: EXTENSION_API_VERSION + 1,
      sessionId: bridge.sessionId,
    });
    bridge.pluginPort.postMessage({
      type: "gittributary:plugin-ready",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: bridge.sessionId,
    });
    bridge.pluginPort.postMessage({
      type: "gittributary:plugin-ready",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: bridge.sessionId,
    });

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    bridge.dispose();
  });

  it("forwards valid requests with an immutable plugin identity", async () => {
    mockedCallExtension.mockResolvedValueOnce({ artifact: "/tmp/site" });
    const bridge = attachExtensionBridge(contribution);
    const response = nextMessage(bridge.pluginPort);
    bridge.pluginPort.postMessage({
      type: "gittributary:request",
      id: "request-1",
      method: "site.build",
      payload: { pluginId: "attacker", source: "/tmp/notes" },
    });

    await expect(response).resolves.toEqual({
      type: "gittributary:response",
      id: "request-1",
      ok: true,
      result: { artifact: "/tmp/site" },
    });
    expect(mockedCallExtension).toHaveBeenCalledWith({
      pluginId: contribution.pluginId,
      generation: contribution.generation,
      method: "site.build",
      payload: { pluginId: "attacker", source: "/tmp/notes" },
    });
    bridge.dispose();
  });

  it("forwards modal backdrop state only for the active bridge session", async () => {
    const onModalBackdropChange = vi.fn();
    const bridge = attachExtensionBridge(contribution, { onModalBackdropChange });
    bridge.pluginPort.postMessage({
      type: "gittributary:modal-state",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: "wrong-session",
      open: true,
      backdrop: "immersive",
    });
    bridge.pluginPort.postMessage({
      type: "gittributary:modal-state",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: bridge.sessionId,
      open: true,
      backdrop: "immersive",
    });

    await vi.waitFor(() => expect(onModalBackdropChange).toHaveBeenCalledWith("immersive"));
    bridge.pluginPort.postMessage({
      type: "gittributary:modal-state",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: bridge.sessionId,
      open: false,
      backdrop: "standard",
    });
    await vi.waitFor(() => expect(onModalBackdropChange).toHaveBeenLastCalledWith(null));

    bridge.pluginPort.postMessage({
      type: "gittributary:modal-state",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: bridge.sessionId,
      open: true,
      backdrop: "standard",
    });
    await vi.waitFor(() => expect(onModalBackdropChange).toHaveBeenLastCalledWith("standard"));
    bridge.dispose();
    expect(onModalBackdropChange).toHaveBeenLastCalledWith(null);
  });

  it("normalizes missing payloads to null", async () => {
    const bridge = attachExtensionBridge(contribution);
    const response = nextMessage(bridge.pluginPort);
    bridge.pluginPort.postMessage({
      type: "gittributary:request",
      id: "request-without-payload",
      method: "status",
    });
    await response;
    expect(mockedCallExtension).toHaveBeenCalledWith({
      pluginId: contribution.pluginId,
      generation: contribution.generation,
      method: "status",
      payload: null,
    });
    bridge.dispose();
  });

  it("returns structured failures without exposing internal objects", async () => {
    mockedCallExtension.mockRejectedValueOnce(new Error("backend unavailable"));
    const bridge = attachExtensionBridge(contribution);
    const response = nextMessage(bridge.pluginPort);
    bridge.pluginPort.postMessage({
      type: "gittributary:request",
      id: "request-2",
      method: "site.build",
      payload: {},
    });
    await expect(response).resolves.toEqual({
      type: "gittributary:response",
      id: "request-2",
      ok: false,
      error: { code: "EXTENSION_CALL_FAILED", message: "backend unavailable" },
    });
    bridge.dispose();
  });

  it.each([
    null,
    {},
    { type: "other", id: "1", method: "ping" },
    { type: "gittributary:request", id: "", method: "ping" },
    { type: "gittributary:request", id: "1", method: "" },
    { type: "gittributary:request", id: "x".repeat(129), method: "ping" },
    { type: "gittributary:request", id: "1", method: "x".repeat(129) },
  ])("ignores malformed or overlong request %#", async (request) => {
    const bridge = attachExtensionBridge(contribution);
    bridge.pluginPort.postMessage(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockedCallExtension).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("applies backpressure after 32 in-flight calls", async () => {
    mockedCallExtension.mockImplementation(() => new Promise(() => undefined));
    const bridge = attachExtensionBridge(contribution);
    for (let index = 0; index < 32; index += 1) {
      bridge.pluginPort.postMessage({
        type: "gittributary:request",
        id: `pending-${index}`,
        method: "slow.operation",
      });
    }
    await vi.waitFor(() => expect(mockedCallExtension).toHaveBeenCalledTimes(32));

    const response = nextMessage(bridge.pluginPort);
    bridge.pluginPort.postMessage({
      type: "gittributary:request",
      id: "overflow",
      method: "slow.operation",
    });
    await expect(response).resolves.toEqual({
      type: "gittributary:response",
      id: "overflow",
      ok: false,
      error: { code: "TOO_MANY_REQUESTS", message: "扩展请求过于频繁" },
    });
    expect(mockedCallExtension).toHaveBeenCalledTimes(32);
    bridge.dispose();
  });
});

describe("extension host handshake", () => {
  it("posts identity, theme, version, session, and the transferred port", () => {
    document.documentElement.classList.add("dark");
    const frame = document.createElement("iframe");
    const postMessage = vi.fn();
    Object.defineProperty(frame, "contentWindow", {
      configurable: true,
      value: { postMessage },
    });
    const channel = new MessageChannel();

    notifyExtensionReady(frame, contribution, channel.port1, "session-1");

    expect(postMessage).toHaveBeenCalledOnce();
    const [message, targetOrigin, transferred] = postMessage.mock.calls[0];
    expect(message).toEqual({
      type: "gittributary:host-ready",
      apiVersion: EXTENSION_API_VERSION,
      sessionId: "session-1",
      pluginId: contribution.pluginId,
      generation: contribution.generation,
      viewId: contribution.viewId,
      theme: "dark",
    });
    expect(targetOrigin).toBe("*");
    expect(transferred).toHaveLength(1);
    expect(transferred[0]).toBe(channel.port1);
    document.documentElement.classList.remove("dark");
    channel.port1.close();
    channel.port2.close();
  });
});
