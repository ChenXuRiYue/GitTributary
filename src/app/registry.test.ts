import { Settings } from "lucide-react";
import { describe, expect, it } from "vitest";

import { coreModules } from "./registry";

describe("core module registry", () => {
  it("keeps data sync inside the fixed settings entry", () => {
    const settings = coreModules.find((module) => module.id === "settings");

    expect(coreModules.some((module) => module.id === "store")).toBe(false);
    expect(settings).toMatchObject({
      name: "设置",
      description: "管理数据同步、界面与应用行为。",
      group: "system",
      navigationKind: "function",
      canHide: false,
      fullHeight: true,
    });
    expect(settings?.icon).toBe(Settings);
  });
});
