import { describe, expect, it } from "vitest";

import {
  compareSemver,
  isReinstallAvailable,
  isUpdateAvailable,
  permissionLabel,
} from "./utils";

describe("plugin manager version helpers", () => {
  it("orders stable and prerelease semantic versions", () => {
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0-beta.2")).toBe(1);
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
    expect(compareSemver("v2.0.0+build.3", "2.0.0")).toBe(0);
  });

  it("rejects invalid versions instead of guessing an order", () => {
    expect(compareSemver("latest", "1.0.0")).toBeNull();
    expect(isUpdateAvailable({ version: "latest", installedVersion: "1.0.0" })).toBe(false);
  });

  it("distinguishes updates, reinstalls, and uninstalled plugins", () => {
    expect(isUpdateAvailable({ version: "1.1.0", installedVersion: "1.0.0" })).toBe(true);
    expect(isReinstallAvailable({ version: "1.0.0", installedVersion: "1.0.0" })).toBe(true);
    expect(isUpdateAvailable({ version: "1.0.0", installedVersion: null })).toBe(false);
  });
});

describe("plugin permission labels", () => {
  it("translates known permissions and preserves extension-defined values", () => {
    expect(permissionLabel("git:write")).toBe("修改 Git 远程与仓库状态");
    expect(permissionLabel("vendor:custom")).toBe("vendor:custom");
  });
});
