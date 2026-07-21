import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachment, scanReport } from "../../test/fixtures";
import type { GitHubImageLibrary, GitRemoteConfigEntry } from "../../types";
import { GitHubImagePanel } from "./GitHubImagePanel";

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
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "get_remote_configs") return [remote] as never;
    if (command === "store_get") return { version: 3, libraries: [library] } as never;
    return null as never;
  });
});

describe("GitHubImagePanel", () => {
  it("keeps library management at the root and migration on a secondary page", async () => {
    const report = scanReport([
      attachment({ path: "assets/one.png" }),
      attachment({ path: "assets/two.png" }),
      attachment({ path: "assets/orphan.png", references: [] }),
    ]);
    render(<GitHubImagePanel report={report} onCompleted={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "图库" })).toBeInTheDocument());
    expect(screen.getByText("文档图库")).toBeInTheDocument();
    expect(screen.queryByText("待迁移图片")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "迁移图片" }));
    expect(screen.getByRole("heading", { name: "图片迁移 · 文档图库" })).toBeInTheDocument();
    expect(screen.getByText("待迁移图片")).toBeInTheDocument();
    expect(screen.getByText("assets/one.png")).toBeInTheDocument();
  });

  it("opens repository management as a secondary page", async () => {
    render(<GitHubImagePanel report={null} onCompleted={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("文档图库")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("管理图库仓库"));
    expect(screen.getByRole("heading", { name: "图库仓库" })).toBeInTheDocument();
    expect(screen.getByText("选择 Git 远程")).toBeInTheDocument();
  });
});
