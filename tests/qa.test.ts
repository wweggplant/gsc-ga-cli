import { describe, expect, it } from "vitest";

import { runReportQa } from "../src/domain/qa.js";
import { buildInsights } from "../src/domain/insights.js";
import type { Ga4WindowReport, SiteReportData } from "../src/domain/metrics.js";

function buildQaReport(overrides: {
  gscPages?: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>;
  ga4Current?: Partial<Ga4WindowReport>;
  ga4Previous?: Partial<Ga4WindowReport>;
}): SiteReportData {
  return {
    site: {
      key: "example-site",
      label: "Example Site",
      gscSiteUrl: "https://www.example.com/",
      ga4PropertyId: "123456789",
    },
    windows: {
      current: { startDate: "2026-07-24", endDate: "2026-07-30", label: "最近 7 天" },
      previous: { startDate: "2026-07-17", endDate: "2026-07-23", label: "前 7 天" }
    },
    gsc: {
      current: {
        summary: { clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
        queries: [],
        pages: overrides.gscPages ?? []
      },
      previous: {
        summary: { clicks: 8, impressions: 90, ctr: 0.09, position: 5 },
        queries: [],
        pages: []
      }
    },
    ga4: {
      current: {
        summary: { sessions: 50, activeUsers: 35 },
        landingPages: [],
        channels: [],
        dailyTrend: [],
        countries: [],
        pages: [],
        ...overrides.ga4Current
      },
      previous: {
        summary: { sessions: 40, activeUsers: 30 },
        landingPages: [],
        channels: [],
        dailyTrend: [],
        countries: [],
        pages: [],
        ...overrides.ga4Previous
      }
    }
  };
}

describe("runReportQa — clean report", () => {
  it("returns no warnings for a well-formed report", () => {
    const report = buildQaReport({
      gscPages: [{ page: "https://www.example.com/a/", clicks: 1, impressions: 10, ctr: 0.1, position: 1 }]
    });
    const insights = buildInsights(report, []);

    expect(runReportQa(report, insights)).toEqual([]);
  });
});

describe("runReportQa — key collision guard", () => {
  it("flags GSC page rows that collapse to the same display label", () => {
    const report = buildQaReport({
      gscPages: [
        { page: "https://www.example.com/a/", clicks: 1, impressions: 10, ctr: 0.1, position: 1 },
        { page: "https://www.example.com/a/", clicks: 2, impressions: 20, ctr: 0.1, position: 1 }
      ]
    });
    const insights = buildInsights(report, []);

    const warnings = runReportQa(report, insights);
    expect(warnings.some((warning) => warning.code === "gsc-page-key-collision")).toBe(true);
  });
});

describe("runReportQa — summary regression guard", () => {
  it("flags a narrative that concludes stable (must never happen post-fix)", () => {
    const report = buildQaReport({});
    const insights = buildInsights(report, []);
    const tampered = { ...insights, summaryNarrative: "整体稳定，没有异常。" };

    const warnings = runReportQa(report, tampered);
    expect(warnings.some((warning) => warning.code === "summary-false-stable")).toBe(true);
  });

  it("flags '稳定' anywhere in insight text, including next actions", () => {
    const report = buildQaReport({});
    const insights = buildInsights(report, []);
    const tampered = { ...insights, nextActions: [{ priority: "P1" as const, text: "展现稳定，继续观察。" }] };

    const warnings = runReportQa(report, tampered);
    expect(warnings.some((warning) => warning.code === "summary-false-stable")).toBe(true);
  });
});

describe("runReportQa — funnel coverage guard", () => {
  it("flags NOT_MEASURED funnel coverage", () => {
    const report = buildQaReport({
      ga4Current: { funnelStatus: "error", funnelEvents: [] },
      ga4Previous: { funnelStatus: "ok", funnelEvents: [] }
    });
    const insights = buildInsights(report, []);

    const warnings = runReportQa(report, insights);
    expect(warnings.some((warning) => warning.code === "funnel-not-measured")).toBe(true);
  });
});
