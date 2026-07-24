import { describe, expect, it } from "vitest";

import { gitViews } from "./registry";

describe("Git view registry", () => {
  it("keeps credentials out of the daily Git workspace", () => {
    expect(gitViews.map((view) => view.id)).toEqual([
      "changes",
      "branches",
      "history",
    ]);
    expect(gitViews.some((view) => view.id === "safety")).toBe(false);
  });
});
