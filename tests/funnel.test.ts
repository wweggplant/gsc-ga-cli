import { describe, expect, it } from "vitest";

import { buildFunnelSummary } from "../src/domain/funnel.js";
import type { Ga4FunnelEventRow, Ga4WindowReport } from "../src/domain/metrics.js";

function windowWith(status: "ok" | "error", rows: Ga4FunnelEventRow[]): Ga4WindowReport {
  return {
    summary: { sessions: 0, activeUsers: 0 },
    landingPages: [],
    channels: [],
    dailyTrend: [],
    countries: [],
    pages: [],
    funnelStatus: status,
    funnelEvents: rows
  };
}

const bareWindow: Ga4WindowReport = {
  summary: { sessions: 0, activeUsers: 0 },
  landingPages: [],
  channels: [],
  dailyTrend: [],
  countries: [],
  pages: []
};

function row(name: string, eventCount: number, totalUsers = 0): Ga4FunnelEventRow {
  return { name, label: name, eventCount, totalUsers };
}

describe("buildFunnelSummary — coverage mapping", () => {
  it("reports NOT_CONFIGURED when neither window has funnel config", () => {
    const summary = buildFunnelSummary(bareWindow, { ...bareWindow });

    expect(summary.coverage).toBe("not-configured");
    expect(summary.events).toEqual([]);
  });

  it("reports NOT_MEASURED when a window's event query errored", () => {
    const previous = windowWith("ok", [row("tool_start", 3, 3)]);

    expect(buildFunnelSummary(windowWith("error", []), previous).coverage).toBe("not-measured");
    expect(buildFunnelSummary(previous, windowWith("error", [])).coverage).toBe("not-measured");
  });

  it("reports NOT_CONFIGURED when one window is unconfigured even if the other queried zero (ZERO requires both windows queried)", () => {
    const okZero = windowWith("ok", [row("tool_start", 0)]);

    expect(buildFunnelSummary(bareWindow, okZero).coverage).toBe("not-configured");
    expect(buildFunnelSummary(okZero, bareWindow).coverage).toBe("not-configured");
  });
});

describe("buildFunnelSummary — per-event status (ZERO vs measured)", () => {
  it("marks an event ZERO when queried successfully but 0 in both windows", () => {
    const summary = buildFunnelSummary(windowWith("ok", [row("tool_start", 0)]), windowWith("ok", [row("tool_start", 0)]));

    expect(summary.coverage).toBe("ok");
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]?.status).toBe("zero");
    expect(summary.events[0]?.currentCount).toBe(0);
    expect(summary.events[0]?.previousCount).toBe(0);
  });

  it("shows measured counts and compares current vs previous (visfeng analysis_submit)", () => {
    const summary = buildFunnelSummary(
      windowWith("ok", [row("analysis_submit", 0)]),
      windowWith("ok", [row("analysis_submit", 3, 3)])
    );

    expect(summary.events[0]?.status).toBe("measured");
    expect(summary.events[0]?.currentCount).toBe(0);
    expect(summary.events[0]?.previousCount).toBe(3);
    expect(summary.events[0]?.currentUsers).toBe(0);
    expect(summary.events[0]?.previousUsers).toBe(3);
  });

  it("keeps configured events that exist in only one window with the other side at 0", () => {
    const summary = buildFunnelSummary(
      windowWith("ok", [row("tool_start", 0), row("form_start", 4, 2)]),
      windowWith("ok", [row("tool_start", 0)])
    );

    const byName = new Map(summary.events.map((event) => [event.name, event]));
    expect(summary.events.map((event) => event.name).sort()).toEqual(["form_start", "tool_start"]);
    expect(byName.get("form_start")?.status).toBe("measured");
    expect(byName.get("form_start")?.previousCount).toBe(0);
  });
});
