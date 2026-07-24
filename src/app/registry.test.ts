import { Settings } from "lucide-react";
import { describe, expect, it } from "vitest";

import { coreModules } from "./registry";

describe("core module registry", () => {
  it("keeps data space and Git settings inside the fixed settings entry", () => {
    const settings = coreModules.find((module) => module.id === "settings");

    expect(coreModules.some((module) => module.id === "store")).toBe(false);
    expect(settings).toMatchObject({
      name: "设置",
      description: "管理数据空间与 Git 配置、界面。",
      group: "system",
      navigationKind: "function",
      canHide: false,
      fullHeight: true,
    });
    expect(settings?.icon).toBe(Settings);
  });
});
