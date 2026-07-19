import { invokeHost } from "./bridge";

export function openPath(path: string): Promise<void> {
  return invokeHost("shell.openPath", { path });
}

export function revealItemInDir(path: string): Promise<void> {
  return invokeHost("shell.revealPath", { path });
}
