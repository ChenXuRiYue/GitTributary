import type { PluginBackendMethod, RepositoryInsightSummary } from "./types";

const mockSummary: RepositoryInsightSummary = {
  repository: {
    id: "demo-repository",
    name: "GitTributary Notes",
  },
  branch: "main",
  changedFiles: 3,
  commitCount: 128,
  contributorCount: 4,
  flowCount: 6,
};

let hostPort: MessagePort | null = null;
let hostSessionId: string | null = null;
let resolveHostPort: ((port: MessagePort) => void) | null = null;
let uiMounted = false;
let readySent = false;
const hostPortReady = new Promise<MessagePort>((resolve) => {
  resolveHostPort = resolve;
});

function notifyPluginReady() {
  if (!uiMounted || !hostPort || !hostSessionId || readySent) return;
  readySent = true;
  hostPort.postMessage({
    type: "gittributary:plugin-ready",
    apiVersion: 1,
    sessionId: hostSessionId,
  });
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent
    || event.data?.type !== "gittributary:host-ready"
    || event.data?.apiVersion !== 1
    || typeof event.data?.sessionId !== "string"
    || !event.ports[0]
    || hostPort) return;
  hostPort = event.ports[0];
  hostSessionId = event.data.sessionId;
  hostPort.start();
  resolveHostPort?.(hostPort);
  resolveHostPort = null;
  notifyPluginReady();
});

export function markPluginReady() {
  uiMounted = true;
  notifyPluginReady();
}

function mockInvoke<T>(method: PluginBackendMethod): Promise<T> {
  if (method !== "repository_summary") {
    return Promise.reject(new Error(`Unsupported preview method: ${method}`));
  }

  return new Promise((resolve) => {
    window.setTimeout(() => resolve(mockSummary as T), 180);
  });
}

export async function invokeBackend<T>(
  method: PluginBackendMethod,
  payload: unknown = {},
): Promise<T> {
  if (window.parent === window) return mockInvoke<T>(method);
  const port = hostPort ?? await hostPortReady;
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        id?: string;
        ok?: boolean;
        result?: T;
        error?: { message?: string };
      };
      if (message.type !== "gittributary:response"
        || message.id !== id) return;
      port.removeEventListener("message", onMessage);
      if (message.ok) resolve(message.result as T);
      else reject(new Error(message.error?.message ?? "插件调用失败"));
    };
    port.addEventListener("message", onMessage);
    port.postMessage({
      type: "gittributary:request",
      id,
      method: "backend.invoke",
      payload: { method, payload },
    });
  });
}

export function isConnectedToHost(): boolean {
  return window.parent !== window;
}
