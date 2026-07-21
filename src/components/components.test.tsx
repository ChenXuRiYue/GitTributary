import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { File, Folder, Settings } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainTrail } from "./DomainTrail";
import { FileTree, type FileTreeLeaf } from "./FileTree";
import { IconNav, type NavItem } from "./IconNav";
import { ResizeHandle } from "./ResizeHandle";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockResolvedValue(null as never);
});

describe("DomainTrail", () => {
  it("renders an accessible trail with one current leaf", () => {
    render(<DomainTrail items={[
      { id: "git", label: "Git", title: "Git repository" },
      { id: "history", label: "历史" },
    ]} />);
    const trail = screen.getByRole("navigation", { name: "当前位置" });
    expect(trail).toHaveAttribute("title", "Git repository / 历史");
    expect(within(trail).getByText("历史")).toHaveAttribute("aria-current", "page");
    expect(within(trail).getByText("Git")).not.toHaveAttribute("aria-current");
  });

  it("supports a custom accessible label and omits empty navigation", () => {
    const { rerender } = render(<DomainTrail ariaLabel="Flow path" items={[{ id: "flow", label: "Flow" }]} />);
    expect(screen.getByRole("navigation", { name: "Flow path" })).toBeInTheDocument();
    rerender(<DomainTrail items={[]} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("FileTree", () => {
  const items: FileTreeLeaf[] = [
    { id: "readme", path: "README.md", label: "README.md", kind: "file" },
    { id: "guide", path: "docs/guide.md", label: "Guide", subtitle: "Start here", marker: "active" },
    { id: "api", path: "docs/reference/api.md", label: "API" },
    { id: "src", path: "src", label: "src", kind: "folder", icon: Folder, marker: "warning" },
    { id: "main", path: "src/main.ts", label: "main.ts", icon: File },
  ];

  it("renders folders before root files and opens all folders by default", () => {
    render(<FileTree items={items} showFolderCount />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("docs");
    expect(buttons[1]).toHaveTextContent("reference");
    expect(screen.getByText("Guide")).toBeVisible();
    expect(screen.getByText("API")).toBeVisible();
    expect(screen.getByText("Start here")).toBeVisible();
  });

  it("selects files and explicit folder leaves", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FileTree items={items} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Guide/ }));
    await user.click(screen.getByRole("button", { name: /src/ }));
    expect(onSelect.mock.calls).toEqual([["guide"], ["src"]]);
  });

  it("collapses a folder without selecting an implicit folder node", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FileTree items={items} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /^docs/ }));
    expect(screen.queryByText("Guide")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards file and folder context menus with pointer coordinates", () => {
    const onContextMenu = vi.fn();
    render(<FileTree items={items} onContextMenu={onContextMenu} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Guide/ }), { clientX: 12, clientY: 34 });
    fireEvent.contextMenu(screen.getByRole("button", { name: /src/ }), { clientX: 56, clientY: 78 });
    expect(onContextMenu).toHaveBeenNthCalledWith(1, items[1], { x: 12, y: 34 });
    expect(onContextMenu).toHaveBeenNthCalledWith(2, items[3], { x: 56, y: 78 });
  });

  it("keeps nested folders closed in first-level mode", () => {
    render(<FileTree items={items} defaultOpen="first-level" />);
    expect(screen.getByText("Guide")).toBeVisible();
    expect(screen.queryByText("API")).not.toBeInTheDocument();
  });
});

describe("IconNav", () => {
  const items: NavItem[] = [
    { id: "files", name: "文件", icon: File },
    { id: "settings", name: "设置", icon: Settings, pinned: false },
    { id: "system", name: "系统", icon: Settings, group: "system" },
  ];

  it("selects pinned/system items and reveals overflow items on demand", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<IconNav items={items} activeId="files" onSelect={onSelect} />);
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "系统" }));
    expect(onSelect.mock.calls).toEqual([["settings"], ["system"]]);
  });

  it("restores a fresh persisted overflow state", async () => {
    mockedInvoke.mockResolvedValueOnce({ version: 1, open: true, updatedAt: Date.now() } as never);
    render(<IconNav items={items} activeId="files" onSelect={() => undefined} moreStateKey="nav.more" />);
    expect(await screen.findByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith("store_get", {
      namespace: "ui-state",
      key: "nav.more",
    });
  });

  it("deletes stale persisted overflow state", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ version: 1, open: true, updatedAt: 0 } as never)
      .mockResolvedValueOnce(undefined as never);
    render(<IconNav items={items} activeId="files" onSelect={() => undefined} moreStateKey="nav.more" />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("store_delete", {
      namespace: "ui-state",
      key: "nav.more",
    }));
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
  });

  it("persists uncontrolled changes but leaves controlled persistence to its owner", async () => {
    const user = userEvent.setup();
    const onMoreOpenChange = vi.fn();
    const { rerender } = render(
      <IconNav items={items} activeId="files" onSelect={() => undefined} moreStateKey="nav.more" />,
    );
    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(mockedInvoke).toHaveBeenCalledWith("store_set", expect.objectContaining({
      namespace: "ui-state",
      key: "nav.more",
      value: expect.objectContaining({ version: 1, open: true }),
    }));

    mockedInvoke.mockClear();
    rerender(
      <IconNav
        items={items}
        activeId="files"
        onSelect={() => undefined}
        moreStateKey="nav.more"
        moreOpen={false}
        onMoreOpenChange={onMoreOpenChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(onMoreOpenChange).toHaveBeenCalledWith(true);
    expect(mockedInvoke).not.toHaveBeenCalledWith("store_set", expect.anything());
  });
});

describe("ResizeHandle", () => {
  it("exposes separator orientation/value and snaps horizontal drag", () => {
    const onResize = vi.fn();
    render(
      <ResizeHandle direction="horizontal" size={200} minSize={120} snapTo={240} onResize={onResize} />,
    );
    const handle = screen.getByRole("separator", { name: "调整面板大小" });
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 137 });
    expect(onResize).toHaveBeenLastCalledWith(240);
    fireEvent.mouseUp(window);
    expect(document.body.style.userSelect).toBe("");
  });

  it("clamps at minimum and reverses delta from the start edge", () => {
    const onResize = vi.fn();
    render(
      <ResizeHandle direction="vertical" edge="start" size={200} minSize={150} onResize={onResize} />,
    );
    const handle = screen.getByRole("separator");
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    fireEvent.mouseDown(handle, { clientY: 100 });
    fireEvent.mouseMove(window, { clientY: 200 });
    expect(onResize).toHaveBeenLastCalledWith(150);
    fireEvent.mouseUp(window);
  });

  it("resets to the snap preset on double click", async () => {
    const user = userEvent.setup();
    const onResize = vi.fn();
    render(<ResizeHandle direction="horizontal" size={300} snapTo={208} onResize={onResize} />);
    await user.dblClick(screen.getByRole("separator"));
    expect(onResize).toHaveBeenCalledWith(208);
  });
});
