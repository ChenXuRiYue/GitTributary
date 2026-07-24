import { describe, expect, it } from "vitest";

import { parseGitSettingsUiState } from "./GitSettings";

describe("Git settings draft persistence", () => {
  it("parses a complete versioned draft", () => {
    const parsed = parseGitSettingsUiState({
      version: 1,
      username: "octocat",
      email: "octocat@example.com",
      remoteUrl: "https://github.com/octocat/docs.git",
      sshPath: "~/.ssh/id_ed25519",
      updatedAt: 123,
    });

    expect(parsed).toEqual({
      version: 1,
      username: "octocat",
      email: "octocat@example.com",
      remoteUrl: "https://github.com/octocat/docs.git",
      sshPath: "~/.ssh/id_ed25519",
      updatedAt: 123,
    });
  });

  it("rejects incomplete drafts", () => {
    expect(parseGitSettingsUiState({ version: 1, username: "octocat" })).toBeNull();
  });
});
