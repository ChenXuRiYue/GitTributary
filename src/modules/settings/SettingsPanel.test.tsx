import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Blocks, Database, GitBranch, Settings, Workflow } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  SidebarPreferencesProvider,
  type SidebarPreferencesController,
} from "@/app/SidebarPreferencesContext";
import type { SidebarItemInfo } from "@/app/sidebarPreferences";
import { SettingsPanel } from "./SettingsPanel";

const items: SidebarItemInfo[] = [
  {
    id: "git",
    name: "Git",
    description: "状态、差异、提交、分支与远端。",
    icon: GitBranch,
    group: "main",
    kind: "core",
    canHide: true,
  },
  {
    id: "flow",
    name: "Flow",
    description: "事件、节点与任务编排。",
    icon: Workflow,
    group: "main",
    kind: "core",
    canHide: true,
  },
  {
    id: "store",
    name: "数据",
    description: "配置浏览、环境切换与远程同步。",
    icon: Database,
    group: "main",
    kind: "core",
    canHide: true,
  },
  {
    id: "plugins",
    name: "插件",
    description: "安装、更新和管理插件。",
    icon: Blocks,
    group: "system",
    kind: "function",
    canHide: true,
  },
  {
    id: "settings",
    name: "设置",
    description: "调整界面与行为。",
    icon: Settings,
    group: "system",
    kind: "function",
    canHide: false,
  },
];

function renderSettingsPanel() {
  const controller: SidebarPreferencesController = {
    items,
    isVisible: vi.fn((id: string) => id !== "flow"),
    setVisible: vi.fn(),
    move: vi.fn(),
    reorder: vi.fn(),
    reset: vi.fn(),
  };
  const result = render(
    <SidebarPreferencesProvider value={controller}>
      <SettingsPanel />
    </SidebarPreferencesProvider>,
  );
  return { ...result, controller };
}

describe("SettingsPanel", () => {
  it("renders a text-only settings navigation and groups sidebar entries", () => {
    renderSettingsPanel();

    const trail = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(trail).getByText("侧边栏")).toHaveAttribute("aria-current", "page");

    const settingsNavigation = screen.getByRole("navigation", { name: "设置分类" });
    expect(within(settingsNavigation).getByRole("button", { name: "侧边栏" }))
      .toHaveAttribute("aria-current", "page");
    expect(settingsNavigation.querySelector("svg")).toBeNull();
    expect(screen.getByText("显示:4 / 5")).toBeVisible();

    const mainSection = screen.getByRole("heading", { name: "主导航" }).closest("section");
    const systemSection = screen.getByRole("heading", { name: "底部功能" }).closest("section");
    expect(mainSection).not.toBeNull();
    expect(systemSection).not.toBeNull();
    expect(within(mainSection!).getByText("3 项")).toBeVisible();
    expect(within(mainSection!).getByText("Git")).toBeVisible();
    expect(within(mainSection!).getByText("Flow")).toBeVisible();
    expect(within(mainSection!).getByText("数据")).toBeVisible();
    expect(within(systemSection!).getByText("2 项")).toBeVisible();
    expect(within(systemSection!).getByText("插件")).toBeVisible();
    expect(within(systemSection!).getByText("设置")).toBeVisible();
  });

  it("forwards visibility, move, and reset actions while protecting fixed entries", async () => {
    const user = userEvent.setup();
    const { controller } = renderSettingsPanel();

    await user.click(screen.getByRole("switch", { name: "显示 Flow" }));
    await user.click(screen.getByRole("button", { name: "上移 Flow" }));
    await user.click(screen.getByRole("button", { name: "下移 Flow" }));
    await user.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(controller.setVisible).toHaveBeenCalledWith("flow", true);
    expect(controller.move).toHaveBeenCalledTimes(2);
    expect(controller.move).toHaveBeenNthCalledWith(1, "flow", "up");
    expect(controller.move).toHaveBeenNthCalledWith(2, "flow", "down");
    expect(controller.reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("switch", { name: "隐藏 设置" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上移 Git" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移 数据" })).toBeDisabled();
  });

  it("reorders entries when a dragged row is dropped on another row", () => {
    const { container, controller } = renderSettingsPanel();
    const gitRow = container.querySelector('[data-sidebar-item="git"]');
    const flowRow = container.querySelector('[data-sidebar-item="flow"]');
    expect(gitRow).not.toBeNull();
    expect(flowRow).not.toBeNull();
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
    };

    fireEvent.dragStart(gitRow!, { dataTransfer });
    fireEvent.dragOver(flowRow!, { dataTransfer });
    fireEvent.drop(flowRow!, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "git");
    expect(controller.reorder).toHaveBeenCalledWith("git", "flow");
  });
});
