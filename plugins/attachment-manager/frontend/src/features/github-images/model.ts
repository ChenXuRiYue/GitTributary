import type {
  GitHubImageLibrary,
  GitRemoteBinding,
  GitRemoteConfigEntry,
} from "../../types";

export const SETTINGS_NAMESPACE = "plugin.dev.gittributary.attachment-manager.settings";
export const SETTINGS_KEY = "github-image-libraries.v3";
export const PREVIOUS_SETTINGS_KEY = "github-images.v2";
export const LEGACY_SETTINGS_KEY = "github-images.v1";

export interface StoredGitHubImageSettings {
  version: 3;
  libraries: GitHubImageLibrary[];
}

export function createLibrary(index = 1): GitHubImageLibrary {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `github-images-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: `图库 ${index}`,
    remote: null,
    branch: "main",
    directory: "images",
  };
}

export function isStoredSettings(value: unknown): value is StoredGitHubImageSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<StoredGitHubImageSettings>;
  return settings.version === 3
    && Array.isArray(settings.libraries)
    && settings.libraries.every(isLibrary);
}

export function migratePreviousSettings(value: unknown): GitHubImageLibrary[] {
  if (!value || typeof value !== "object") return [];
  const settings = value as {
    version?: unknown;
    profiles?: unknown;
    owner?: unknown;
    repository?: unknown;
    branch?: unknown;
    directory?: unknown;
  };
  if (settings.version === 2 && Array.isArray(settings.profiles)) {
    return settings.profiles.flatMap((profile, index) => {
      if (!profile || typeof profile !== "object") return [];
      return [legacyLibrary(profile as Record<string, unknown>, index + 1)];
    }).filter((library): library is GitHubImageLibrary => library !== null);
  }
  const migrated = legacyLibrary(settings as Record<string, unknown>, 1);
  return migrated ? [migrated] : [];
}

export function remoteBinding(entry: GitRemoteConfigEntry): GitRemoteBinding | null {
  if (
    !entry.repo_path
    || !isSupportedGitHubRemote(entry.url)
    || !matchesGitHubApiCredential(entry.credential_mode)
  ) return null;
  return {
    repoPath: entry.repo_path,
    name: entry.name,
    url: entry.url,
  };
}

function matchesGitHubApiCredential(mode: string): boolean {
  return mode === "repo_token" || mode === "app_global_token";
}

export function bindingKey(binding: GitRemoteBinding): string {
  return `${binding.repoPath}\0${binding.name}\0${normalizeRemoteUrl(binding.url)}`;
}

export function remoteEntryKey(entry: GitRemoteConfigEntry): string {
  return `${entry.repo_path ?? ""}\0${entry.name}\0${normalizeRemoteUrl(entry.url)}`;
}

export function isSupportedGitHubRemote(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/?#]+(?:\.git)?\/?$/i.test(url.trim());
}

export function normalizeRemoteUrl(url: string): string {
  return url.trim().replace(/\/$/, "").replace(/\.git$/i, "").toLocaleLowerCase();
}

export function migrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = {
    github_auth_failed: "GitHub Token 无效",
    github_permission_denied: "Git 凭证没有目标仓库的写入权限",
    github_repository_or_branch_not_found: "找不到目标仓库或分支",
    github_owner_invalid: "GitHub 用户或组织名无效",
    github_repository_invalid: "GitHub 仓库名无效",
    github_branch_invalid: "分支名无效",
    github_directory_invalid: "存储目录无效",
    github_token_missing: "绑定的 Git 远程没有可用 Token",
    github_branch_not_found: "目标分支不存在",
    github_rate_limited: "GitHub API 请求已达到频率限制，请稍后重试",
    github_remote_binding_missing: "请先绑定一个 Git 远程仓库",
    github_remote_binding_stale: "绑定的 Git 远程已变更，请重新选择",
    github_remote_repo_missing: "绑定的本地 Git 仓库已不存在",
    github_remote_token_unavailable: "Git 远程没有可供 GitHub API 使用的 Token",
    github_remote_url_unsupported: "图库目前仅支持 HTTPS GitHub 远程仓库",
    migration_images_empty: "请至少选择一张图片",
    migration_images_too_many: "单次最多迁移 500 张图片",
    migration_image_too_large: "图片超过 50 MB",
    migration_file_not_image: "文件不是可迁移的图片",
    invalid_attachment_path: "图片路径无效或文件已不存在",
    note_too_large: "Markdown 文件超过 4 MB，未自动修改",
  };
  if (message.startsWith("github_request_failed:")) return "无法连接 GitHub，请检查网络后重试";
  return labels[message] ?? message;
}

function legacyLibrary(value: Record<string, unknown>, index: number): GitHubImageLibrary | null {
  const owner = typeof value.owner === "string" ? value.owner.trim() : "";
  const repository = typeof value.repository === "string" ? value.repository.trim() : "";
  if (!owner && !repository && typeof value.name !== "string") return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : `github-images-migrated-${index}`,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "默认图库",
    remote: null,
    branch: typeof value.branch === "string" && value.branch.trim() ? value.branch.trim() : "main",
    directory: typeof value.directory === "string" ? value.directory : "images",
    suggestedRemoteUrl: owner && repository
      ? `https://github.com/${owner}/${repository.replace(/\.git$/i, "")}.git`
      : undefined,
  };
}

function isLibrary(value: unknown): value is GitHubImageLibrary {
  if (!value || typeof value !== "object") return false;
  const library = value as Partial<GitHubImageLibrary>;
  return typeof library.id === "string"
    && Boolean(library.id)
    && typeof library.name === "string"
    && typeof library.branch === "string"
    && typeof library.directory === "string"
    && (library.remote === null || isBinding(library.remote));
}

function isBinding(value: unknown): value is GitRemoteBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<GitRemoteBinding>;
  return typeof binding.repoPath === "string"
    && Boolean(binding.repoPath)
    && typeof binding.name === "string"
    && Boolean(binding.name)
    && typeof binding.url === "string"
    && Boolean(binding.url);
}
