import { expect, test as base, type Page } from "@playwright/test";

interface InvokeCall {
  cmd: string;
  args: Record<string, unknown>;
}

interface TauriHarness {
  calls: () => Promise<InvokeCall[]>;
  callsFor: (command: string) => Promise<InvokeCall[]>;
}

type MockWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  __GT_TAURI_CALLS__: InvokeCall[];
  __GT_FAIL_REPO__?: boolean;
};

const test = base.extend<{ tauri: TauriHarness }>({
  tauri: async ({ page }, use) => {
    await installTauriHarness(page);
    await use({
      calls: () => page.evaluate(() => (window as unknown as MockWindow).__GT_TAURI_CALLS__),
      callsFor: (command) => page.evaluate(
        (target) => (window as unknown as MockWindow).__GT_TAURI_CALLS__.filter((call) => call.cmd === target),
        command,
      ),
    });
  },
});

async function installTauriHarness(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as MockWindow;
    target.__GT_TAURI_CALLS__ = [];
    const overview = {
      path: "/workspaces/notes",
      current_branch: "main",
      is_dirty: true,
      changed_count: 2,
      remote_url: "https://example.test/notes.git",
    };
    const responses: Record<string, unknown> = {
      extension_list: [],
      store_get: null,
      store_set: null,
      store_delete: null,
      get_workspace_info: {
        active_repo: "/workspaces/notes",
        recent_repos: ["/workspaces/notes", "/workspaces/archive"],
        device_id: "test-device",
        device_name: "Playwright",
      },
      open_repo: overview,
      get_overview: overview,
      get_status: [
        { path: "README.md", kind: "Modified", staged: false },
        { path: "src/app.ts", kind: "Added", staged: true },
      ],
      get_file_diff: {
        path: "README.md",
        patch: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old title\n+new title",
        additions: 1,
        deletions: 1,
      },
      commit_all: {
        id: "0123456789abcdef",
        short_id: "0123456",
        message: "test: browser journey",
        author: "Playwright",
        time: "2026-07-21T00:00:00Z",
      },
      flow_list: [],
      flow_list_folders: [],
      flow_event_catalog: [],
      flow_node_catalog: [],
      store_namespaces: [{ name: "settings", count: 2, visibility: "public" }],
      store_list_environments: ["default"],
      store_active_environment: "default",
      get_data_center_config_credential_status: {
        has_token: true,
        token_masked: "***",
        credential_ref: "data-center-config-token",
      },
      sync_get_config: {
        url: "https://example.test/notes.git",
        branch: "main",
        active_environment_id: "default",
        local_database_path: "/workspaces/data-sync",
        auto_sync: true,
        interval_seconds: 300,
      },
      sync_list_environments: ["default"],
      check_data_center_config_repo: {
        ok: true,
        status: "valid",
        message: "连接成功",
        default_branch: "main",
        refs_count: 1,
      },
      get_remote_configs: [{
        name: "origin",
        url: "https://example.test/notes.git",
        push_url: null,
        repo_path: "/workspaces/notes",
        source: "local_git_config",
        purpose: ["current_repo_remote"],
        credential_mode: "repo_token",
        credential_ref: "repo:/workspaces/notes",
        commit_name: "Playwright",
        commit_email: "playwright@example.test",
        verify_status: "configured",
        capabilities: "unknown",
      }],
      store_entries: [
        { key: "theme", value: "dark" },
        { key: "editor.font_size", value: 14 },
      ],
      plugin_market_list: [],
      get_branches: [
        { name: "main", is_head: true, is_remote: false },
        { name: "feature/test", is_head: false, is_remote: false },
      ],
      get_log: [],
    };

    target.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        target.__GT_TAURI_CALLS__.push({ cmd: command, args });
        if (target.__GT_FAIL_REPO__ && ["get_workspace_info", "open_repo", "get_overview"].includes(command)) {
          throw new Error("repository unavailable");
        }
        if (command === "get_file_diff") {
          return { ...(responses[command] as object), path: String(args.path ?? "") };
        }
        if (command === "commit_selected") {
          return { ...(responses.commit_all as object), message: String(args.message ?? "") };
        }
        if (command === "commit_all") {
          return { ...(responses.commit_all as object), message: String(args.message ?? "") };
        }
        return responses[command] ?? null;
      },
    };
  });
}

test("boots into Git changes without duplicate shell requests", async ({ page, tauri }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");

  await expect(page.getByText("main", { exact: true })).toBeVisible();
  await expect(page.getByText("2 变更")).toBeVisible();
  await expect(page.getByText("README.md", { exact: true })).toBeVisible();
  await expect(page.getByText("app.ts", { exact: true })).toBeVisible();
  expect(await tauri.callsFor("open_repo")).toHaveLength(1);
  expect(await tauri.callsFor("get_status")).toHaveLength(1);
  expect(runtimeErrors).toEqual([]);
});

test("loads a diff only after file selection", async ({ page, tauri }) => {
  await page.goto("/");
  await expect(page.getByText("README.md", { exact: true })).toBeVisible();
  expect(await tauri.callsFor("get_file_diff")).toHaveLength(0);

  await page.getByText("README.md", { exact: true }).click();
  await expect(page.getByText("old title", { exact: true })).toBeVisible();
  await expect(page.getByText("new title", { exact: true })).toBeVisible();
  expect(await tauri.callsFor("get_file_diff")).toEqual([{
    cmd: "get_file_diff",
    args: { path: "README.md" },
  }]);
});

