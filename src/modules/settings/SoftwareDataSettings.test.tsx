import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SoftwareDataSettings } from "./SoftwareDataSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockImplementation((command) => {
    if (command === "sync_get_config") {
      return Promise.resolve({
        url: "https://github.com/example/config.git",
        branch: "main",
        active_environment_id: "default",
        local_database_path: "/Users/example/.noteaura/databases/config",
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
});

describe("SoftwareDataSettings", () => {
  it("saves the software data sync strategy", async () => {
    const user = userEvent.setup();
    render(<SoftwareDataSettings />);

    expect(await screen.findByText("/Users/example/.noteaura/databases/config")).toBeVisible();
    await user.click(screen.getByRole("switch", { name: "自动同步软件数据" }));
    const interval = screen.getByRole("spinbutton", { name: "同步间隔" });
    fireEvent.change(interval, { target: { value: "600" } });
    await user.click(screen.getByRole("button", { name: "保存策略" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("sync_set_config", {
        config: expect.objectContaining({ auto_sync: false, interval_seconds: 600 }),
      });
    });
  });
});
