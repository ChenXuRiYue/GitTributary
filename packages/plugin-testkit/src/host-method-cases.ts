import rawContract from "./host-methods.v1.json";

import type { HostApiContract, HostMethodCase, HostMethodContract } from "./types";

export const HOST_API_CONTRACT = rawContract as HostApiContract;

export function hostMethodContract(method: string): HostMethodContract {
  const contract = HOST_API_CONTRACT.methods.find((item) => item.method === method);
  if (!contract) throw new Error(`unknown host method: ${method}`);
  return contract;
}

export function hostMethodCases(method: string): HostMethodCase[] {
  return hostMethodContract(method).cases;
}

export function hostMethodCase(caseId: string): HostMethodCase {
  for (const method of HOST_API_CONTRACT.methods) {
    const item = method.cases.find((candidate) => candidate.id === caseId);
    if (item) return item;
  }
  throw new Error(`unknown host method case: ${caseId}`);
}

export function defaultHostResult(method: string): unknown {
  const success = hostMethodCases(method).find((item) => item.kind === "success");
  if (!success) throw new Error(`host method has no success case: ${method}`);
  return structuredClone(success.result);
}

export function permissionDeniedCases(): HostMethodCase[] {
  return HOST_API_CONTRACT.methods
    .filter((method) => method.permission !== null)
    .map((method) => ({
      id: `${method.method}.permission-denied`,
      kind: "error" as const,
      payload: structuredClone(method.cases[0]?.payload ?? {}),
      error: "permission_denied",
    }));
}
