import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./registry", () => ({ coreModules: [] }));
vi.mock("@/platform/extensions", () => ({
  useExtensionContributions: () => ({
    contributions: [{
      pluginId: "dev.noteaura.attachment-manager",
      generation: 1,
      pluginName: "附件",
      pluginVersion: "0.4.9",
      viewId: "attachment-manager.main",
      title: "附件",
      description: "附件管理",
      entryUrl: "na-plugin://localhost/attachment/index.html",
      iconUrl: null,
    }],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  ExtensionFrame: ({
    onModalBackdropChange,
  }: {
    onModalBackdropChange?: (backdrop: "standard" | "immersive" | null) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onModalBackdropChange?.("immersive")}>打开图片预览</button>
      <button type="button" onClick={() => onModalBackdropChange?.(null)}>关闭图片预览</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("application shell plugin modal backdrop", () => {
  it("dims and disables the primary sidebar until the plugin preview closes", () => {
    render(<App />);
    const sidebar = screen.getByTestId("primary-sidebar");

    fireEvent.click(screen.getByRole("button", { name: "打开图片预览" }));
    expect(sidebar).toHaveAttribute("inert");
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(sidebar).toHaveClass("border-black/60");
    expect(sidebar).not.toHaveClass("border-sidebar-border");
    const backdrop = sidebar.querySelector('[data-plugin-modal-backdrop="immersive"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop).toHaveClass("-right-px");

    fireEvent.click(screen.getByRole("button", { name: "关闭图片预览" }));
    expect(sidebar).not.toHaveAttribute("inert");
    expect(sidebar).not.toHaveAttribute("aria-hidden");
    expect(sidebar).toHaveClass("border-sidebar-border");
    expect(sidebar).not.toHaveClass("border-black/60");
    expect(sidebar.querySelector("[data-plugin-modal-backdrop]")).toBeNull();
  });
});
