import { describe, expect, it } from "vitest";

import {
  HOST_API_CONTRACT,
  defaultHostResult,
  hostMethodCase,
  hostMethodContract,
  permissionDeniedCases,
} from "./host-method-cases";
import { createMockHost } from "./mock-host";

describe("host API contract cases", () => {
  it("uses unique method and case identifiers", () => {
    const methods = HOST_API_CONTRACT.methods.map((item) => item.method);
    const cases = HOST_API_CONTRACT.methods.flatMap((item) => item.cases.map((entry) => entry.id));
    expect(new Set(methods).size).toBe(methods.length);
    expect(new Set(cases).size).toBe(cases.length);
  });

  it("provides a canonical success case for every public method", () => {
    for (const method of HOST_API_CONTRACT.methods) {
      expect(method.cases.some((item) => item.kind === "success"), method.method).toBe(true);
      expect(() => defaultHostResult(method.method)).not.toThrow();
    }
  });

  it("rejects a contract without a canonical success case", () => {
    const index = HOST_API_CONTRACT.methods.push({
      method: "test.no-success",
      permission: null,
      description: "Coverage fixture for malformed contracts",
      cases: [{
        id: "test.no-success.error",
        kind: "error",
        payload: {},
        error: "fixture_error",
      }],
    }) - 1;

    try {
      expect(() => defaultHostResult("test.no-success")).toThrow("host method has no success case");
    } finally {
      HOST_API_CONTRACT.methods.splice(index, 1);
    }
  });

  it("derives permission-denied cases for permission-gated methods", () => {
    const gated = HOST_API_CONTRACT.methods.filter((item) => item.permission !== null);
    expect(permissionDeniedCases()).toHaveLength(gated.length);
    expect(permissionDeniedCases().every((item) => item.error === "permission_denied")).toBe(true);
  });

  it("uses an empty payload when a permission-gated contract has no cases", () => {
    const index = HOST_API_CONTRACT.methods.push({
      method: "test.empty-cases",
      permission: "fixture:read",
      description: "Coverage fixture for malformed contracts",
      cases: [],
    }) - 1;

    try {
      expect(permissionDeniedCases()).toContainEqual({
        id: "test.empty-cases.permission-denied",
        kind: "error",
        payload: {},
        error: "permission_denied",
      });
    } finally {
      HOST_API_CONTRACT.methods.splice(index, 1);
    }
  });

  it("locates contracts and cases by their stable identifiers", () => {
    expect(hostMethodContract("workspace.info").permission).toBe("repository:read");
    expect(hostMethodCase("workspace.info.closed").result).toMatchObject({ active_repo: null });
    expect(() => hostMethodContract("unknown.method")).toThrow("unknown host method");
    expect(() => hostMethodCase("unknown.case")).toThrow("unknown host method case");
  });
});

describe("mock host", () => {
  it("returns canonical results and records immutable calls", async () => {
    const host = createMockHost();
    const payload = { limit: 20 };
    await expect(host.invoke("git.log", payload)).resolves.toEqual([]);
    payload.limit = 99;
    expect(host.calls).toEqual([{ method: "git.log", payload: { limit: 20 } }]);
  });

  it("supports per-method handlers and reset", async () => {
    const host = createMockHost({
      "store.get": (payload) => ({ payload }),
    });
    await expect(host.invoke("store.get", { key: "theme" })).resolves.toEqual({
      payload: { key: "theme" },
    });
    expect(host.calls).toHaveLength(1);
    host.reset();
    expect(host.calls).toEqual([]);
  });

  it("rejects methods outside the published contract", async () => {
    const host = createMockHost();
    await expect(host.invoke("unknown.method")).rejects.toThrow("unknown host method");
  });
});
