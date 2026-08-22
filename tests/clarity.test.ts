import { describe, expect, it } from "vitest";

import { getClarityMetric, normalizeClarityResponse } from "../src/connectors/clarity.js";

describe("normalizeClarityResponse", () => {
  it("combines Clarity metric blocks by dimension", () => {
    const rows = normalizeClarityResponse(
      [
        {
          metricName: "Traffic",
          information: [
            {
              Url: "https://www.example.com/a/",
              totalSessionCount: "20",
              totalBotSessionCount: "2",
              distinctUserCount: "12"
            }
          ]
        },
        {
          metricName: "RageClickCount",
          information: [
            {
              Url: "https://www.example.com/a/",
              subTotal: "3"
            }
          ]
        }
      ],
      "URL"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.dimension).toBe("https://www.example.com/a/");
    expect(getClarityMetric(rows[0]!, ["traffic_totalSessionCount"])).toBe(20);
    expect(getClarityMetric(rows[0]!, ["rage_click_count_subTotal"])).toBe(3);
  });
});
