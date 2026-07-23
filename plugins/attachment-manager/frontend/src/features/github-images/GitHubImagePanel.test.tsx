import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachment, scanReport } from "../../test/fixtures";
import type {
  GitHubImageLibrary,
  GitHubImageMigrationReport,
  GitRemoteConfigEntry,
} from "../../types";
import { AttachmentMigrationPanel } from "./AttachmentMigrationPanel";
import { GitHubImagePanel } from "./GitHubImagePanel";
import { useMigrationWorkspace } from "./useMigrationWorkspace";

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
const migrationReport: GitHubImageMigrationReport = {
  migrated: [{
    localPath: "assets/one.png",
    remotePath: "images/hash.png",
    url: "https://raw.githubusercontent.com/octocat/images/main/images/hash.png",
    uploaded: true,
  }],
  failed: [],
  failedNotes: [],
  failedDeletes: [],
  changedNotePaths: ["README.md", "guide.md"],
  deletedLocalPaths: ["assets/one.png"],
  changedNotes: 2,
  replacedReferences: 2,
  durationMs: 25,
};

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "get_remote_configs") return [remote] as never;
    if (command === "store_get") return { version: 3, libraries: [library] } as never;
    if (command === "attachments_migrate_github_images") return migrationReport as never;
    return null as never;
  });
});

describe("GitHubImagePanel", () => {
  it("only exposes library configuration", async () => {
    render(<GitHubImagePanel />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "图库配置" })).toBeInTheDocument());
    expect(screen.getByText("文档图库")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "迁移图片" })).not.toBeInTheDocument();
    expect(screen.queryByText("待迁移图片")).not.toBeInTheDocument();
  });

  it("runs migration with an embedded settings snapshot and task history", async () => {
    const report = scanReport([
      attachment({
        path: "assets/one.png",
        references: [{ notePath: "docs/chapter-one.md", line: 1 }],
      }),
      attachment({
        path: "assets/two.png",
        references: [{ notePath: "docs/chapter-two.md", line: 2 }],
      }),
      attachment({ path: "assets/orphan.png", references: [] }),
    ]);
    const onCompleted = vi.fn().mockResolvedValue(undefined);
    render(
      <MigrationHarness
        report={report}
        onCompleted={onCompleted}
      />,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "附件迁移" })).toBeInTheDocument());
    expect(screen.getByText("操作库")).toBeInTheDocument();
    expect(screen.getByText("文档图库")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("待迁移图片")).toBeInTheDocument());
    expect(screen.getAllByText("docs")).toHaveLength(2);
    expect(screen.getByText("chapter-one.md")).toBeInTheDocument();
    expect(screen.queryByText("assets")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起文件夹 docs" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "配置文件范围" }));
    let scopeDialog = screen.getByRole("dialog", { name: "配置文件范围" });
    expect(within(scopeDialog).getByRole("radio", { name: "手动范围" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(scopeDialog).getByRole("checkbox", { name: "取消选择文件夹 docs" }));
    expect(within(scopeDialog).getByText("0 个文件 · 0 张图片")).toBeInTheDocument();
    fireEvent.click(within(scopeDialog).getByRole("checkbox", { name: "选择文件夹 docs" }));
    expect(within(scopeDialog).getByText("2 个文件 · 2 张图片")).toBeInTheDocument();

    fireEvent.click(within(scopeDialog).getByRole("radio", { name: "忽略规则" }));
    fireEvent.change(within(scopeDialog).getByRole("textbox", { name: "忽略规则" }), {
      target: { value: "/docs/chapter-one.md" },
    });
    expect(within(scopeDialog).getByText("1 个文件 · 1 张图片")).toBeInTheDocument();
    fireEvent.click(within(scopeDialog).getByRole("button", { name: "应用" }));
    expect(screen.queryByRole("dialog", { name: "配置文件范围" })).not.toBeInTheDocument();
    expect(screen.queryByText("chapter-one.md")).not.toBeInTheDocument();
    expect(screen.getByText("chapter-two.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("combobox", { name: "目标图库" })).toHaveValue(library.id);
    fireEvent.click(screen.getByRole("radio", { name: "成功后删除" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByText("成功后删除本地图片")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始迁移" }));
    let dialog = screen.getByRole("dialog", { name: "确认附件迁移" });
    expect(within(dialog).getByText("将上传 1 张图片，并修改 1 篇 Markdown。迁移成功且引用替换完成后，将删除对应的本地图片。")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "attachments_migrate_github_images",
      expect.anything(),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "确认附件迁移" })).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      "attachments_migrate_github_images",
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "开始迁移" }));
    dialog = screen.getByRole("dialog", { name: "确认附件迁移" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认迁移" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith(
      "attachments_migrate_github_images",
      {
        repoPath: report.repoPath,
        imagePaths: ["assets/two.png"],
        config: {
          remote: library.remote,
          branch: "main",
          directory: "images",
        },
        localFilePolicy: "delete_after_success",
      },
    ));
    expect(await screen.findByText("任务详情")).toBeInTheDocument();
    expect(screen.getByText("删除本地")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回任务列表" }));
    expect(screen.getByRole("heading", { name: "迁移任务" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /成功 · 1 张/ })).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it("opens repository management as a secondary page", async () => {
    render(<GitHubImagePanel />);
    await waitFor(() => expect(screen.getByText("文档图库")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("管理图库仓库"));
    expect(screen.getByRole("heading", { name: "图库仓库" })).toBeInTheDocument();
    expect(screen.getByText("选择 Git 远程")).toBeInTheDocument();
  });

  it("confirms gallery deletion inside the plugin", async () => {
    render(<GitHubImagePanel />);
    await waitFor(() => expect(screen.getByText("文档图库")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("管理图库仓库"));

    fireEvent.click(screen.getByTitle("删除图库"));
    let dialog = screen.getByRole("dialog", { name: "确认删除图库" });
    expect(within(dialog).getByText("删除图库“文档图库”？Git 远程仓库不会被删除。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(mockedInvoke).not.toHaveBeenCalledWith("store_set", expect.anything());

    fireEvent.click(screen.getByTitle("删除图库"));
    dialog = screen.getByRole("dialog", { name: "确认删除图库" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除图库" }));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("store_set", {
      namespace: "plugin.dev.noteaura.attachment-manager.settings",
      key: "github-image-libraries.v3",
      value: { version: 3, libraries: [] },
    }));
    expect(await screen.findByText("尚未配置图库")).toBeInTheDocument();
  });
});

function MigrationHarness({
  report,
  onCompleted,
}: {
  report: ReturnType<typeof scanReport>;
  onCompleted: () => Promise<void>;
}) {
  const workspace = useMigrationWorkspace(onCompleted);
  return (
    <AttachmentMigrationPanel
      report={report}
      workspace={workspace}
      onOpenSettings={vi.fn()}
    />
  );
}
