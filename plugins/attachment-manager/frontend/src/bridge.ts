let hostPort: MessagePort | null = null;
let hostSessionId: string | null = null;
let resolveHostPort: ((port: MessagePort) => void) | null = null;
let uiMounted = false;
let readySent = false;
const modalLayers = { standard: 0, immersive: 0 };

export type PluginModalBackdrop = keyof typeof modalLayers;

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

function notifyModalState() {
  if (!hostPort || !hostSessionId) return;
  const backdrop: PluginModalBackdrop = modalLayers.immersive > 0 ? "immersive" : "standard";
  hostPort.postMessage({
    type: "gittributary:modal-state",
    apiVersion: 1,
    sessionId: hostSessionId,
    open: modalLayers.standard + modalLayers.immersive > 0,
    backdrop,
  });
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent
    || event.data?.type !== "gittributary:host-ready"
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
  notifyModalState();
});

export function markPluginReady() {
  uiMounted = true;
  notifyPluginReady();
}

export function registerPluginModal(backdrop: PluginModalBackdrop = "standard"): () => void {
  modalLayers[backdrop] += 1;
  notifyModalState();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    modalLayers[backdrop] = Math.max(0, modalLayers[backdrop] - 1);
    notifyModalState();
  };
}

export async function invokeHost<T>(method: string, payload: unknown = {}): Promise<T> {
  if (window.parent === window) {
    throw new Error("该页面需要在 GitTributary 插件宿主中运行");
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
      if (message.type !== "gittributary:response" || message.id !== id) return;
      port.removeEventListener("message", onMessage);
      if (message.ok) resolve(message.result as T);
      else reject(new Error(message.error?.message ?? "宿主调用失败"));
    };
    port.addEventListener("message", onMessage);
    port.postMessage({
      type: "gittributary:request",
      id,
      method,
      payload,
    });
  });
}
