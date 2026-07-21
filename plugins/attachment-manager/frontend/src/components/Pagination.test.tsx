import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("stays hidden when all items fit on one page", () => {
    render(<Pagination page={0} pageCount={1} total={10} onPageChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
  });

  it("moves through pages and disables controls at boundaries", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Pagination page={0} pageCount={3} total={250} onPageChange={onPageChange} />,
    );
    expect(screen.getByText("250 项 · 1/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    rerender(<Pagination page={2} pageCount={3} total={250} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });
});
