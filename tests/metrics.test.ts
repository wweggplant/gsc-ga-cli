import { describe, expect, it } from "vitest";

import { formatPageLabel, normalizePageKey, pageComparisonKey } from "../src/domain/metrics.js";

describe("normalizePageKey — path/sentinel semantics (no silent collision)", () => {
  it("maps empty/whitespace to a label distinct from a real home page and from (not set)", () => {
    expect(normalizePageKey("")).not.toBe("/");
    expect(normalizePageKey("   ")).not.toBe("/");
    expect(normalizePageKey("")).toBe(normalizePageKey("   "));
  });

  it("keeps empty, (not set), and a real '/' as three distinct values", () => {
    const empty = normalizePageKey("");
    const notSet = normalizePageKey("(not set)");
    const root = normalizePageKey("/");
    expect(new Set([empty, notSet, root]).size).toBe(3);
  });

  it("keeps a real root path as '/'", () => {
    expect(normalizePageKey("/")).toBe("/");
  });

  it("keeps GA4/GSC placeholder sentinels distinct from '/'", () => {
    expect(normalizePageKey("(not set)")).toBe("(not set)");
    expect(normalizePageKey("(other)")).toBe("(other)");
    expect(normalizePageKey("(not set)")).not.toBe("/");
  });

  it("extracts path+search from full URLs", () => {
    expect(normalizePageKey("https://www.example.com/article-1/?x=1")).toBe("/article-1/?x=1");
    expect(normalizePageKey("https://www.example.com/")).toBe("/");
  });
});

describe("pageComparisonKey — injective across distinct raw values", () => {
  it("keeps an empty landing page distinct from a real root path", () => {
    expect(pageComparisonKey("")).not.toBe(pageComparisonKey("/"));
  });

  it("keeps protocol/host URL variants distinct (no silent cross-match)", () => {
    expect(pageComparisonKey("https://www.catch-a-brainrot-game.wiki/")).not.toBe(
      pageComparisonKey("http://catch-a-brainrot-game.wiki/")
    );
  });

  it("is stable for identical raw values", () => {
    expect(pageComparisonKey("/about")).toBe(pageComparisonKey("/about"));
  });
});

describe("formatPageLabel — distinguishing display label", () => {
  it("renders a sentinel for empty input, not a misleading '/'", () => {
    expect(formatPageLabel("")).toBe("(empty)");
    expect(formatPageLabel("")).not.toBe("/");
    expect(formatPageLabel("")).not.toBe(formatPageLabel("(not set)"));
  });

  it("preserves the full URL so protocol/host variants stay distinguishable", () => {
    const httpsLabel = formatPageLabel("https://www.catch-a-brainrot-game.wiki/");
    const httpLabel = formatPageLabel("http://catch-a-brainrot-game.wiki/");

    expect(httpsLabel).not.toBe(httpLabel);
    expect(httpsLabel).toContain("https://www.catch-a-brainrot-game.wiki");
    expect(httpLabel).toContain("http://catch-a-brainrot-game.wiki");
  });

  it("shows a normalized path for path-style input", () => {
    expect(formatPageLabel("/article-1/")).toBe("/article-1/");
    expect(formatPageLabel("article-1/")).toBe("/article-1/");
  });
});
