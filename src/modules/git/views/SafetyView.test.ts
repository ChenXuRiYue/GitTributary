import { describe, expect, it } from "vitest";

import { parseSafetyViewUiState } from "./SafetyView";

describe("Git safety draft persistence", () => {
  it("restores public fields and strips sensitive extras", () => {
    const parsed = parseSafetyViewUiState({
      version: 1,
      username: "octocat",
      email: "octocat@example.com",
      remoteUrl: "https://github.com/octocat/docs.git",
      sshPath: "~/.ssh/id_ed25519",
      token: "must-not-survive",
      showToken: true,
      updatedAt: 42,
    });

    expect(parsed).toEqual({
      version: 1,
      username: "octocat",
      email: "octocat@example.com",
      remoteUrl: "https://github.com/octocat/docs.git",
      sshPath: "~/.ssh/id_ed25519",
      updatedAt: 42,
    });
    expect(JSON.stringify(parsed)).not.toContain("must-not-survive");
  });
});
