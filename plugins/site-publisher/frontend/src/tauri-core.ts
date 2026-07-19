import { invokeHost } from "./bridge";

const COMMAND_METHODS: Record<string, string> = {
  store_get: "store.get",
  store_set: "store.set",
  store_delete: "store.delete",
  get_remote_configs: "repositories.configs",
  get_workspace_info: "workspace.info",
  site_open_output: "shell.openPath",
};

const BACKEND_METHODS: Record<string, string> = {
  site_scan: "site.scan",
  site_build: "site.build",
};

export async function invoke<T>(command: string, args: unknown = {}): Promise<T> {
  const backendMethod = BACKEND_METHODS[command];
  if (backendMethod) {
    return invokeHost<T>("backend.invoke", { method: backendMethod, payload: args });
  }
  if (command === "site_publish_pages") {
    const request = (args as {
      request?: {
        target?: {
          targetLocalPath?: string;
          remoteName?: string;
          credentialRef?: string | null;
        };
      };
    }).request;
    const target = request?.target;
    if (!request || !target?.targetLocalPath || !target.remoteName) {
      throw new Error("发布请求缺少 Git 目标信息");
    }
    return invokeHost<T>("backend.invoke", {
      method: "site.publish",
      payload: { request },
      hostServices: {
        gitPublishContext: {
          targetLocalPath: target.targetLocalPath,
          remoteName: target.remoteName,
          ...(target.credentialRef ? { credentialRef: target.credentialRef } : {}),
        },
      },
    });
  }
  const method = COMMAND_METHODS[command];
  if (!method) return Promise.reject(new Error(`不支持的宿主命令: ${command}`));
  return invokeHost<T>(method, args);
}
