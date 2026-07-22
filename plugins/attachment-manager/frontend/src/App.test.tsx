import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { attachment, scanReport } from "./test/fixtures";
import type { GitHubImageLibrary, GitHubImageMigrationReport, GitRemoteConfigEntry } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const library: GitHubImageLibrary = {
  id: "library",
  name: "文档图库",
  remote: { repoPath: "/fixtures/notes", name: "image-cloud", url: "https://github.com/octocat/images.git" },
  branch: "main",
  directory: "images",
};
const remote: GitRemoteConfigEntry = {
  name: "image-cloud",
  url: library.remote!.url,
  push_url: null,
  repo_path: library.remote!.repoPath,
  source: "local_git_config",
  purpose: ["current_repo_remote"],
  credential_mode: "repo_token",
  credential_ref: "repo:/fixtures/notes",
  commit_name: null,
  commit_email: null,
  verify_status: "unverified",
  capabilities: "unknown",
};

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "get_workspace_info") return { active_repo: "/fixtures/notes" } as never;
    if (command === "attachments_scan") return scanReport([attachment()]) as never;
    if (command === "attachments_read_preview") return null as never;
    if (command === "get_remote_configs") return [remote] as never;
    if (command === "store_get") return { version: 3, libraries: [library] } as never;
    return null as never;
  });
});

describe("attachment manager navigation", () => {
  it("exposes gallery settings and attachment migration as separate secondary pages", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "图库配置" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "图库配置" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "图库配置" })).toBeInTheDocument());
    expect(screen.queryByText("待迁移图片")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "附件迁移" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "附件迁移" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("待迁移图片")).toBeInTheDocument());
  });

  it("keeps a migration running while the user visits another module", async () => {
    let resolveMigration: (report: GitHubImageMigrationReport) => void = () => undefined;
    const pendingMigration = new Promise<GitHubImageMigrationReport>((resolve) => {
      resolveMigration = resolve;
    });
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "get_workspace_info") return { active_repo: "/fixtures/notes" } as never;
      if (command === "attachments_scan") return scanReport([attachment()]) as never;
      if (command === "attachments_read_preview") return null as never;
      if (command === "get_remote_configs") return [remote] as never;
      if (command === "store_get") return { version: 3, libraries: [library] } as never;
      if (command === "attachments_migrate_github_images") return pendingMigration as never;
      return null as never;
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "附件迁移" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "附件迁移" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开始迁移" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始迁移" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认附件迁移" }))
      .getByRole("button", { name: "确认迁移" }));
    expect(await screen.findByText("任务详情")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("1 张图片 · 1 篇 Markdown")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "图库配置" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "图库配置" })).toBeInTheDocument());
    resolveMigration({
      migrated: [{
        localPath: "assets/image.png",
        remotePath: "images/hash.png",
        url: "https://raw.githubusercontent.com/octocat/images/main/images/hash.png",
        uploaded: true,
      }],
      failed: [],
      failedNotes: [],
      failedDeletes: [],
      changedNotePaths: ["README.md"],
      deletedLocalPaths: [],
      changedNotes: 1,
      replacedReferences: 1,
      durationMs: 20,
    });
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith(
      "attachments_migrate_github_images",
      expect.anything(),
    ));

    fireEvent.click(screen.getByRole("button", { name: "附件迁移" }));
    expect(await screen.findByText("迁移已完成")).toBeInTheDocument();
    expect(screen.getByText("成功")).toBeInTheDocument();
    const changedNotes = screen.getByText("已修改 Markdown").closest("section");
    expect(changedNotes).not.toBeNull();
    expect(within(changedNotes!).getByText("README.md")).toBeInTheDocument();
  });
});
