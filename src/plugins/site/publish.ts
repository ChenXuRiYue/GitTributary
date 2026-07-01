import { pathCollator, stableHash } from "./state";
import type {
  PublishCandidateStatus,
  PublishRepoCandidate,
  RemoteConfigEntry,
  SitePublishDraft,
  SitePublishTargetState,
} from "./types";

const DEFAULT_BRANCH = "main";
const DEFAULT_PUBLISH_DIR = "/";

export function normalizePathForCompare(path: string | null | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}

export function remoteUrlOwnerRepo(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/i, "") };
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2].replace(/\.git$/i, "") };
  return null;
}

export function repositoryNameFromUrl(url: string): string {
  const github = remoteUrlOwnerRepo(url);
  if (github) return github.repo;
  const trimmed = url.trim().replace(/[/?#]+$/, "");
  const lastSegment = trimmed.split(/[/:]/).filter(Boolean).pop() ?? "";
  return lastSegment.replace(/\.git$/i, "") || "remote";
}

export function inferPagesUrl(remoteUrl: string): string {
  const github = remoteUrlOwnerRepo(remoteUrl);
  if (!github) return "";
  if (github.repo.toLowerCase() === `${github.owner.toLowerCase()}.github.io`) {
    return `https://${github.owner}.github.io/`;
  }
  return `https://${github.owner}.github.io/${github.repo}/`;
}

export function publishCandidateId(remote: RemoteConfigEntry): string {
  return remote.repo_path?.trim() || remote.url.trim() || `${remote.source}:${remote.name}`;
}

export function publishCandidateName(remote: RemoteConfigEntry): string {
  const pathName = remote.repo_path
    ?.replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  return pathName || repositoryNameFromUrl(remote.url) || remote.name;
}

function purposeHas(remote: RemoteConfigEntry, value: string): boolean {
  return remote.purpose.some((purpose) => purpose === value);
}

export function publishCandidateStatus(
  remote: RemoteConfigEntry,
  sourceRepoPath: string,
): { status: PublishCandidateStatus; reason: string; recommended: boolean } {
  const source = normalizePathForCompare(sourceRepoPath);
  const repoPath = normalizePathForCompare(remote.repo_path);
  if (repoPath && source && repoPath === source) {
    return {
      status: "not-recommended",
      reason: "当前源仓库不建议作为 Pages 发布仓库",
      recommended: false,
    };
  }
  if (purposeHas(remote, "data_center_sync")) {
    return {
      status: "not-recommended",
      reason: "数据中心同步仓库默认不用于静态发布",
      recommended: false,
    };
  }
  if (!remote.repo_path) {
    return {
      status: "needs-local",
      reason: "需要先 Clone 或绑定本地工作副本",
      recommended: false,
    };
  }
  return {
    status: "ready",
    reason: "可作为 Pages 发布仓库",
    recommended: true,
  };
}

export function toPublishCandidate(
  remote: RemoteConfigEntry,
  sourceRepoPath: string,
): PublishRepoCandidate {
  const status = publishCandidateStatus(remote, sourceRepoPath);
  return {
    id: publishCandidateId(remote),
    name: publishCandidateName(remote),
    remoteName: remote.name,
    url: remote.url,
    pushUrl: remote.push_url,
    repoPath: remote.repo_path,
    source: remote.source,
    purpose: remote.purpose,
    credentialMode: remote.credential_mode,
    credentialRef: remote.credential_ref,
    verifyStatus: remote.verify_status,
    capabilities: remote.capabilities,
    status: status.status,
    reason: status.reason,
    recommended: status.recommended,
  };
}

export function buildPublishCandidates(
  remotes: RemoteConfigEntry[],
  sourceRepoPath: string,
  activeTargetId?: string | null,
): PublishRepoCandidate[] {
  return remotes
    .map((remote) => toPublishCandidate(remote, sourceRepoPath))
    .sort((a, b) => {
      const aActive = activeTargetId && a.id === activeTargetId ? 1 : 0;
      const bActive = activeTargetId && b.id === activeTargetId ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aPurpose = a.purpose.includes("publish_target") || a.purpose.includes("pages-target") ? 1 : 0;
      const bPurpose = b.purpose.includes("publish_target") || b.purpose.includes("pages-target") ? 1 : 0;
      if (aPurpose !== bPurpose) return bPurpose - aPurpose;
      const aReady = a.status === "ready" ? 1 : 0;
      const bReady = b.status === "ready" ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      return pathCollator.compare(a.name, b.name);
    });
}

export function defaultPublishDraft(candidate?: PublishRepoCandidate | null): SitePublishDraft {
  return {
    targetBranch: DEFAULT_BRANCH,
    publishDir: DEFAULT_PUBLISH_DIR,
    pagesUrl: candidate ? inferPagesUrl(candidate.url) : "",
    autoCommitMessage: "deploy: 更新静态站点",
  };
}

export function draftFromTarget(target: SitePublishTargetState | null): SitePublishDraft {
  if (!target) return defaultPublishDraft(null);
  return {
    targetBranch: target.targetBranch || DEFAULT_BRANCH,
    publishDir: target.publishDir || DEFAULT_PUBLISH_DIR,
    pagesUrl: target.pagesUrl || "",
    autoCommitMessage: target.autoCommitMessage || "deploy: 更新静态站点",
  };
}

export function makePublishTarget(
  sourceRepoPath: string,
  candidate: PublishRepoCandidate,
  draft: SitePublishDraft,
): SitePublishTargetState {
  const id = `pages.${stableHash(`${sourceRepoPath}|${candidate.id}`)}`;
  return {
    version: 1,
    id,
    name: `${candidate.name} Pages`,
    sourceRepoPath,
    targetRepoId: candidate.id,
    targetRepoName: candidate.name,
    targetRepoUrl: candidate.url,
    targetLocalPath: candidate.repoPath ?? "",
    targetBranch: draft.targetBranch.trim() || DEFAULT_BRANCH,
    publishDir: draft.publishDir.trim() || DEFAULT_PUBLISH_DIR,
    remoteName: candidate.remoteName || "origin",
    credentialRef: candidate.credentialRef,
    pagesUrl: draft.pagesUrl.trim(),
    autoCommitMessage: draft.autoCommitMessage.trim() || "deploy: 更新静态站点",
    updatedAt: Date.now(),
  };
}

export function credentialLabel(mode: string): string {
  switch (mode) {
    case "repo_token": return "项目 Token";
    case "remote_token": return "Remote Token";
    case "config_repo_token": return "配置中心 Token";
    case "app_global_token": return "全局 Token";
    case "ssh_key": return "指定 SSH Key";
    case "ssh_agent": return "SSH Agent";
    case "system": return "系统 Git 凭据";
    case "none": return "未配置";
    default: return mode;
  }
}

export function purposeLabel(purpose: string): string {
  switch (purpose) {
    case "current_repo_remote": return "当前仓库";
    case "bound_repo_remote": return "绑定仓库";
    case "data_center_sync": return "数据中心";
    case "backup_target": return "备份";
    case "publish_target": return "发布";
    case "pages-target": return "Pages";
    case "mirror": return "镜像";
    default: return purpose;
  }
}
