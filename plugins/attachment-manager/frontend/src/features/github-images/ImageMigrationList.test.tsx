import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachment } from "../../test/fixtures";
import type { AttachmentItem, ImageMigrationFileScope } from "../../types";
import { defaultMigrationFileScope } from "./migration-file-scope";
import { ImageMigrationList } from "./ImageMigrationList";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const candidates = [
  attachment({
    path: "assets/preview-alpha.png",
    name: "preview-alpha.png",
    references: [{ notePath: "docs/alpha.md", line: 1 }],
  }),
  attachment({
    path: "assets/preview-beta.png",
    name: "preview-beta.png",
    references: [{ notePath: "docs/beta.md", line: 2 }],
  }),
];

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "attachments_preview") {
      return {
        path: "assets/preview-alpha.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,cHJldmlldw==",
      } as never;
    }
    return null as never;
  });
  vi.stubGlobal("IntersectionObserver", class {
    private callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
    }

    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("ImageMigrationList", () => {
  it("expands a file into a selectable lazy-loaded image preview", async () => {
    render(<MigrationListHarness items={candidates} />);

    expect(screen.getByRole("checkbox", { name: "取消选择当前范围" })).toBeInTheDocument();
    expect(screen.queryByText("preview-alpha.png")).not.toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("attachments_preview", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "展开文件 docs/alpha.md" }));

    expect(screen.getByRole("button", { name: "收起文件 docs/alpha.md" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("preview-alpha.png")).toBeInTheDocument();
    expect(screen.queryByText("preview-beta.png")).not.toBeInTheDocument();
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("attachments_preview", {
      repoPath: "/fixtures/preview-notes",
      path: "assets/preview-alpha.png",
    }));

    fireEvent.click(screen.getByRole("checkbox", { name: "取消选择图片 assets/preview-alpha.png" }));
    expect(screen.getByRole("checkbox", { name: "选择图片 assets/preview-alpha.png" })).not.toBeChecked();
    expect(screen.getByText("已选 1/2 张")).toBeInTheDocument();
    expect(screen.getByText("· 1 篇 · 1.0 KB")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "preview-alpha.png 图片预览" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "放大预览图片 assets/preview-alpha.png" }));
    expect(await screen.findByRole("dialog", { name: "preview-alpha.png 图片预览" }))
      .toHaveClass("bg-black/60");
    fireEvent.click(screen.getByTitle("关闭预览"));
    expect(screen.queryByRole("dialog", { name: "preview-alpha.png 图片预览" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "筛选引用文件或图片" }), {
      target: { value: "preview-beta" },
    });
    expect(await screen.findByText("preview-beta.png")).toBeInTheDocument();
    expect(screen.queryByText("preview-alpha.png")).not.toBeInTheDocument();
  });

  it("keeps file, preview, and select-all state consistent", () => {
    render(<MigrationListHarness items={candidates} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "取消选择当前范围" }));
    expect(screen.getByText("已选 0/2 张")).toBeInTheDocument();
    expect(screen.getByText("· 0 篇 · 0 B")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开文件 docs/alpha.md" }));
    expect(screen.getByRole("checkbox", { name: "选择图片 assets/preview-alpha.png" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 docs/alpha.md" }));
    expect(screen.getByRole("checkbox", { name: "取消选择图片 assets/preview-alpha.png" })).toBeChecked();
    expect(screen.getByText("已选 1/2 张")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择当前范围" }));
    expect(screen.getByRole("checkbox", { name: "取消选择当前范围" })).toBeChecked();
    expect(screen.getByText("已选 2/2 张")).toBeInTheDocument();
    expect(screen.getByText("· 2 篇 · 2.0 KB")).toBeInTheDocument();
  });
});

function MigrationListHarness({ items }: { items: AttachmentItem[] }) {
  const [selectedPaths, setSelectedPaths] = useState(new Set(items.map((item) => item.path)));
  const [scope, setScope] = useState<ImageMigrationFileScope>(defaultMigrationFileScope());
  const selected = useMemo(
    () => items.filter((item) => selectedPaths.has(item.path)),
    [items, selectedPaths],
  );
  const selectedNotes = new Set(
    selected.flatMap((item) => item.references.map((reference) => reference.notePath)),
  ).size;
  const selectedBytes = selected.reduce((total, item) => total + item.size, 0);
  const selectPaths = (paths: string[], nextSelected: boolean) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      paths.forEach((path) => nextSelected ? next.add(path) : next.delete(path));
      return next;
    });
  };

  return (
    <div className="h-[420px]">
      <ImageMigrationList
        repoPath="/fixtures/preview-notes"
        candidates={items}
        selectedPaths={selectedPaths}
        selectedNotes={selectedNotes}
        selectedBytes={selectedBytes}
        scope={scope}
        migrating={false}
        onScopeChange={setScope}
        onSelectPaths={selectPaths}
        onReplaceSelection={(paths) => setSelectedPaths(new Set(paths))}
        onMigrate={vi.fn()}
      />
    </div>
  );
}
