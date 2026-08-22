import type { AppEnv } from "../config/runtime.js";
import type { SiteConfig } from "../config/sites.js";
import type { DateWindow } from "../shared/dates.js";
import type {
  Ga4ChannelRow,
  Ga4CountryRow,
  Ga4DailyRow,
  Ga4FunnelEventRow,
  Ga4LandingPageRow,
  Ga4PageRow,
  Ga4Summary,
  Ga4WindowReport
} from "../domain/metrics.js";
import { googleRequest, wrapGoogleApiForbiddenError } from "./google.js";

const GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

interface Ga4RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
}

export async function fetchGa4WindowReport(
  env: AppEnv,
  site: SiteConfig,
  window: DateWindow
): Promise<Ga4WindowReport> {
  const [
    summaryResponse,
    landingPagesResponse,
    channelResponse,
    dailyTrendResponse,
    countriesResponse,
    pagesResponse
  ] = await Promise.all([
    runReport(env, site.ga4PropertyId, {
      dateRanges: [toDateRange(window)],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }]
    }),
    runReport(env, site.ga4PropertyId, {
      dateRanges: [toDateRange(window)],
      dimensions: [{ name: "landingPagePlusQueryString" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      dimensionFilter: {
        filter: {
          fieldName: "sessionDefaultChannelGroup",
          stringFilter: {
            matchType: "EXACT",
            value: "Organic Search"
          }
        }
      },
      orderBys: [
        {
          metric: {
            metricName: "sessions"
          },
          desc: true
        }
      ],
      limit: "20"
    }),
    runReport(env, site.ga4PropertyId, {
      dateRanges: [toDateRange(window)],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [
        {
          metric: {
            metricName: "sessions"
          },
          desc: true
        }
      ],
      limit: "10"
    }),
    runReport(env, site.ga4PropertyId, {
      dateRanges: [toDateRange(window)],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }],
      orderBys: [
        {
          dimension: {
            dimensionName: "date"
          }
        }
      ],
      limit: "100"
    }),
    runReport(env, site.ga4PropertyId, {
      dateRanges: [toDateRange(window)],
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [
        {
          metric: {
            metricName: "sessions"
          },
          desc: true
        }
      ],
      limit: "10"
    }),
    runReport(env, site.ga4PropertyId, {
      dateRanges: [toDateRange(window)],
      dimensions: [{ name: "pagePathPlusQueryString" }],
      metrics: [{ name: "screenPageViews" }, { name: "sessions" }],
      orderBys: [
        {
          metric: {
            metricName: "screenPageViews"
          },
          desc: true
        }
      ],
      limit: "15"
    })
  ]);

  return composeWindowReport(
    site,
    window,
    {
      summary: toSummary(summaryResponse),
      landingPages: toLandingPages(landingPagesResponse),
      channels: toChannels(channelResponse),
      dailyTrend: toDailyTrend(dailyTrendResponse),
      countries: toCountries(countriesResponse),
      pages: toPages(pagesResponse)
    },
    env
  );
}

interface ConfiguredFunnelEvent {
  name: string;
  label?: string;
  aliases?: string[];
}

// Funnel events are supplementary: a failure here must NOT fail the core report.
// Returns funnelStatus "error" (NOT_MEASURED) instead so the report can say so.
async function composeWindowReport(
  site: SiteConfig,
  window: DateWindow,
  base: Omit<Ga4WindowReport, "funnelEvents" | "funnelStatus">,
  env: AppEnv
): Promise<Ga4WindowReport> {
  const configured = (site.funnelEvents ?? []) satisfies ConfiguredFunnelEvent[];
  if (configured.length === 0) {
    return base;
  }

  try {
    const funnelResponse = await runReport(env, site.ga4PropertyId, buildFunnelEventBody(configured, window));
    return { ...base, funnelStatus: "ok", funnelEvents: toFunnelRows(configured, funnelResponse) };
  } catch {
    return { ...base, funnelStatus: "error", funnelEvents: [] };
  }
}

export function buildFunnelEventBody(events: ConfiguredFunnelEvent[], window: DateWindow): Record<string, unknown> {
  const names = new Set<string>();
  for (const event of events) {
    names.add(event.name);
    for (const alias of event.aliases ?? []) {
      names.add(alias);
    }
  }

  return {
    dateRanges: [toDateRange(window)],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: {
          values: [...names]
        }
      }
    },
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: "100"
  };
}

/**
 * Left-joins configured events onto the API response. A configured event with no
 * matching row is emitted with count 0, so a genuine ZERO (queried, truly 0) is
 * distinguishable from "event not configured / not queried". Alias counts roll
 * up into the canonical event (eventCount summed; totalUsers takes the max to
 * avoid double-counting users who fired both names).
 */
