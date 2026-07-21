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
    const startedAt = performance.now();
    const request = (args as { request?: PublishRequest }).request;
    const target = request?.target;
    if (!request || !target?.targetLocalPath || !target.remoteName || !target.targetBranch) {
      throw new Error("发布请求缺少 Git 目标信息");
    }
    try {
      const plan = await invokeHost<PublishPlan>("backend.invoke", {
        method: "site.publish.plan",
        payload: { request },
      });
      const operation = await invokeHost<PathUpdateOperation>(
        "git.pathUpdate.prepare",
        gitOperation(request, plan),
      );
      const artifact = await invokeHost<PublishArtifact>("backend.invoke", {
        method: "site.publish.materialize",
        payload: { request },
      });
      const copied = await invokeHost<ReplaceTreeReport>("files.replaceTree", {
        operationId: operation.operationId,
        sourceRoot: artifact.artifactPath,
      });
      const git = await invokeHost<PathUpdateReport>("git.pathUpdate.commit", {
        operationId: operation.operationId,
        commitMessage: artifact.commitMessage,
      });
      return {
        build: artifact.build,
        targetRepoPath: git.targetRepoPath,
        publishDir: artifact.publishDir,
        publishPath: artifact.publishPath,
        branch: git.branch,
        remoteName: git.remoteName,
        pagesUrl: artifact.pagesUrl,
        copiedFileCount: copied.copiedFileCount,
        changedCount: git.changedCount,
        commit: git.commit,
        pushed: git.pushed,
        credentialMode: git.credentialMode,
        credentialRef: git.credentialRef,
        durationMs: Math.round(performance.now() - startedAt),
      } as T;
    } catch (error) {
      throw new Error(classifyPublishError(String(error)));
    }
  }
  const method = COMMAND_METHODS[command];
  if (!method) return Promise.reject(new Error(`不支持的宿主命令: ${command}`));
  return invokeHost<T>(method, args);
}

interface PublishRequest {
  buildConfig: unknown;
  target: {
    targetLocalPath: string;
    targetBranch: string;
    publishDir: string;
    remoteName: string;
    credentialRef?: string | null;
    pagesUrl?: string;
    autoCommitMessage?: string;
  };
}

interface PublishPlan {
  targetRepoPath: string;
  publishPathspec: string;
}

interface PublishArtifact extends PublishPlan {
  build: unknown;
  artifactPath: string;
  publishDir: string;
  publishPath: string;
  pagesUrl: string;
  commitMessage: string;
}

interface ReplaceTreeReport {
  copiedFileCount: number;
}

interface PathUpdateOperation {
  operationId: string;
}

interface PathUpdateReport {
  targetRepoPath: string;
  branch: string;
  remoteName: string;
  changedCount: number;
  commit: string | null;
  pushed: boolean;
  credentialMode: string;
  credentialRef: string | null;
}

function gitOperation(request: PublishRequest, plan: PublishPlan) {
  return {
    repositoryPath: plan.targetRepoPath,
    branch: request.target.targetBranch,
    remoteName: request.target.remoteName,
    pathspec: plan.publishPathspec,
    ...(request.target.credentialRef ? { credentialRef: request.target.credentialRef } : {}),
  };
}

function classifyPublishError(error: string): string {
  const lower = error.toLowerCase();
  if (["too many redirects", "authentication replays", "authentication failed", "401", "403"]
    .some((message) => lower.includes(message))) {
    return `${error}\n请检查 Pages 发布仓库远程 URL 与认证方式是否匹配: HTTPS 远程需要目标仓库可用的 GitHub Token, fine-grained token 至少需要 Contents: Read and write; SSH 远程请配置 SSH Key 或 Agent。`;
  }
  return error;
}
