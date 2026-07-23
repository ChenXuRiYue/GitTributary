import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { attachment, scanReport } from "../../test/fixtures";
import { useGitHubImageMigration } from "./useGitHubImageMigration";

const report = scanReport([
  attachment({ path: "assets/one.png" }),
  attachment({ path: "assets/two.png", references: [{ notePath: "guide.md", line: 2 }] }),
  attachment({ path: "assets/orphan.png", references: [] }),
  attachment({ path: "audio/theme.mp3", kind: "audio", mimeType: "audio/mpeg" }),
]);

describe("useGitHubImageMigration", () => {
  it("selects referenced images and supports bulk and individual toggles", async () => {
    const { result, rerender } = renderHook(
      ({ currentReport }) => useGitHubImageMigration(currentReport),
      { initialProps: { currentReport: report } },
    );
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
    expect(result.current.candidates.map((item) => item.path)).toEqual(["assets/one.png", "assets/two.png"]);
    act(() => result.current.selectAll(false));
    expect(result.current.selectedCount).toBe(0);
    act(() => result.current.togglePath("assets/one.png"));
    expect([...result.current.selectedPaths]).toEqual(["assets/one.png"]);

    rerender({ currentReport: { ...report, repoPath: "/fixtures/other" } });
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
  });

  it("selects and clears a folder-sized path batch in one update", async () => {
    const { result } = renderHook(() => useGitHubImageMigration(report));
    await waitFor(() => expect(result.current.selectedCount).toBe(2));

    act(() => result.current.selectPaths(["assets/one.png", "assets/two.png"], false));
    expect([...result.current.selectedPaths]).toEqual([]);

    act(() => result.current.selectPaths(["assets/one.png", "missing.png"], true));
    expect([...result.current.selectedPaths]).toEqual(["assets/one.png"]);

    act(() => result.current.replaceSelection(["assets/two.png", "missing.png"]));
    expect([...result.current.selectedPaths]).toEqual(["assets/two.png"]);
  });

  it("restores an explicit saved selection, including an empty selection", async () => {
    const onSelectionChange = vi.fn();
    const { result, unmount } = renderHook(() => useGitHubImageMigration(
      report,
      new Set(["assets/two.png", "missing.png"]),
      onSelectionChange,
    ));
    await waitFor(() => expect([...result.current.selectedPaths]).toEqual(["assets/two.png"]));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(["assets/two.png"]));
    unmount();

    const empty = renderHook(() => useGitHubImageMigration(report, new Set()));
    await waitFor(() => expect(empty.result.current.selectedCount).toBe(0));
  });

  it("returns an immutable selection only after in-plugin confirmation", async () => {
    const { result } = renderHook(() => useGitHubImageMigration(report));
    await waitFor(() => expect(result.current.selectedCount).toBe(2));

    act(() => result.current.migrate());
    expect(result.current.confirmation).toEqual({ imageCount: 2, noteCount: 2 });

    act(() => result.current.cancelMigration());
    expect(result.current.confirmation).toBeNull();

    act(() => result.current.migrate());
    let confirmed: ReturnType<typeof result.current.confirmMigration> = null;
    act(() => { confirmed = result.current.confirmMigration(); });
    expect(confirmed).toEqual({
      paths: ["assets/one.png", "assets/two.png"],
      noteCount: 2,
    });
    expect(result.current.confirmation).toBeNull();
  });

  it("rejects an empty selection", async () => {
    const { result } = renderHook(() => useGitHubImageMigration(report));
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
    act(() => result.current.selectAll(false));
    act(() => result.current.migrate());
    expect(result.current.error).toContain("至少选择");
    expect(result.current.confirmation).toBeNull();
  });
});
