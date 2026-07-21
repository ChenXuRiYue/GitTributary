import { describe, expect, it } from "vitest";

import { attachment } from "../../test/fixtures";
import { buildDomainStats, filterAndSortDomains } from "./model";

describe("domain model", () => {
  const domains = buildDomainStats([
    attachment({
      path: "https://example.com/a.png",
      kind: "link",
      linkKind: "image",
      domain: "example.com",
      references: [
        { notePath: "one.md", line: 1, role: "embed" },
        { notePath: "one.md", line: 2, role: "navigation" },
      ],
    }),
    attachment({
      path: "https://example.com/site",
      kind: "link",
      linkKind: "website",
      domain: "example.com",
      references: [{ notePath: "two.md", line: 4, role: "navigation" }],
    }),
    attachment({
      path: "https://cdn.example.com/file",
      kind: "link",
      linkKind: null,
      domain: "cdn.example.com",
      references: [],
    }),
    attachment({ path: "local.png", domain: "ignored.example.com" }),
    attachment({ path: "https://missing-domain.test", kind: "link", domain: null }),
  ]);

  it("groups link resources and deduplicates notes while preserving role counts", () => {
    expect(domains).toHaveLength(2);
    expect(domains.find((item) => item.domain === "example.com")).toMatchObject({
      total: 2,
      image: 1,
      website: 1,
      references: 3,
      uniqueNotes: 2,
      embed: 1,
      navigation: 2,
    });
    expect(domains.find((item) => item.domain === "cdn.example.com")).toMatchObject({
      total: 1,
      unknown: 1,
    });
  });

  it("filters by domain and supports every published sort mode", () => {
    expect(filterAndSortDomains(domains, "CDN", "resources").map((item) => item.domain))
      .toEqual(["cdn.example.com"]);
    expect(filterAndSortDomains(domains, "", "resources")[0]?.domain).toBe("example.com");
    expect(filterAndSortDomains(domains, "", "images")[0]?.domain).toBe("example.com");
    expect(filterAndSortDomains(domains, "", "references")[0]?.domain).toBe("example.com");
    expect(filterAndSortDomains(domains, "", "notes")[0]?.domain).toBe("example.com");
  });
});
