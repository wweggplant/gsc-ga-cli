import type { AppEnv } from "../config/runtime.js";
import type { SiteConfig } from "../config/sites.js";
import type { DateWindow } from "../shared/dates.js";
import { AppError } from "../shared/errors.js";
import type { GscPageRow, GscQueryRow, GscSummary, GscWindowReport } from "../domain/metrics.js";
import { googleRequest, wrapGoogleApiForbiddenError } from "./google.js";

const GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];
const GSC_SITES_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites";

interface GscSiteListResponse {
  siteEntry?: Array<{
    siteUrl: string;
    permissionLevel: string;
  }>;
}

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
}

export async function fetchGscWindowReport(
  env: AppEnv,
  site: SiteConfig,
  window: DateWindow
): Promise<GscWindowReport> {
  const siteEntries = await googleRequest<GscSiteListResponse>(GSC_SITES_URL, { method: "GET" }, {
    scopes: GSC_SCOPES,
    credentialsPath: env.googleCredentialsPath
  });

  const authorizedSite = siteEntries.siteEntry?.find((entry) => entry.siteUrl === site.gscSiteUrl);
  if (!authorizedSite) {
    throw new AppError(
      `GSC siteUrl "${site.gscSiteUrl}" 未在已授权站点列表中找到。请确认 Search Console 中添加的是 URL-prefix property；如果是 domain property，请改为 "sc-domain:example.com"。`,
      {
        code: "GSC_SITE_NOT_AUTHORIZED",
        hints: [
          "先在 Search Console 的“设置 -> 用户和权限”中添加 Service Account 邮箱。",
          "再通过 sites.list 确认返回值与 config/sites.json 中的 gscSiteUrl 完全一致。"
        ]
      }
    );
  }

  const [summaryResponse, queryResponse, pageResponse] = await Promise.all([
    searchAnalytics(env, site.gscSiteUrl, window, []),
    searchAnalytics(env, site.gscSiteUrl, window, ["query"]),
    searchAnalytics(env, site.gscSiteUrl, window, ["page"])
  ]);

  return {
    summary: toSummary(summaryResponse),
    queries: toQueryRows(queryResponse),
    pages: toPageRows(pageResponse)
  };
}

async function searchAnalytics(
  env: AppEnv,
  siteUrl: string,
  window: DateWindow,
  dimensions: string[]
): Promise<SearchAnalyticsResponse> {
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const body = {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions,
    rowLimit: dimensions.length === 0 ? 1 : 20,
    searchType: "web"
  };

  try {
    return await googleRequest<SearchAnalyticsResponse>(
      endpoint,
      {
        method: "POST",
        body: JSON.stringify(body)
      },
      {
        scopes: GSC_SCOPES,
        credentialsPath: env.googleCredentialsPath
      }
    );
  } catch (error) {
    wrapGoogleApiForbiddenError(
      error,
      `无法查询 GSC 站点 "${siteUrl}"。这通常是资源名格式错误或权限不足。`,
      "GSC_QUERY_FORBIDDEN",
      [
        'URL-prefix property 必须写成完整 URL，例如 "https://www.example.com/"。',
        'Domain property 必须写成 "sc-domain:example.com"。',
        "确认 Service Account 已被添加到该站点。"
      ]
    );
  }
}

function toSummary(response: SearchAnalyticsResponse): GscSummary {
  const row = response.rows?.[0];

  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? 0
  };
}

function toQueryRows(response: SearchAnalyticsResponse): GscQueryRow[] {
  return (response.rows ?? []).map((row) => ({
    query: row.keys?.[0] ?? "(unknown query)",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0
  }));
}

function toPageRows(response: SearchAnalyticsResponse): GscPageRow[] {
  return (response.rows ?? []).map((row) => ({
    page: row.keys?.[0] ?? "/",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0
  }));
}
