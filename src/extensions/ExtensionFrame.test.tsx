import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachExtensionBridge, notifyExtensionReady } from "./bridge";
import { ExtensionFrame } from "./ExtensionFrame";
import type { ExtensionViewContribution } from "./types";

vi.mock("./bridge", () => ({
  attachExtensionBridge: vi.fn(),
  notifyExtensionReady: vi.fn(),
}));

const mockedAttachBridge = vi.mocked(attachExtensionBridge);
const mockedNotifyReady = vi.mocked(notifyExtensionReady);
const contribution: ExtensionViewContribution = {
  pluginId: "com.example.publisher",
  generation: 7,
  pluginName: "Publisher",
  pluginVersion: "1.0.0",
  viewId: "main",
  title: "Site Publisher",
  description: "Publish notes",
  entryUrl: "plugin://publisher/index.html",
  iconUrl: null,
};

const readyCallbacks: Array<(() => void) | undefined> = [];
const disposers: ReturnType<typeof vi.fn>[] = [];

beforeEach(() => {
  readyCallbacks.length = 0;
  disposers.length = 0;
  mockedAttachBridge.mockImplementation((_currentContribution, options) => {
    const dispose = vi.fn();
    readyCallbacks.push(options?.onReady);
    disposers.push(dispose);
    return {
      pluginPort: {} as MessagePort,
      sessionId: `session-${disposers.length}`,
      dispose,
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExtensionFrame lifecycle", () => {
  it("loads a sandboxed frame and becomes ready only after the plugin handshake", () => {
    render(<ExtensionFrame contribution={contribution} />);
    const frame = screen.getByTitle("Publisher: Site Publisher");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByText("正在加载 Site Publisher")).toBeInTheDocument();

    fireEvent.load(frame);
    expect(mockedNotifyReady).toHaveBeenCalledWith(
      frame,
      contribution,
      expect.anything(),
      "session-1",
    );
    expect(screen.getByText("正在加载 Site Publisher")).toBeInTheDocument();

    act(() => readyCallbacks[0]?.());
    expect(screen.queryByText("正在加载 Site Publisher")).not.toBeInTheDocument();
    expect(screen.queryByText("插件暂时无法运行")).not.toBeInTheDocument();
  });

  it("fails closed after the startup timeout and creates a new bridge on retry", () => {
    vi.useFakeTimers();
    render(<ExtensionFrame contribution={contribution} />);
    fireEvent.load(screen.getByTitle("Publisher: Site Publisher"));

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("插件前端启动超时")).toBeInTheDocument();
    expect(disposers[0]).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(mockedAttachBridge).toHaveBeenCalledTimes(2);
    expect(screen.getByText("正在加载 Site Publisher")).toBeInTheDocument();
  });

  it("rejects an unexpected second iframe navigation", () => {
    render(<ExtensionFrame contribution={contribution} />);
    const frame = screen.getByTitle("Publisher: Site Publisher");
    fireEvent.load(frame);
    fireEvent.load(frame);

    expect(screen.getByText("插件页面发生了不允许的导航")).toBeInTheDocument();
    expect(disposers[0]).toHaveBeenCalledOnce();
  });

  it("disposes the active bridge when unmounted", () => {
    const { unmount } = render(<ExtensionFrame contribution={contribution} />);
    unmount();
    expect(disposers[0]).toHaveBeenCalledOnce();
  });
});
