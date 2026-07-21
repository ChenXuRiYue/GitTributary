import { defaultHostResult, hostMethodContract } from "./host-method-cases";
import type { HostCall, HostHandler, MockHost } from "./types";

export function createMockHost(handlers: Record<string, HostHandler> = {}): MockHost {
  const calls: HostCall[] = [];
  return {
    calls,
    async invoke<T = unknown>(method: string, payload: unknown = {}): Promise<T> {
      hostMethodContract(method);
      const call = { method, payload: structuredClone(payload) };
      calls.push(call);
      const handler = handlers[method];
      const result = handler
        ? await handler(payload, call)
        : defaultHostResult(method);
      return structuredClone(result) as T;
    },
    reset() {
      calls.length = 0;
    },
  };
}
