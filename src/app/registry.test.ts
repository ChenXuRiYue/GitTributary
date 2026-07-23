import { Settings } from "lucide-react";
import { describe, expect, it } from "vitest";

import { coreModules } from "./registry";

describe("core module registry", () => {
  it("keeps settings as a fixed system entry with the classic gear icon", () => {
    const settings = coreModules.find((module) => module.id === "settings");

    expect(settings).toMatchObject({
      name: "设置",
      group: "system",
      navigationKind: "function",
      canHide: false,
      fullHeight: true,
    });
    expect(settings?.icon).toBe(Settings);
  });
});
