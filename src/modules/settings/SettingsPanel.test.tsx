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
    if (command === "get_workspace_info") {
      return Promise.resolve({ active_repo: null, recent_repos: [] });
    }
    if (command === "get_git_credentials") {
      return Promise.resolve({
        username: "octocat",
        email: "octocat@example.com",
        remote_url: "https://github.com/octocat/docs.git",
        token_masked: "••••••••",
        has_token: true,
        ssh_key_path: "~/.ssh/id_ed25519",
        has_ssh_passphrase: false,
      });
    }
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
  it("groups settings by data space and Git purpose", async () => {
    renderSettingsPanel();

    const trail = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(trail).getByText("软件数据")).toHaveAttribute("aria-current", "page");
    const pageTitle = screen.getByRole("banner", { name: "设置页标题" });
    expect(within(pageTitle).getByText("位置 · 远程仓库 · 同步策略")).toBeVisible();

    const settingsNavigation = screen.getByRole("navigation", { name: "设置分类" });
    const dataGroup = within(settingsNavigation).getByRole("group", { name: "数据空间" });
    const gitGroup = within(settingsNavigation).getByRole("group", { name: "Git" });
    const interfaceGroup = within(settingsNavigation).getByRole("group", { name: "界面" });
    expect(dataGroup).toBeVisible();
    expect(interfaceGroup).toBeVisible();
    expect(within(dataGroup).queryByRole("button", { name: "主笔记空间" })).toBeNull();
    expect(within(dataGroup).getByRole("button", { name: "软件数据" })).toBeVisible();
    expect(within(dataGroup).queryByRole("button", { name: "已打开仓库" })).toBeNull();
    expect(within(gitGroup).getByRole("button", { name: "全局提交身份" })).toBeVisible();
    expect(within(gitGroup).getByRole("button", { name: "已打开仓库" })).toBeVisible();
    expect(within(interfaceGroup).getByRole("button", { name: "侧边栏" })).toBeVisible();
    expect(within(interfaceGroup).queryByRole("button", { name: "全局提交身份" })).toBeNull();
    expect(within(settingsNavigation).getByRole("button", { name: "软件数据" }))
      .toHaveAttribute("aria-current", "page");
    expect(within(settingsNavigation).getByRole("button", { name: "全局提交身份" })).toBeVisible();
    expect(within(settingsNavigation).getByRole("button", { name: "已打开仓库" })).toBeVisible();
    expect(within(settingsNavigation).getByRole("button", { name: "侧边栏" })).toBeVisible();
    expect(settingsNavigation.querySelector("svg")).toBeNull();
    expect(screen.getByRole("heading", { name: "软件数据位置" })).toBeVisible();
    expect(screen.getByText("Note Aura 产生的设置、环境、插件状态和运行记录统一存放在这里，并可独立同步。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "远程仓库" })).toBeVisible();
    const remoteSection = screen.getByRole("heading", { name: "远程仓库" }).closest("section");
    expect(remoteSection).not.toBeNull();
    expect(within(remoteSection!).queryByText("软件数据")).toBeNull();
    expect(screen.queryByRole("heading", { name: "数据环境" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "同步策略" })).toBeNull();
    expect(await screen.findByRole("combobox", { name: "远程仓库" })).toBeVisible();
    expect(screen.queryByLabelText("仓库 URL")).toBeNull();
    expect(screen.queryByLabelText("Access Token")).toBeNull();
    expect(screen.queryByText("命名空间")).toBeNull();
    expect(screen.queryByText(/profile/i)).toBeNull();
    expect(screen.queryByText("主笔记空间")).toBeNull();
    expect(screen.queryByRole("switch", { name: "自动同步软件数据" })).toBeNull();

    await userEvent.click(within(settingsNavigation).getByRole("button", { name: "侧边栏" }));
    expect(within(trail).getByText("侧边栏")).toHaveAttribute("aria-current", "page");
    expect(within(pageTitle).getByText("入口顺序与显示")).toBeVisible();
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

  it("manages the global Git identity and repository access defaults", async () => {
    const user = userEvent.setup();
    renderSettingsPanel();

    const settingsNavigation = screen.getByRole("navigation", { name: "设置分类" });
    await user.click(within(settingsNavigation).getByRole("button", { name: "全局提交身份" }));

    const trail = screen.getByRole("navigation", { name: "当前位置" });
    expect(within(trail).getByText("Git")).toBeVisible();
    expect(within(trail).getByText("全局提交身份")).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("banner", { name: "设置页标题" }))
      .getByText("用户名 · 邮箱 · 默认访问")).toBeVisible();
    expect(screen.getByRole("heading", { name: "全局提交身份" })).toBeVisible();
    expect(screen.getByText("未设置仓库提交身份时使用")).toBeVisible();

    const username = await screen.findByLabelText("用户名");
    const email = screen.getByLabelText("邮箱");
    expect(username).toHaveValue("octocat");
    expect(email).toHaveValue("octocat@example.com");

    await user.clear(username);
    await user.type(username, "new-user");
    await user.clear(email);
    await user.type(email, "new@example.com");
    await user.click(screen.getByRole("button", { name: "保存身份" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("set_git_username", { username: "new-user" });
    });
    expect(mockedInvoke).toHaveBeenCalledWith("set_git_email", { email: "new@example.com" });

    await user.click(screen.getByText("默认访问与凭据"));
    expect(screen.getByRole("heading", { name: "默认远端" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "默认 HTTPS 凭据" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "默认 SSH 凭据" })).toBeVisible();

    const remoteUrl = screen.getByLabelText("仓库 URL");
    await user.clear(remoteUrl);
    await user.type(remoteUrl, "https://github.com/octocat/draft.git");
    expect(remoteUrl).toHaveValue("https://github.com/octocat/draft.git");

    const token = screen.getByLabelText("Access Token");
    await user.type(token, "token-123");
    const tokenSection = screen.getByRole("heading", { name: "默认 HTTPS 凭据" }).closest("section");
    expect(tokenSection).not.toBeNull();
    await user.click(within(tokenSection!).getByRole("button", { name: "保存" }));
    expect(mockedInvoke).toHaveBeenCalledWith("set_git_token", { token: "token-123" });
  });

  it("keeps Git drafts while moving between settings sections", async () => {
    const user = userEvent.setup();
    renderSettingsPanel();

    const settingsNavigation = screen.getByRole("navigation", { name: "设置分类" });
    await user.click(within(settingsNavigation).getByRole("button", { name: "全局提交身份" }));

    const username = await screen.findByLabelText("用户名");
    await user.clear(username);
    await user.type(username, "draft-user");
    await user.click(within(settingsNavigation).getByRole("button", { name: "侧边栏" }));
    await user.click(within(settingsNavigation).getByRole("button", { name: "全局提交身份" }));

    expect(await screen.findByLabelText("用户名")).toHaveValue("draft-user");
  });

  it("shows the actual usage of each configured repository", async () => {
    mockedInvoke.mockImplementation((command) => {
      if (command === "sync_get_config") return Promise.resolve(null);
      if (command === "get_data_center_config_credential_status") {
        return Promise.resolve({ has_token: false, token_masked: null });
      }
      if (command === "sync_list_environments") return Promise.resolve(["default"]);
      if (command === "get_workspace_info") {
        return Promise.resolve({ active_repo: null, recent_repos: [] });
      }
      if (command === "get_git_credentials") {
        return Promise.resolve({
          username: null,
          email: null,
          remote_url: null,
          token_masked: null,
          has_token: false,
          ssh_key_path: null,
          has_ssh_passphrase: false,
        });
      }
      if (command === "get_remote_configs") {
        return Promise.resolve([
          {
            name: "origin",
            url: "https://github.com/example/current.git",
            push_url: null,
            repo_path: "/repo/current",
            source: "local_git_config",
            purpose: ["current_repo_remote", "data_center_sync"],
            credential_mode: "repo_token",
            credential_ref: null,
            commit_name: null,
            commit_email: null,
            verify_status: "configured",
            capabilities: "unknown",
          },
          {
            name: "upstream",
            url: "https://github.com/example/upstream.git",
            push_url: null,
            repo_path: "/repo/current",
            source: "local_git_config",
            purpose: ["current_repo_remote"],
            credential_mode: "repo_token",
            credential_ref: null,
            commit_name: null,
            commit_email: null,
            verify_status: "configured",
            capabilities: "unknown",
          },
          {
            name: "origin",
            url: "https://github.com/example/saved.git",
            push_url: null,
            repo_path: "/repo/saved",
            source: "local_git_config",
            purpose: ["bound_repo_remote"],
            credential_mode: "none",
            credential_ref: null,
            commit_name: null,
            commit_email: null,
            verify_status: "unverified",
            capabilities: "unknown",
          },
        ]);
      }
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    renderSettingsPanel();

    const settingsNavigation = screen.getByRole("navigation", { name: "设置分类" });
    await user.click(within(settingsNavigation).getByRole("button", { name: "已打开仓库" }));

    expect(within(screen.getByRole("banner", { name: "设置页标题" }))
      .getByText("远端 · 仓库提交身份 · 凭据")).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "当前位置" })).getByText("Git")).toBeVisible();
    expect(screen.getByRole("heading", { name: "已打开仓库" })).toBeVisible();

    expect((await screen.findAllByText("使用情况"))).toHaveLength(2);
    expect(screen.getByText("当前工作仓库")).toBeVisible();
    expect(screen.getByText("空间同步")).toBeVisible();
    expect(screen.getByText("未关联")).toBeVisible();
    expect(screen.getByText("/repo/current")).toBeVisible();
    expect(screen.getByText("2 个远端")).toBeVisible();
    expect(screen.getByText("upstream")).toBeVisible();
    expect(screen.queryByText("当前仓库 remote")).toBeNull();
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
    const bindButton = screen.getByRole("button", { name: "绑定" });
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

  it("switches the software data environment through the sync repository API", async () => {
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

    const space = await screen.findByLabelText("当前环境");
    await user.selectOptions(space, "staging");

    expect(mockedInvoke).toHaveBeenCalledWith("sync_switch_environment", {
      environmentId: "staging",
    });
  });

  it("creates and activates a new software data environment", async () => {
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

    const createEntry = await screen.findByRole("button", { name: "新建环境" });
    await waitFor(() => expect(createEntry).toBeEnabled());
    await user.click(createEntry);
    await user.type(screen.getByLabelText("环境名称"), "staging");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(mockedInvoke).toHaveBeenCalledWith("sync_create_space", { spaceId: "staging" });
    expect(screen.getByLabelText("当前环境")).toHaveValue("staging");
    expect(screen.getByRole("option", { name: "staging" })).toBeVisible();
  });
});
