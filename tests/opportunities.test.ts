import { describe, expect, it } from "vitest";

import type { SiteReportData } from "../src/domain/metrics.js";
import { detectOpportunities } from "../src/domain/opportunities.js";

function createReportFixture(): SiteReportData {
  return {
    site: {
      key: "example-site",
      label: "Example Site",
      gscSiteUrl: "https://www.sample.invalid/",
      ga4PropertyId: "987650001",
    },
    windows: {
      current: {
        startDate: "2026-02-24",
        endDate: "2026-03-02",
        label: "最近 7 天"
      },
      previous: {
        startDate: "2026-02-17",
        endDate: "2026-02-23",
        label: "前 7 天"
      }
    },
    gsc: {
      current: {
        summary: {
          clicks: 120,
          impressions: 8000,
          ctr: 0.015,
          position: 10.5
        },
        queries: [
          {
            query: "example site",
            clicks: 30,
            impressions: 2400,
            ctr: 0.0125,
            position: 6.2
          },
          {
            query: "example content tips",
            clicks: 16,
            impressions: 600,
            ctr: 0.026,
            position: 9.7
          }
        ],
        pages: [
          {
            page: "https://www.sample.invalid/article-1/",
            clicks: 25,
            impressions: 1500,
            ctr: 0.016,
            position: 8.8
          },
          {
            page: "https://www.sample.invalid/article-2/",
            clicks: 15,
            impressions: 500,
            ctr: 0.03,
            position: 12.1
          }
        ]
      },
      previous: {
        summary: {
          clicks: 160,
          impressions: 7600,
          ctr: 0.021,
          position: 9.8
        },
        queries: [],
        pages: [
          {
            page: "https://www.sample.invalid/article-1/",
            clicks: 45,
            impressions: 1800,
            ctr: 0.025,
            position: 7.9
          }
        ]
      }
    },
    ga4: {
      current: {
        summary: {
          sessions: 220,
          activeUsers: 180
        },
        landingPages: [
          {
            landingPage: "/article-1/",
            sessions: 90,
            activeUsers: 70
          }
        ],
        channels: [
          {
            channel: "Organic Search",
            sessions: 120,
            activeUsers: 100
          },
          {
            channel: "Direct",
            sessions: 80,
            activeUsers: 65
          }
        ],
        dailyTrend: [
          {
            date: "2026-03-02",
            sessions: 40,
            activeUsers: 32,
            pageViews: 85
          }
        ],
        countries: [
          {
            country: "United States",
            sessions: 120,
            activeUsers: 100
          }
        ],
        pages: [
          {
            page: "/article-1/",
            pageViews: 130,
            sessions: 90
          }
        ]
      },
      previous: {
        summary: {
          sessions: 320,
          activeUsers: 250
        },
        landingPages: [
          {
            landingPage: "/article-1/",
            sessions: 150,
            activeUsers: 120
          }
        ],
        channels: [
          {
            channel: "Organic Search",
            sessions: 220,
            activeUsers: 160
          },
          {
            channel: "Direct",
            sessions: 70,
            activeUsers: 50
          }
        ],
        dailyTrend: [],
        countries: [],
        pages: []
      }
    }
  };
}

describe("detectOpportunities", () => {
  it("identifies low CTR, page decline, and cross-source opportunities", () => {
    const opportunities = detectOpportunities(createReportFixture());

    expect(opportunities.length).toBeGreaterThan(0);
    expect(opportunities.some((item) => item.id.startsWith("gsc-low-ctr-query:"))).toBe(true);
    expect(opportunities.some((item) => item.id.startsWith("gsc-page-decline:"))).toBe(true);
    expect(opportunities.some((item) => item.id.startsWith("cross-gsc-ga4:"))).toBe(true);
  });
});

// Regression: the Flow landing-page empty-string collision. The current window
// returned both a real home page "/" and an empty "" row; normalizePageKey("")
// collapsed to "/", so detectDecliningItems matched the empty row against the
// previous home page and reported a false ~99.9% decline.
function createCollisionReport(overrides: {
  ga4CurrentLanding?: Array<{ landingPage: string; sessions: number; activeUsers: number }>;
  ga4PreviousLanding?: Array<{ landingPage: string; sessions: number; activeUsers: number }>;
  gscCurrentPages?: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
  gscPreviousPages?: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
}): SiteReportData {
  return {
    site: {
      key: "sample-flow",
      label: "Sample Flow",
      gscSiteUrl: "sc-domain:sample-flow.invalid",
      ga4PropertyId: "987650003",
    },
    windows: {
      current: { startDate: "2026-07-24", endDate: "2026-07-30", label: "最近 7 天" },
      previous: { startDate: "2026-07-17", endDate: "2026-07-23", label: "前 7 天" }
    },
    gsc: {
      current: {
        summary: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
        queries: [],
        pages: overrides.gscCurrentPages ?? []
      },
      previous: {
        summary: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
        queries: [],
        pages: overrides.gscPreviousPages ?? []
      }
    },
    ga4: {
      current: {
        summary: { sessions: 0, activeUsers: 0 },
        landingPages: overrides.ga4CurrentLanding ?? [],
        channels: [],
        dailyTrend: [],
        countries: [],
        pages: []
      },
      previous: {
        summary: { sessions: 0, activeUsers: 0 },
        landingPages: overrides.ga4PreviousLanding ?? [],
        channels: [],
        dailyTrend: [],
        countries: [],
        pages: []
      }
    }
  };
}

