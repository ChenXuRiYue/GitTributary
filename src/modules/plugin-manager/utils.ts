import type { MarketPlugin } from "./types";

const PERMISSION_LABELS: Record<string, string> = {
  "repository:read": "读取当前仓库信息",
  "git:read": "读取 Git 状态与历史",
  "git:write": "修改 Git 远程与仓库状态",
  "git:credential": "在插件后端使用 Git 凭证",
  "flow:read": "读取 Flow 定义",
  "files:read": "读取仓库文件",
  "files:write": "修改仓库文件",
  "store:read": "读取插件配置",
  "store:write": "保存插件配置",
  "shell:open": "打开本地文件与网页",
  "network:read": "加载远程资源",
  "network:write": "向远程服务写入数据",
};

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

type PluginVersionState = Pick<MarketPlugin, "version" | "installedVersion">;

export function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission;
}

function parseSemver(version: string): Semver | null {
  const match = version.match(
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

export function compareSemver(leftVersion: string, rightVersion: string): number | null {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const identifiers = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < identifiers; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

export function isUpdateAvailable(plugin: PluginVersionState): boolean {
  if (plugin.installedVersion === null) return false;
  return compareSemver(plugin.version, plugin.installedVersion) === 1;
}

export function isReinstallAvailable(plugin: PluginVersionState): boolean {
  if (plugin.installedVersion === null) return false;
  return compareSemver(plugin.version, plugin.installedVersion) === 0;
}