export function toFunnelRows(
  configured: ConfiguredFunnelEvent[],
  response: Ga4RunReportResponse
): Ga4FunnelEventRow[] {
  const byName = new Map<string, { eventCount: number; totalUsers: number }>();

  for (const row of response.rows ?? []) {
    const name = row.dimensionValues?.[0]?.value ?? "";
    if (!name) {
      continue;
    }

    const eventCount = toNumber(row.metricValues?.[0]?.value);
    const totalUsers = toNumber(row.metricValues?.[1]?.value);
    const existing = byName.get(name);

    if (existing) {
      existing.eventCount += eventCount;
      existing.totalUsers = Math.max(existing.totalUsers, totalUsers);
    } else {
      byName.set(name, { eventCount, totalUsers });
    }
  }

  return configured.map((event) => {
    const names = [event.name, ...(event.aliases ?? [])];
    let eventCount = 0;
    let totalUsers = 0;

    for (const name of names) {
      const found = byName.get(name);
      if (found) {
        eventCount += found.eventCount;
        totalUsers = Math.max(totalUsers, found.totalUsers);
      }
    }

    return {
      name: event.name,
      label: event.label ?? event.name,
      eventCount,
      totalUsers
    };
  });
}

async function runReport(
  env: AppEnv,
  propertyId: string,
  body: Record<string, unknown>
): Promise<Ga4RunReportResponse> {
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

  try {
    return await googleRequest<Ga4RunReportResponse>(
      endpoint,
      {
        method: "POST",
        body: JSON.stringify(body)
      },
      {
        scopes: GA4_SCOPES,
        credentialsPath: env.googleCredentialsPath
      }
    );
  } catch (error) {
    wrapGoogleApiForbiddenError(
      error,
      `GA4 propertyId "${propertyId}" 无访问权限。请确认已将 Service Account 添加为 Viewer，并确认填写的是 Property ID 而不是 Data Stream ID。`,
      "GA4_PROPERTY_FORBIDDEN",
      [
        "打开 Google Analytics -> 管理 -> 媒体资源访问权限管理，给 Service Account 邮箱添加 Viewer。",
        "确认 propertyId 是「媒体资源详情」里的纯数字。"
      ]
    );
  }
}

function toDateRange(window: DateWindow): { startDate: string; endDate: string } {
  return {
    startDate: window.startDate,
    endDate: window.endDate
  };
}

function toSummary(response: Ga4RunReportResponse): Ga4Summary {
  const row = response.rows?.[0];

  return {
    sessions: toNumber(row?.metricValues?.[0]?.value),
    activeUsers: toNumber(row?.metricValues?.[1]?.value)
  };
}

function toLandingPages(response: Ga4RunReportResponse): Ga4LandingPageRow[] {
  return (response.rows ?? []).map((row) => ({
    landingPage: row.dimensionValues?.[0]?.value ?? "(not set)",
    sessions: toNumber(row.metricValues?.[0]?.value),
    activeUsers: toNumber(row.metricValues?.[1]?.value)
  }));
}

function toChannels(response: Ga4RunReportResponse): Ga4ChannelRow[] {
  return (response.rows ?? []).map((row) => ({
    channel: row.dimensionValues?.[0]?.value ?? "(unknown channel)",
    sessions: toNumber(row.metricValues?.[0]?.value),
    activeUsers: toNumber(row.metricValues?.[1]?.value)
  }));
}

function toDailyTrend(response: Ga4RunReportResponse): Ga4DailyRow[] {
  return (response.rows ?? []).map((row) => ({
    date: formatGa4Date(row.dimensionValues?.[0]?.value ?? ""),
    sessions: toNumber(row.metricValues?.[0]?.value),
    activeUsers: toNumber(row.metricValues?.[1]?.value),
    pageViews: toNumber(row.metricValues?.[2]?.value)
  }));
}

function toCountries(response: Ga4RunReportResponse): Ga4CountryRow[] {
  return (response.rows ?? []).map((row) => ({
    country: row.dimensionValues?.[0]?.value ?? "(unknown country)",
    sessions: toNumber(row.metricValues?.[0]?.value),
    activeUsers: toNumber(row.metricValues?.[1]?.value)
  }));
}

function toPages(response: Ga4RunReportResponse): Ga4PageRow[] {
  return (response.rows ?? []).map((row) => ({
    page: row.dimensionValues?.[0]?.value ?? "(not set)",
    pageViews: toNumber(row.metricValues?.[0]?.value),
    sessions: toNumber(row.metricValues?.[1]?.value)
  }));
}

function toNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatGa4Date(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
