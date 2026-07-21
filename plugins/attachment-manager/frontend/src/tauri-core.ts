import { invokeHost } from "./bridge";

const COMMAND_METHODS: Record<string, string> = {
  get_workspace_info: "workspace.info",
  get_remote_configs: "repositories.configs",
  add_remote: "repositories.addRemote",
  store_get: "store.get",
  store_set: "store.set",
};

const BACKEND_METHODS: Record<string, string> = {
  attachments_scan: "attachments.scan",
  attachments_preview: "attachments.preview",
  attachments_check_github_image_config: "attachments.checkGithubImageConfig",
  attachments_migrate_github_images: "attachments.migrateGithubImages",
};

export async function invoke<T>(command: string, args: unknown = {}): Promise<T> {
  const backendMethod = BACKEND_METHODS[command];
  if (backendMethod) {
    return invokeHost<T>("backend.invoke", { method: backendMethod, payload: args });
  }
  const method = COMMAND_METHODS[command];
  if (!method) throw new Error(`不支持的宿主命令: ${command}`);
  return invokeHost<T>(method, args);
}
