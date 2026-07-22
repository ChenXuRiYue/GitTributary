import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitRemoteConfigEntry } from "../../types";
import {
  bindingKey,
  createLibrary,
  isStoredSettings,
  isSupportedGitHubRemote,
  migratePreviousSettings,
  migrationError,
  normalizeRemoteUrl,
  remoteBinding,
  remoteEntryKey,
} from "./model";

const remote: GitRemoteConfigEntry = {
  name: "image-cloud",
  url: "https://github.com/octocat/images.git",
  push_url: null,
  repo_path: "/repos/notes",
  source: "local_git_config",
  purpose: ["current_repo_remote"],
  credential_mode: "repo_token",
  credential_ref: "repo:/repos/notes",
  commit_name: null,
  commit_email: null,
  verify_status: "unverified",
  capabilities: "unknown",
};

describe("GitHub image library settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates an unbound library with migration defaults", () => {
    const first = createLibrary(1);
    const second = createLibrary(2);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ name: "图库 1", remote: null, branch: "main", directory: "images" });
  });

  it("creates a fallback id without randomUUID", () => {
    vi.stubGlobal("crypto", undefined);
    expect(createLibrary().id).toMatch(/^github-images-/);
  });

  it("validates v3 libraries and remote bindings", () => {
    const library = { ...createLibrary(), id: "primary", remote: remoteBinding(remote) };
    expect(isStoredSettings({ version: 3, libraries: [library] })).toBe(true);
    expect(isStoredSettings({ version: 3, libraries: [{ ...library, remote: { url: remote.url } }] })).toBe(false);
    expect(isStoredSettings({ version: 2, libraries: [library] })).toBe(false);
    expect(isStoredSettings(null)).toBe(false);
  });

  it("migrates v2 and v1 settings without carrying tokens", () => {
    const migrated = migratePreviousSettings({
      version: 2,
      profiles: [{
        id: "old",
        name: "旧图库",
        owner: "octocat",
        repository: "images",
        branch: "release/images",
        directory: "notes",
        token: "must-not-migrate",
        rememberToken: true,
      }],
    });
    expect(migrated).toEqual([expect.objectContaining({
      id: "old",
      name: "旧图库",
      remote: null,
      suggestedRemoteUrl: "https://github.com/octocat/images.git",
      branch: "release/images",
      directory: "notes",
    })]);
    expect(JSON.stringify(migrated)).not.toContain("must-not-migrate");
    expect(migratePreviousSettings({ owner: "octocat", repository: "images", branch: "main", directory: "images" })).toHaveLength(1);
    expect(migratePreviousSettings(null)).toEqual([]);
  });

  it("builds stable bindings only for local HTTPS GitHub remotes", () => {
    const binding = remoteBinding(remote);
    expect(binding).not.toBeNull();
    expect(bindingKey(binding!)).toBe(remoteEntryKey(remote));
    expect(normalizeRemoteUrl("https://github.com/Octocat/Images.git/")).toBe("https://github.com/octocat/images");
    expect(isSupportedGitHubRemote(remote.url)).toBe(true);
    expect(remoteBinding({ ...remote, repo_path: null })).toBeNull();
    expect(remoteBinding({ ...remote, url: "git@github.com:octocat/images.git" })).toBeNull();
    expect(remoteBinding({ ...remote, credential_mode: "system" })).toBeNull();
  });

  it("translates Git binding and network failures", () => {
    expect(migrationError("github_remote_binding_stale")).toContain("重新选择");
    expect(migrationError("github_remote_token_unavailable")).toContain("Token");
    expect(migrationError("github_request_failed:timeout")).toContain("无法连接 GitHub");
    expect(migrationError(new Error("custom_failure"))).toBe("custom_failure");
  });

  it.each([
    ["migration_delete_skipped_note_failures", "Markdown 修改未全部成功，已保留本地图片"],
    ["migration_delete_skipped_no_references", "未确认引用替换，已保留本地图片"],
    ["migration_delete_skipped_remaining_references", "仍有 Markdown 引用本地图片，未执行删除"],
  ])("translates migration cleanup failure %s", (error, expected) => {
    expect(migrationError(error)).toBe(expected);
  });

  it("hides migration cleanup scan diagnostics behind an actionable message", () => {
    expect(migrationError("migration_delete_scan_failed:permission_denied"))
      .toBe("无法确认引用替换结果，已保留本地图片");
  });
});
