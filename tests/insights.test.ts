import { describe, expect, it } from "vitest";

import { buildInsights } from "../src/domain/insights.js";
import type { SiteReportData } from "../src/domain/metrics.js";

interface SummaryOpts {
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  sessions?: number;
  activeUsers?: number;
}

function buildSummaryReport(current: SummaryOpts, previous: SummaryOpts): SiteReportData {
  return {
    site: {
      key: "sample-app",
      label: "Sample App",
      gscSiteUrl: "sc-domain:sample-app.invalid",
      ga4PropertyId: "987650002",
    },
    windows: {
      current: { startDate: "2026-07-24", endDate: "2026-07-30", label: "最近 7 天" },
      previous: { startDate: "2026-07-17", endDate: "2026-07-23", label: "前 7 天" }
    },
    gsc: {
      current: {
        summary: {
          clicks: current.clicks ?? 0,
          impressions: current.impressions ?? 0,
          ctr: current.ctr ?? 0,
          position: current.position ?? 0
        },
        queries: [],
        pages: []
      },
      previous: {
        summary: {
          clicks: previous.clicks ?? 0,
          impressions: previous.impressions ?? 0,
          ctr: previous.ctr ?? 0,
          position: previous.position ?? 0
        },
        queries: [],
        pages: []
      }
    },
    ga4: {
      current: {
        summary: { sessions: current.sessions ?? 0, activeUsers: current.activeUsers ?? 0 },
        landingPages: [],
        channels: [],
        dailyTrend: [],
        countries: [],
        pages: []
      },
      previous: {
        summary: { sessions: previous.sessions ?? 0, activeUsers: previous.activeUsers ?? 0 },
        landingPages: [],
        channels: [],
        dailyTrend: [],
        countries: [],
        pages: []
      }
    }
  };
}

describe("buildInsights — summary narrative semantics", () => {
  it("does NOT call the period stable when summary metrics crash with no opportunity (X IQ case)", () => {
    // Clicks 42 -> 0 (-100%), impressions 1000 -> 291 (-70.9%), yet no opportunity fired.
    const report = buildSummaryReport(
      { clicks: 0, impressions: 291, ctr: 0, position: 0 },
      { clicks: 42, impressions: 1000, ctr: 0.12, position: 12 }
    );

    const insights = buildInsights(report, []);

    expect(insights.summaryNarrative).not.toContain("稳定");
    expect(insights.summaryNarrative).toContain("未命中高优先规则");
    expect(insights.summaryNarrative).toContain("-100.0%");
    expect(insights.summaryNarrative).toContain("-70.9%");
  });

  it("does not equate a quiet period with no opportunity to stable either", () => {
    const report = buildSummaryReport(
      { clicks: 100, impressions: 1000, ctr: 0.1, position: 8, sessions: 50, activeUsers: 40 },
      { clicks: 98, impressions: 995, ctr: 0.1, position: 8.2, sessions: 49, activeUsers: 39 }
    );

    const insights = buildInsights(report, []);

    expect(insights.summaryNarrative).not.toContain("稳定");
    expect(insights.summaryNarrative).toContain("未命中高优先规则");
  });

  it("still names the top opportunity first when one exists", () => {
    const report = buildSummaryReport(
      { clicks: 0, impressions: 100, ctr: 0, position: 0 },
      { clicks: 42, impressions: 343, ctr: 0.12, position: 12 }
    );

    const insights = buildInsights(report, [
      {
        id: "manual:1",
        priority: "P0",
        area: "GSC",
        title: "测试机会标题",
        evidence: "证据",
        recommendation: "建议",
        score: 100
      }
    ]);

    expect(insights.summaryNarrative).toContain("测试机会标题");
  });
});
