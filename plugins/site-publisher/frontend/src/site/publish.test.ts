import { describe, expect, it } from "vitest";

import type { RemoteConfigEntry } from "./types";
import {
  buildPublishCandidates,
  credentialLabel,
  defaultPublishDraft,
  inferPagesUrl,
  isPublishCandidateUsable,
  makePublishTarget,
  normalizePathForCompare,
  publishCandidateStatus,
  purposeLabel,
  remoteUrlOwnerRepo,
  repositoryNameFromUrl,
  toPublishCandidate,
} from "./publish";

function remote(overrides: Partial<RemoteConfigEntry> = {}): RemoteConfigEntry {
  return {
    name: "origin",
    url: "https://github.com/octocat/docs.git",
    push_url: null,
    repo_path: "/fixtures/site",
    source: "project",
    purpose: [],
    credential_mode: "repo_token",
    credential_ref: "credential://project",
    commit_name: null,
    commit_email: null,
    verify_status: "verified",
    capabilities: "read-write",
    ...overrides,
  };
}

describe("site publishing targets", () => {
  it("parses GitHub HTTPS and SSH remotes and infers Pages URLs", () => {
    expect(remoteUrlOwnerRepo("git@github.com:octocat/docs.git")).toEqual({ owner: "octocat", repo: "docs" });
    expect(remoteUrlOwnerRepo("https://github.com/octocat/docs.git?x=1")).toEqual({ owner: "octocat", repo: "docs" });
    expect(remoteUrlOwnerRepo("https://gitlab.com/octocat/docs.git")).toBeNull();
    expect(inferPagesUrl("https://github.com/octocat/docs.git")).toBe("https://octocat.github.io/docs/");
    expect(inferPagesUrl("https://github.com/octocat/octocat.github.io.git")).toBe("https://octocat.github.io/");
    expect(repositoryNameFromUrl("ssh://host/team/site.git")).toBe("site");
  });

  it("normalizes paths before rejecting the source repository as a target", () => {
    expect(normalizePathForCompare("C:\\notes\\")).toBe("C:/notes");
    expect(publishCandidateStatus(remote({ repo_path: "C:\\notes" }), "C:/notes")).toMatchObject({
      status: "not-recommended",
      recommended: false,
    });
    expect(publishCandidateStatus(remote({ purpose: ["data_center_sync"] }), "/source"))
      .toMatchObject({ status: "not-recommended" });
    expect(publishCandidateStatus(remote({ repo_path: null }), "/source"))
      .toMatchObject({ status: "needs-local" });
    expect(publishCandidateStatus(remote(), "/source"))
      .toMatchObject({ status: "ready", recommended: true });
  });

  it("sorts the active target first, then declared publish targets and ready repositories", () => {
    const candidates = buildPublishCandidates([
      remote({ name: "z", repo_path: "/z", url: "https://github.com/o/z" }),
      remote({ name: "publish", repo_path: "/publish", url: "https://github.com/o/publish", purpose: ["publish_target"] }),
      remote({ name: "active", repo_path: "/active", url: "https://github.com/o/active" }),
      remote({ name: "remote-only", repo_path: null, url: "https://github.com/o/remote" }),
    ], "/source", "/active");
    expect(candidates.map((item) => item.id)).toEqual(["/active", "/publish", "/z", "https://github.com/o/remote"]);
  });

  it("builds stable publish targets and applies safe defaults", () => {
    const candidate = toPublishCandidate(remote(), "/source");
    expect(isPublishCandidateUsable(candidate)).toBe(true);
    expect(isPublishCandidateUsable(toPublishCandidate(remote({ repo_path: null }), "/source"))).toBe(false);
    const draft = defaultPublishDraft(candidate);
    expect(draft).toMatchObject({ targetBranch: "main", publishDir: "/" });
    expect(makePublishTarget(candidate, {
      targetBranch: " ",
      publishDir: " ",
      pagesUrl: " https://docs.example.com ",
      autoCommitMessage: " ",
    })).toMatchObject({
      targetBranch: "main",
      publishDir: "/",
      remoteName: "origin",
      pagesUrl: "https://docs.example.com",
      autoCommitMessage: "deploy: 更新文档站点",
    });
  });

  it("keeps host enum labels readable while preserving unknown future values", () => {
    expect(credentialLabel("ssh_agent")).toBe("SSH Agent");
    expect(credentialLabel("future_mode")).toBe("future_mode");
    expect(purposeLabel("pages-target")).toBe("Pages");
    expect(purposeLabel("future-purpose")).toBe("future-purpose");
  });
});