test("commits the selected working tree and refreshes repository context", async ({ page, tauri }) => {
  await page.goto("/");
  const message = page.getByPlaceholder("提交信息…");
  await expect(message).toBeVisible();
  await message.fill("test: browser journey");
  await page.getByRole("button", { name: /全部/ }).click();

  await expect.poll(async () => (await tauri.callsFor("commit_all")).length).toBe(1);
  expect(await tauri.callsFor("commit_all")).toEqual([{
    cmd: "commit_all",
    args: { message: "test: browser journey" },
  }]);
  expect((await tauri.callsFor("get_overview")).length).toBeGreaterThanOrEqual(1);
});

test("loads Git history and branches only when their views become active", async ({ page, tauri }) => {
  await page.goto("/");
  await expect(page.getByText("2 变更")).toBeVisible();
  expect(await tauri.callsFor("get_log")).toHaveLength(0);
  expect(await tauri.callsFor("get_branches")).toHaveLength(0);

  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByText("0 条提交")).toBeVisible();
  expect(await tauri.callsFor("get_log")).toEqual([{
    cmd: "get_log",
    args: { limit: 50 },
  }]);

  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("button", { name: "分支" }).click();
  await expect(page.getByText("feature/test", { exact: true })).toBeVisible();
  expect(await tauri.callsFor("get_branches")).toHaveLength(1);
});

test("navigates across Flow, data sync settings, and plugin management", async ({ page, tauri }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Flow" }).click();
  await expect(page.getByText("Flow:0", { exact: false })).toBeVisible();
  await expect(page.getByText(/还没有 Flow/)).toBeVisible();

  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "远程仓库" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据空间" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "远程仓库" })).toHaveValue("/workspaces/notes::origin");
  await expect(page.getByRole("option", { name: "notes / origin" })).toBeAttached();
  await expect(page.getByRole("button", { name: "直接绑定" })).toBeVisible();
  await page.getByRole("button", { name: "新建空间" }).click();
  await page.getByRole("textbox", { name: "空间名称" }).fill("staging");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "当前空间" })).toHaveValue("staging");
  expect(await tauri.callsFor("sync_create_space")).toEqual([{
    cmd: "sync_create_space",
    args: { spaceId: "staging" },
  }]);
  expect(await tauri.callsFor("store_namespaces")).toHaveLength(0);

  await page.getByRole("button", { name: "插件" }).click();
  await expect(page.getByText(/插件/).first()).toBeVisible();
  await expect(page.getByText(/暂无|没有/).first()).toBeVisible();
});

test("configures primary sidebar visibility from settings", async ({ page, tauri }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("设置");
  const settingsNavigation = page.getByRole("navigation", { name: "设置分类" });
  await expect(settingsNavigation.getByRole("button", { name: "侧边栏" })).toBeVisible();
  await expect(settingsNavigation.locator("svg")).toHaveCount(0);
  await settingsNavigation.getByRole("button", { name: "侧边栏" }).click();
  await expect(page.getByText("主导航", { exact: true })).toBeVisible();
  await expect(page.getByText("底部功能", { exact: true })).toBeVisible();

  await page.getByRole("switch", { name: "隐藏 Flow" }).click();
  await expect(page.getByTestId("primary-sidebar").getByRole("button", { name: "Flow" })).toHaveCount(0);
  await expect.poll(async () => (
    await tauri.callsFor("store_set")
  ).some((call) => call.args.key === "app.sidebar.preferences")).toBe(true);

  await page.getByRole("switch", { name: "显示 Flow" }).click();
  await expect(page.getByTestId("primary-sidebar").getByRole("button", { name: "Flow" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "隐藏 设置" })).toBeDisabled();
});

test("degrades to the repository empty state when backend context is unavailable", async ({ page, tauri }) => {
  await page.addInitScript(() => {
    (window as unknown as MockWindow).__GT_FAIL_REPO__ = true;
  });
  await page.goto("/");
  await expect(page.getByText("打开一个 Git 仓库开始工作")).toBeVisible();
  await expect(page.getByText("选择一个 Git 仓库开始")).toBeVisible();
  expect((await tauri.calls()).some((call) => call.cmd === "get_workspace_info")).toBe(true);
});

test("dismisses sidebar tooltips when the pointer enters the work area", async ({ page }) => {
  await page.goto("/");
  const tooltip = page.locator('[data-slot="tooltip-content"]');

  const primaryTrigger = page.getByRole("button", { name: "插件" });
  await primaryTrigger.hover();
  await expect(tooltip).toContainText("插件");
  const primaryBox = await primaryTrigger.boundingBox();
  expect(primaryBox).not.toBeNull();
  await page.mouse.move(420, primaryBox!.y + primaryBox!.height / 2);
  await expect(tooltip).toHaveCount(0);

  const secondaryTrigger = page.getByRole("button", { name: "历史" });
  await secondaryTrigger.hover();
  await expect(tooltip).toContainText("历史");
  const secondaryBox = await secondaryTrigger.boundingBox();
  expect(secondaryBox).not.toBeNull();
  await page.mouse.move(420, secondaryBox!.y + secondaryBox!.height / 2);
  await expect(tooltip).toHaveCount(0);
});
