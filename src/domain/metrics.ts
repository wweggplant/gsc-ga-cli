import type { SiteConfig } from "../config/sites.js";
import type { DateWindow } from "../shared/dates.js";

export interface ComparisonMetric {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
}

export interface GscSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscPageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscWindowReport {
  summary: GscSummary;
  queries: GscQueryRow[];
  pages: GscPageRow[];
}

export interface Ga4Summary {
  sessions: number;
  activeUsers: number;
}

export interface Ga4LandingPageRow {
  landingPage: string;
  sessions: number;
  activeUsers: number;
}

export interface Ga4ChannelRow {
  channel: string;
  sessions: number;
  activeUsers: number;
}

export interface Ga4DailyRow {
  date: string;
  sessions: number;
  activeUsers: number;
  pageViews: number;
}

export interface Ga4CountryRow {
  country: string;
  sessions: number;
  activeUsers: number;
}

export interface Ga4PageRow {
  page: string;
  pageViews: number;
  sessions: number;
}

/**
 * Per-window funnel event measurement for one configured event. A row is emitted
 * for every configured event even when the API returns no rows for it (count 0),
 * so a genuine zero is distinguishable from "not queried".
 */
export interface Ga4FunnelEventRow {
  /** Canonical configured event name. */
  name: string;
  /** Display label (falls back to name). */
  label: string;
  eventCount: number;
  totalUsers: number;
}

/**
 * not-configured: site has no funnelEvents config (field absent).
 * ok: event query succeeded.
 * error: event query failed (NOT_MEASURED — we could not measure this window).
 */
export type Ga4FunnelStatus = "not-configured" | "ok" | "error";

export interface Ga4WindowReport {
  summary: Ga4Summary;
  landingPages: Ga4LandingPageRow[];
  channels: Ga4ChannelRow[];
  dailyTrend: Ga4DailyRow[];
  countries: Ga4CountryRow[];
  pages: Ga4PageRow[];
  funnelEvents?: Ga4FunnelEventRow[];
  funnelStatus?: Ga4FunnelStatus;
}

export interface ClarityDimensionRow {
  dimension: string;
  metrics: Record<string, number | string>;
}

export interface ClarityWindowReport {
  numOfDays: 1 | 2 | 3;
  byUrl: ClarityDimensionRow[];
  byDevice: ClarityDimensionRow[];
}

export interface SiteReportData {
  site: SiteConfig;
  windows: {
    current: DateWindow;
    previous: DateWindow;
  };
  gsc: {
    current: GscWindowReport;
    previous: GscWindowReport;
  };
  ga4: {
    current: Ga4WindowReport;
    previous: Ga4WindowReport;
  };
  clarity?: ClarityWindowReport;
}

export function compareMetric(current: number, previous: number): ComparisonMetric {
  const delta = current - previous;

  if (previous === 0) {
    return {
      current,
      previous,
      delta,
      deltaPercent: current === 0 ? 0 : null
    };
  }

  return {
    current,
    previous,
    delta,
    deltaPercent: delta / previous
  };
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDelta(value: number | null, digits = 1): string {
  if (value === null) {
    return "new";
  }

  const percent = value * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(digits)}%`;
}

// Dimension values that mean "page unknown". Empty strings and these placeholders
// must never collapse onto a real root path ("/"), otherwise distinct raw rows
// silently collide (see Flow landing-page empty-string bug).
const PAGE_SENTINEL_VALUES = new Set([
  "(not set)",
  "(other)",
  "(not provided)",
  "(data source not available)",
  "(none)",
  "(unknown)"
]);

// Empty input is its own category — distinct from GA4's literal "(not set)"
// label and from a real root path ("/"). All three must stay distinguishable.
const PAGE_EMPTY_LABEL = "(empty)";

function isPageSentinel(value: string): boolean {
  return PAGE_SENTINEL_VALUES.has(value.toLowerCase());
}

/**
 * Canonical PATH key: extracts pathname+search from full URLs and normalizes
 * path-like input. Used for cross-source matching (GSC URL <-> GA4 path) and as
 * a grouping base. Empty / placeholder values resolve to labels that are all
 * distinct from a real root path ("/") and from each other.
 */
export function normalizePageKey(value: string): string {
  const trimmed = (value ?? "").trim();

  if (trimmed === "") {
    return PAGE_EMPTY_LABEL;
  }

  if (isPageSentinel(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname + parsed.search;
    return path === "" ? "/" : path;
  } catch {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
}

/**
 * Injective comparison key for period-over-period decline detection. Distinct
 * raw values stay distinct (empty != "/", https://www != http://), so different
 * original rows can never silently overwrite or cross-match each other.
 */
export function pageComparisonKey(value: string): string {
  return (value ?? "").trim();
}

/**
 * Distinguishing DISPLAY label. Full URLs keep their protocol+host so that
 * variants (https vs http, www vs apex) remain visually distinct; path-style
 * input is normalized; empty / placeholder values render as distinct labels.
 */
export function formatPageLabel(value: string): string {
  const trimmed = (value ?? "").trim();

  if (trimmed === "") {
    return PAGE_EMPTY_LABEL;
  }

  if (isPageSentinel(trimmed)) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
