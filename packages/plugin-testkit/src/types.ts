export type HostCaseKind = "success" | "error";

export interface HostMethodCase {
  id: string;
  kind: HostCaseKind;
  payload: unknown;
  result?: unknown;
  error?: string;
}

export interface HostMethodContract {
  method: string;
  permission: string | null;
  permissionSource?: "backend.methods";
  description: string;
  cases: HostMethodCase[];
}

export interface HostApiContract {
  apiVersion: number;
  methods: HostMethodContract[];
}

export interface HostCall {
  method: string;
  payload: unknown;
}

export type HostHandler = (payload: unknown, call: HostCall) => unknown | Promise<unknown>;

export interface MockHost {
  calls: HostCall[];
  invoke<T = unknown>(method: string, payload?: unknown): Promise<T>;
  reset(): void;
}
