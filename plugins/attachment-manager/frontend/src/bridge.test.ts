import { describe, expect, it } from "vitest";

import { registerPluginModal } from "./bridge";

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data);
    port.start();
  });
}

describe("attachment plugin modal bridge", () => {
  it("reports the strongest active modal backdrop and clears it after release", async () => {
    const releaseStandard = registerPluginModal("standard");
    const releaseImmersive = registerPluginModal("immersive");
    const channel = new MessageChannel();
    const opened = nextMessage(channel.port2);

    window.dispatchEvent(new MessageEvent("message", {
      source: window.parent,
      data: {
        type: "gittributary:host-ready",
        apiVersion: 1,
        sessionId: "session-1",
        theme: "light",
      },
      ports: [channel.port1],
    }));

    await expect(opened).resolves.toEqual({
      type: "gittributary:modal-state",
      apiVersion: 1,
      sessionId: "session-1",
      open: true,
      backdrop: "immersive",
    });

    const downgraded = nextMessage(channel.port2);
    releaseImmersive();
    await expect(downgraded).resolves.toMatchObject({ open: true, backdrop: "standard" });

    const closed = nextMessage(channel.port2);
    releaseStandard();
    await expect(closed).resolves.toMatchObject({ open: false, backdrop: "standard" });
    channel.port1.close();
    channel.port2.close();
  });
});
