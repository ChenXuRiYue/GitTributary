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
    type: "noteaura:plugin-ready",
    apiVersion: 1,
    sessionId: hostSessionId,
  });
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent
    || event.data?.type !== "noteaura:host-ready"
    || event.data?.apiVersion !== 1
    || typeof event.data?.sessionId !== "string"
    || (event.data?.theme !== "light" && event.data?.theme !== "dark")
    || !event.ports[0]
    || hostPort) return;
  document.documentElement.classList.toggle("dark", event.data.theme === "dark");
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

export async function invokeHost<T>(method: string, payload: unknown = {}): Promise<T> {
  if (window.parent === window) {
    throw new Error("该页面需要在 NoteAura 插件宿主中运行");
  }
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
      if (message.type !== "noteaura:response" || message.id !== id) return;
      port.removeEventListener("message", onMessage);
      if (message.ok) resolve(message.result as T);
      else reject(new Error(message.error?.message ?? "宿主调用失败"));
    };
    port.addEventListener("message", onMessage);
    port.postMessage({
      type: "noteaura:request",
      id,
      method,
      payload,
    });
  });
}

export function isPluginHostRuntime(): boolean {
  return window.parent !== window;
}
