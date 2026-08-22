import { describe, expect, it } from "vitest";

import { buildFunnelEventBody, toFunnelRows } from "../src/connectors/ga4.js";

const noRows = { rows: [] };

const sampleWindow = { startDate: "2026-07-24", endDate: "2026-07-30", label: "最近 7 天" };

describe("buildFunnelEventBody", () => {
  it("builds an eventName inListFilter covering names + aliases, with eventCount/totalUsers metrics", () => {
    const body = buildFunnelEventBody(
      [{ name: "tool_start" }, { name: "signup", aliases: ["sign_up", "legacy_signup"] }],
      sampleWindow
    ) as Record<string, unknown>;

    expect(body.dateRanges).toEqual([{ startDate: "2026-07-24", endDate: "2026-07-30" }]);
    expect(body.dimensions).toEqual([{ name: "eventName" }]);
    expect(body.metrics).toEqual([{ name: "eventCount" }, { name: "totalUsers" }]);

    const filter = (body.dimensionFilter as { filter: { fieldName: string; inListFilter: { values: string[] } } }).filter;
    expect(filter.fieldName).toBe("eventName");
    expect(new Set(filter.inListFilter.values)).toEqual(new Set(["tool_start", "signup", "sign_up", "legacy_signup"]));
  });

  it("does not hardcode any single site's events", () => {
    const body = buildFunnelEventBody([], sampleWindow) as {
      dimensionFilter: { filter: { inListFilter: { values: string[] } } };
    };
    expect(body.dimensionFilter.filter.inListFilter.values).toEqual([]);
  });
});

describe("toFunnelRows", () => {
  it("emits a row for every configured event, defaulting absent events to 0 (so ZERO is distinguishable from not-queried)", () => {
    const configured = [{ name: "tool_start" }, { name: "upload_success" }];
    const response = {
      rows: [
        {
          dimensionValues: [{ value: "tool_start" }],
          metricValues: [{ value: "5" }, { value: "3" }]
        }
      ]
    };

    const rows = toFunnelRows(configured, response);

    expect(rows).toHaveLength(2);
    const tool = rows.find((row) => row.name === "tool_start");
    expect(tool?.eventCount).toBe(5);
    expect(tool?.totalUsers).toBe(3);

    const upload = rows.find((row) => row.name === "upload_success");
    expect(upload?.eventCount).toBe(0);
    expect(upload?.totalUsers).toBe(0);
  });

  it("rolls up alias counts into the canonical event", () => {
    const configured = [{ name: "signup", aliases: ["sign_up"] }];
    const response = {
      rows: [
        { dimensionValues: [{ value: "signup" }], metricValues: [{ value: "2" }, { value: "2" }] },
        { dimensionValues: [{ value: "sign_up" }], metricValues: [{ value: "3" }, { value: "3" }] }
      ]
    };

    expect(toFunnelRows(configured, response)[0]?.eventCount).toBe(5);
  });

  it("uses the configured label when provided, falling back to the name", () => {
    expect(toFunnelRows([{ name: "tool_start", label: "工具启动" }], noRows)[0]?.label).toBe("工具启动");
    expect(toFunnelRows([{ name: "tool_start" }], noRows)[0]?.label).toBe("tool_start");
  });

  it("returns an empty array for empty config", () => {
    expect(toFunnelRows([], noRows)).toEqual([]);
  });
});
