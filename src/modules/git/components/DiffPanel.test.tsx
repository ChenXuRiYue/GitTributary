import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DiffPanel, type DiffFileEntry, type DiffPatch } from "./DiffPanel";
import { DiffViewer } from "./DiffViewer";

const files: DiffFileEntry[] = [
  { path: "README.md", kind: "Modified", staged: false },
  { path: "src/app.ts", kind: "Added", staged: true },
  { path: "src/lib/data.bin", kind: "Untracked", staged: false },
];

function patch(path: string, content = "new line"): DiffPatch {
  return {
    path,
    patch: [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,2 +1,2 @@",
      " context",
      "-old line",
      `+${content}`,
    ].join("\n"),
    additions: 1,
    deletions: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("DiffViewer", () => {
  it("parses headers, hunks, additions, deletions, context, and line numbers", () => {
    render(<DiffViewer {...patch("src/app.ts")} filePath="src/app.ts" />);
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
    expect(screen.getByText("context")).toBeInTheDocument();
    expect(screen.getByText("old line")).toBeInTheDocument();
    expect(screen.getByText("new line")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
  });

  it("renders a useful empty/binary-file state", () => {
    render(<DiffViewer patch="  " filePath="image.png" additions={0} deletions={0} />);
    expect(screen.getByText(/无法生成 diff/)).toBeInTheDocument();
  });

  it("keeps malformed hunks visible without inventing line numbers", () => {
    render(<DiffViewer patch={"@@ malformed @@\n+line"} filePath="broken.patch" additions={1} deletions={0} />);
    expect(screen.getByText("@@ malformed @@")).toBeInTheDocument();
    expect(screen.getByText("line")).toBeInTheDocument();
  });
});

describe("DiffPanel", () => {
  it("renders empty and initial selection states", () => {
    const { rerender } = render(<DiffPanel files={[]} fetchDiff={vi.fn()} />);
    expect(screen.getByText("无文件")).toBeInTheDocument();
    expect(screen.getByText("选择文件查看变更")).toBeInTheDocument();
    rerender(<DiffPanel files={files} fetchDiff={vi.fn()} />);
    expect(screen.getByText("3 个文件")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("loads a selected file on demand and deselects it on a second click", async () => {
    const user = userEvent.setup();
    const fetchDiff = vi.fn(async (path: string) => patch(path));
    render(<DiffPanel files={files} fetchDiff={fetchDiff} />);

    await user.click(screen.getByText("app.ts"));
    expect(fetchDiff).toHaveBeenCalledWith("src/app.ts");
    expect(await screen.findByText("new line")).toBeInTheDocument();
    await user.click(screen.getByText("app.ts"));
    expect(screen.getByText("选择文件查看变更")).toBeInTheDocument();
    expect(fetchDiff).toHaveBeenCalledOnce();
  });

  it("renders null and rejected diff requests as recoverable failures", async () => {
    const user = userEvent.setup();
    const fetchDiff = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("read failed"));
    render(<DiffPanel files={files} fetchDiff={fetchDiff} />);
    await user.click(screen.getByText("README.md"));
    expect(await screen.findByText("无法加载 diff")).toBeInTheDocument();
    await user.click(screen.getByText("app.ts"));
    expect(await screen.findByText("无法加载 diff")).toBeInTheDocument();
  });

  it("switches to a sorted flat list", async () => {
    const user = userEvent.setup();
    render(<DiffPanel files={files} fetchDiff={vi.fn()} />);
    await user.click(screen.getByTitle("平铺"));
    const list = document.querySelector("[data-diff-file-list]")!;
    expect(withinText(list)).toMatch(/README\.mdMsrc\/app\.tsAsrc\/lib\/data\.binU/);
    await user.click(screen.getByTitle("树形"));
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("selects all files and supports individual controlled checkboxes", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <DiffPanel files={files} fetchDiff={vi.fn()} checkable checked={new Set()} onCheckedChange={onCheckedChange} />,
    );
    await user.click(screen.getAllByRole("checkbox")[0]);
    expect([...onCheckedChange.mock.calls[0][0]]).toEqual(files.map((file) => file.path));

    rerender(
      <DiffPanel
        files={files}
        fetchDiff={vi.fn()}
        checkable
        checked={new Set(["README.md"])}
        onCheckedChange={onCheckedChange}
      />,
    );
    await user.click(screen.getByTitle("取消选择此文件"));
    expect([...onCheckedChange.mock.lastCall![0]]).toEqual([]);
  });

  it("selects and clears every file below a folder", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <DiffPanel files={files} fetchDiff={vi.fn()} checkable checked={new Set()} onCheckedChange={onCheckedChange} />,
    );
    await user.click(screen.getAllByTitle("选择此文件夹")[0]);
    expect([...onCheckedChange.mock.lastCall![0]].sort()).toEqual(["src/app.ts", "src/lib/data.bin"]);

    rerender(
      <DiffPanel
        files={files}
        fetchDiff={vi.fn()}
        checkable
        checked={new Set(["src/app.ts", "src/lib/data.bin"])}
        onCheckedChange={onCheckedChange}
      />,
    );
    await user.click(screen.getAllByTitle("取消选择此文件夹")[0]);
    expect([...onCheckedChange.mock.lastCall![0]]).toEqual([]);
  });

  it("does not let an older diff response overwrite the latest selection", async () => {
    const user = userEvent.setup();
    const first = deferred<DiffPatch | null>();
    const second = deferred<DiffPatch | null>();
    const fetchDiff = vi.fn((path: string) => path === "README.md" ? first.promise : second.promise);
    render(<DiffPanel files={files} fetchDiff={fetchDiff} />);

    await user.click(screen.getByText("README.md"));
    await user.click(screen.getByText("app.ts"));
    await act(async () => {
      second.resolve(patch("src/app.ts", "latest response"));
    });
    expect(await screen.findByText("latest response")).toBeInTheDocument();
    await act(async () => {
      first.resolve(patch("README.md", "stale response"));
    });

    await waitFor(() => expect(screen.queryByText("stale response")).not.toBeInTheDocument());
    expect(screen.getByText("latest response")).toBeInTheDocument();
  });
});

function withinText(element: Element): string {
  return element.textContent?.replace(/\s+/g, "") ?? "";
}
