import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Blocks, GitBranch, Settings, Workflow } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SidebarPreferencesProvider,
  type SidebarPreferencesController,
} from "@/app/SidebarPreferencesContext";
import type { SidebarItemInfo } from "@/app/sidebarPreferences";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

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

beforeEach(() => {
  mockedInvoke.mockImplementation((command) => {
    if (command === "sync_get_config") return Promise.resolve(null);
    if (command === "get_data_center_config_credential_status") {
      return Promise.resolve({ has_token: false, token_masked: null });
    }
    if (command === "sync_list_environments") return Promise.resolve(["default"]);
    if (command === "get_remote_configs") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

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
  it("opens data sync as a concise settings category", async () => {
    renderSettingsPanel();

    const trail = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(trail).getByText("数据同步")).toHaveAttribute("aria-current", "page");

    const settingsNavigation = screen.getByRole("navigation", { name: "设置分类" });
    expect(within(settingsNavigation).getByRole("button", { name: "数据同步" }))
      .toHaveAttribute("aria-current", "page");
    expect(within(settingsNavigation).getByRole("button", { name: "侧边栏" })).toBeVisible();
    expect(settingsNavigation.querySelector("svg")).toBeNull();
    expect(screen.getByRole("heading", { name: "远程仓库" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "数据空间" })).toBeVisible();
    expect(await screen.findByRole("combobox", { name: "远程仓库" })).toBeVisible();
    expect(screen.queryByLabelText("仓库 URL")).toBeNull();
    expect(screen.queryByLabelText("Access Token")).toBeNull();
    expect(screen.queryByText("命名空间")).toBeNull();
    expect(screen.queryByText(/profile/i)).toBeNull();

    await userEvent.click(within(settingsNavigation).getByRole("button", { name: "侧边栏" }));
    expect(within(trail).getByText("侧边栏")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("显示:3 / 4")).toBeVisible();

    const mainSection = screen.getByRole("heading", { name: "主导航" }).closest("section");
    const systemSection = screen.getByRole("heading", { name: "底部功能" }).closest("section");
    expect(mainSection).not.toBeNull();
    expect(systemSection).not.toBeNull();
    expect(within(mainSection!).getByText("2 项")).toBeVisible();
    expect(within(mainSection!).getByText("Git")).toBeVisible();
    expect(within(mainSection!).getByText("Flow")).toBeVisible();
    expect(within(systemSection!).getByText("2 项")).toBeVisible();
    expect(within(systemSection!).getByText("插件")).toBeVisible();
    expect(within(systemSection!).getByText("设置")).toBeVisible();
  });

  it("forwards visibility, move, and reset actions while protecting fixed entries", async () => {
    const user = userEvent.setup();
    const { controller } = renderSettingsPanel();
    await user.click(screen.getByRole("button", { name: "侧边栏" }));

    await user.click(screen.getByRole("switch", { name: "显示 Flow" }));
    await user.click(screen.getByRole("button", { name: "上移 Flow" }));
    await user.click(screen.getByRole("button", { name: "下移 Flow" }));
    await user.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(controller.setVisible).toHaveBeenCalledWith("flow", true);
    expect(controller.move).toHaveBeenCalledOnce();
    expect(controller.move).toHaveBeenCalledWith("flow", "up");
    expect(controller.reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("switch", { name: "隐藏 设置" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上移 Git" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移 Flow" })).toBeDisabled();
  });

  it("reorders entries when a dragged row is dropped on another row", () => {
    const { container, controller } = renderSettingsPanel();
    fireEvent.click(screen.getByRole("button", { name: "侧边栏" }));
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

  it("binds an existing remote repository without exposing credentials", async () => {
    mockedInvoke.mockImplementation((command) => {
      if (command === "sync_get_config") return Promise.resolve(null);
      if (command === "get_data_center_config_credential_status") {
        return Promise.resolve({ has_token: false, token_masked: null });
      }
      if (command === "sync_list_environments") return Promise.resolve(["default"]);
      if (command === "get_remote_configs") {
        return Promise.resolve([{
          name: "origin",
          url: "https://github.com/example/data.git",
          repo_path: "/repo/data",
          source: "local_git_config",
          credential_mode: "repo_token",
        }]);
      }
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    renderSettingsPanel();

    const repository = await screen.findByRole("combobox", { name: "远程仓库" });
    expect(repository).toHaveValue("/repo/data::origin");
    const bindButton = screen.getByRole("button", { name: "绑定所选" });
    await waitFor(() => expect(bindButton).toBeEnabled());
    await user.click(bindButton);

    expect(mockedInvoke).toHaveBeenCalledWith("bind_data_center_config_remote", {
      repoPath: "/repo/data",
      remoteName: "origin",
    });
    expect(screen.queryByText("本地工作副本")).toBeNull();
    expect(screen.queryByLabelText("分支")).toBeNull();
    expect(screen.queryByLabelText("Access Token")).toBeNull();
  });

  it("binds a repository directly without requiring a configured remote", async () => {
    mockedInvoke.mockImplementation((command) => {
      if (command === "sync_get_config") return Promise.resolve(null);
      if (command === "get_data_center_config_credential_status") {
        return Promise.resolve({ has_token: false, token_masked: null });
      }
      if (command === "sync_list_environments") return Promise.resolve(["default"]);
      if (command === "get_remote_configs") return Promise.resolve([]);
      if (command === "check_data_center_config_repo") {
        return Promise.resolve({ ok: true, message: "连接成功", default_branch: "main" });
      }
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    renderSettingsPanel();

    await user.click(await screen.findByRole("button", { name: "直接绑定" }));
    await user.type(screen.getByLabelText("仓库地址"), "https://github.com/example/data.git");
    await user.type(screen.getByLabelText("Access Token"), "token-123");
    await user.click(screen.getByRole("button", { name: "确认绑定" }));

    expect(mockedInvoke).toHaveBeenCalledWith("check_data_center_config_repo", {
      url: "https://github.com/example/data.git",
      token: "token-123",
    });
    expect(mockedInvoke).toHaveBeenCalledWith("update_data_center_config_remote", {
      config: {
        url: "https://github.com/example/data.git",
        branch: "main",
        active_environment_id: "default",
        local_database_path: null,
        auto_sync: true,
        interval_seconds: 300,
      },
      token: "token-123",
      clearToken: false,
    });
  });

  it("switches the data space through the sync repository API", async () => {
    mockedInvoke.mockImplementation((command) => {
      if (command === "sync_get_config") {
        return Promise.resolve({
          url: "https://github.com/example/data.git",
          branch: "main",
          active_environment_id: "default",
          local_database_path: null,
          auto_sync: true,
          interval_seconds: 300,
        });
      }
      if (command === "get_data_center_config_credential_status") {
        return Promise.resolve({ has_token: true, token_masked: "***" });
      }
      if (command === "sync_list_environments") return Promise.resolve(["default", "staging"]);
      if (command === "get_remote_configs") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    renderSettingsPanel();

    const space = await screen.findByLabelText("当前空间");
    await user.selectOptions(space, "staging");

    expect(mockedInvoke).toHaveBeenCalledWith("sync_switch_environment", {
      environmentId: "staging",
    });
  });

  it("creates and activates a new data space", async () => {
    mockedInvoke.mockImplementation((command) => {
      if (command === "sync_get_config") {
        return Promise.resolve({
          url: "https://github.com/example/data.git",
          branch: "main",
          active_environment_id: "default",
          local_database_path: null,
          auto_sync: true,
          interval_seconds: 300,
        });
      }
      if (command === "get_data_center_config_credential_status") {
        return Promise.resolve({ has_token: true, token_masked: "***" });
      }
      if (command === "sync_list_environments") return Promise.resolve(["default"]);
      if (command === "get_remote_configs") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    renderSettingsPanel();

    const createEntry = await screen.findByRole("button", { name: "新建空间" });
    await waitFor(() => expect(createEntry).toBeEnabled());
    await user.click(createEntry);
    await user.type(screen.getByLabelText("空间名称"), "staging");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(mockedInvoke).toHaveBeenCalledWith("sync_create_space", { spaceId: "staging" });
    expect(screen.getByLabelText("当前空间")).toHaveValue("staging");
    expect(screen.getByRole("option", { name: "staging" })).toBeVisible();
  });
});