describe("detectOpportunities — page-key collision safety", () => {
  it("does not flag a false landing-page decline when an empty row collides with the real home page", () => {
    const report = createCollisionReport({
      ga4CurrentLanding: [
        { landingPage: "/", sessions: 1307, activeUsers: 0 },
        { landingPage: "", sessions: 2, activeUsers: 0 }
      ],
      ga4PreviousLanding: [{ landingPage: "/", sessions: 1358, activeUsers: 0 }]
    });

    const opportunities = detectOpportunities(report);

    expect(opportunities.some((item) => item.id.startsWith("ga4-landing-decline:"))).toBe(false);
  });

  it("still detects a real landing-page decline on the same raw key", () => {
    const report = createCollisionReport({
      ga4CurrentLanding: [{ landingPage: "/drops/", sessions: 30, activeUsers: 0 }],
      ga4PreviousLanding: [{ landingPage: "/drops/", sessions: 200, activeUsers: 0 }]
    });

    const opportunities = detectOpportunities(report);

    expect(
      opportunities.some(
        (item) => item.id.startsWith("ga4-landing-decline:") && item.title.includes("/drops/")
      )
    ).toBe(true);
  });

  it("does not cross-match GSC pages that differ only by protocol/host", () => {
    const report = createCollisionReport({
      gscCurrentPages: [
        { page: "https://www.catch-a-brainrot-game.wiki/", clicks: 10, impressions: 0, ctr: 0, position: 0 }
      ],
      gscPreviousPages: [
        { page: "http://catch-a-brainrot-game.wiki/", clicks: 500, impressions: 0, ctr: 0, position: 0 }
      ]
    });

    const opportunities = detectOpportunities(report);

    expect(opportunities.some((item) => item.id.startsWith("gsc-page-decline:"))).toBe(false);
  });

  it("still detects a real GSC page decline on the same raw URL", () => {
    const report = createCollisionReport({
      gscCurrentPages: [
        { page: "https://www.sample.invalid/article-1/", clicks: 25, impressions: 0, ctr: 0, position: 0 }
      ],
      gscPreviousPages: [
        { page: "https://www.sample.invalid/article-1/", clicks: 200, impressions: 0, ctr: 0, position: 0 }
      ]
    });

    const opportunities = detectOpportunities(report);

    expect(opportunities.some((item) => item.id.startsWith("gsc-page-decline:"))).toBe(true);
  });

  it("renders a low-CTR GSC page opportunity with the full URL, not a bare '/'", () => {
    const report = createCollisionReport({
      gscCurrentPages: [
        { page: "https://www.catch-a-brainrot-game.wiki/", clicks: 1, impressions: 500, ctr: 0.01, position: 1 }
      ]
    });

    const opportunities = detectOpportunities(report);
    const lowCtr = opportunities.find((item) => item.id.startsWith("gsc-low-ctr-page:"));

    expect(lowCtr).toBeTruthy();
    expect(lowCtr?.title).toContain("https://www.catch-a-brainrot-game.wiki/");
    expect(lowCtr?.title).not.toBe("高展现低点击页面：/");
  });

  it("emits the matched full GSC URL in the cross-source opportunity and picks the top variant", () => {
    const report = createCollisionReport({
      gscCurrentPages: [
        { page: "https://www.catch-a-brainrot-game.wiki/", clicks: 5, impressions: 500, ctr: 0.02, position: 1 },
        { page: "http://catch-a-brainrot-game.wiki/", clicks: 2, impressions: 200, ctr: 0.02, position: 2 }
      ],
      ga4CurrentLanding: [{ landingPage: "/", sessions: 50, activeUsers: 40 }]
    });

    const cross = detectOpportunities(report).find((item) => item.id.startsWith("cross-gsc-ga4:"));

    expect(cross).toBeTruthy();
    expect(cross?.title).toContain("https://www.catch-a-brainrot-game.wiki/");
    expect(cross?.title).not.toContain("http://catch-a-brainrot-game.wiki/");
    expect(cross?.title).not.toBe("高流量页仍有点击率优化空间：/");
  });
});
