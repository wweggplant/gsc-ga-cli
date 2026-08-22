import type { SiteReportData } from "./metrics.js";
import { compareMetric, formatDelta, formatPageLabel, formatPercent, normalizePageKey } from "./metrics.js";
import type { Opportunity } from "./opportunities.js";
import { getChannelMetric } from "./channels.js";
import { buildFunnelSummary, type FunnelSummary } from "./funnel.js";

export interface NextAction {
  priority: "P0" | "P1";
  text: string;
}

export interface ReportInsights {
  summaryNarrative: string;
  summaryBullets: string[];
  opportunityBullets: string[];
  nextActions: NextAction[];
  funnel: FunnelSummary;
}

// |deltaPercent| at or above this is surfaced as a "notable" summary change even
// when no opportunity rule fired. Prevents the report from calling a crashed
// period "stable" just because detectOpportunities returned nothing.
const SUMMARY_SIGNIFICANT_DELTA_MIN = 0.2;

type MetricComparison = ReturnType<typeof compareMetric>;

interface SummaryMetricChange {
  label: string;
  change: MetricComparison;
}

function collectSignificantChanges(
  metrics: SummaryMetricChange[],
  threshold: number
): SummaryMetricChange[] {
  return metrics
    .filter((metric) => {
      const { deltaPercent, current, previous } = metric.change;
      // A newly-appearing metric (previous 0, current > 0) is itself notable.
      if (deltaPercent === null) {
        return current > 0;
      }
      return previous > 0 && Math.abs(deltaPercent) >= threshold;
    })
    .sort((left, right) => changeMagnitude(right.change) - changeMagnitude(left.change))
    .slice(0, 3);
}

function changeMagnitude(change: MetricComparison): number {
  if (change.deltaPercent === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(change.deltaPercent);
}

function describeMetricMovers(metrics: SummaryMetricChange[]): string {
  return metrics.map((metric) => `${metric.label} ${formatDelta(metric.change.deltaPercent)}`).join("、");
}

export function buildInsights(report: SiteReportData, opportunities: Opportunity[]): ReportInsights {
  const gscClicks = compareMetric(report.gsc.current.summary.clicks, report.gsc.previous.summary.clicks);
  const gscImpressions = compareMetric(
    report.gsc.current.summary.impressions,
    report.gsc.previous.summary.impressions
  );
  const gaSessions = compareMetric(report.ga4.current.summary.sessions, report.ga4.previous.summary.sessions);
  const gaUsers = compareMetric(report.ga4.current.summary.activeUsers, report.ga4.previous.summary.activeUsers);

  const currentOrganicShare = calculateOrganicShare(report.ga4.current.summary.sessions, report.ga4.current.channels);
  const previousOrganicShare = calculateOrganicShare(report.ga4.previous.summary.sessions, report.ga4.previous.channels);

  const significantChanges = collectSignificantChanges(
    [
      { label: "GSC 点击", change: gscClicks },
      { label: "GSC 展示", change: gscImpressions },
      { label: "GA4 sessions", change: gaSessions },
      { label: "GA4 active users", change: gaUsers }
    ],
    SUMMARY_SIGNIFICANT_DELTA_MIN
  );

  const topOpportunity = opportunities[0];
  const summaryNarrative = topOpportunity
    ? `最近一周期，${report.site.label} 的 GSC 点击 ${formatDelta(gscClicks.deltaPercent)}，GA4 sessions ${formatDelta(
        gaSessions.deltaPercent
      )}。当前最值得优先处理的是“${topOpportunity.title}”。`
    : significantChanges.length > 0
      ? `最近一周期，${report.site.label} 未命中高优先规则，但汇总指标出现明显变化（${describeMetricMovers(
          significantChanges
        )}），建议结合下方明细与更长时间窗进一步排查。`
      : `最近一周期，${report.site.label} 未命中高优先规则；汇总指标在显著变化阈值内（GSC 点击 ${formatDelta(
          gscClicks.deltaPercent
        )}、GA4 sessions ${formatDelta(
          gaSessions.deltaPercent
        )}），如样本量偏小可拉长时间窗或结合来源数据复核。`;

  const summaryBullets = [
    `GSC 点击：${gscClicks.current}（${formatDelta(gscClicks.deltaPercent)} vs ${report.windows.previous.label}）`,
    `GSC 展示：${gscImpressions.current}（${formatDelta(gscImpressions.deltaPercent)} vs ${report.windows.previous.label}）`,
    `平均 CTR：${formatPercent(report.gsc.current.summary.ctr)}（前周期 ${formatPercent(report.gsc.previous.summary.ctr)}）`,
    `GA4 sessions：${gaSessions.current}（${formatDelta(gaSessions.deltaPercent)} vs ${report.windows.previous.label}）`,
    `GA4 active users：${gaUsers.current}（${formatDelta(gaUsers.deltaPercent)} vs ${report.windows.previous.label}）`,
    `Organic Search 占比：${formatPercent(currentOrganicShare)}（前周期 ${formatPercent(previousOrganicShare)}）`
  ];

  const opportunityBullets =
    opportunities.length > 0
      ? opportunities.map((opportunity) => `[${opportunity.priority}] ${opportunity.title}：${opportunity.evidence}`)
      : ["当前没有命中高优先规则，建议继续观察 7 天，并补充更多页面级诊断。"];

  const nextActions = buildNextActions(opportunities);
  const funnel = buildFunnelSummary(report.ga4.current, report.ga4.previous);

  return {
    summaryNarrative,
    summaryBullets,
    opportunityBullets,
    nextActions,
    funnel
  };
}

function buildNextActions(opportunities: Opportunity[]): NextAction[] {
  const actions = opportunities
    .slice(0, 3)
    .map((opportunity) => ({
      priority: opportunity.priority,
      text: opportunity.recommendation
    }))
    .filter(
      (action, index, collection) =>
        collection.findIndex((entry) => entry.text === action.text) === index
    );

  const fallbackActions: NextAction[] = [
    {
      priority: "P0",
      text: "复核最近 7 天的 Top Queries、Top Pages 和 Organic Landing Pages，确认是否出现新的高意图词或异常页面。"
    },
    {
      priority: "P1",
      text: "从 Top Queries 中挑 1 个展现量持平、但点击率仍有提升空间的词，重写标题、description 和首屏承诺。"
    },
    {
      priority: "P1",
      text: "给当前主力页面补充 FAQ、小标题和相关内链，扩大已有搜索需求的覆盖面。"
    }
  ];

  for (const fallback of fallbackActions) {
    if (actions.length >= 3) {
      break;
    }

    if (actions.some((action) => action.text === fallback.text)) {
      continue;
    }

    actions.push(fallback);
  }

  return actions;
}

function calculateOrganicShare(
  totalSessions: number,
  channels: Array<{ channel: string; sessions: number }>
): number {
  if (totalSessions === 0) {
    return 0;
  }

  const organicSessions = getChannelMetric(channels, "Organic Search");
  return organicSessions / totalSessions;
}

export function buildSourceDataHighlights(report: SiteReportData): string[] {
  const topQuery = report.gsc.current.queries[0];
  const topPage = report.gsc.current.pages[0];
  const topLandingPage = report.ga4.current.landingPages[0];
  const latestDailyTrend = report.ga4.current.dailyTrend.at(-1);
  const topCountry = report.ga4.current.countries[0];
  const topGa4Page = report.ga4.current.pages[0];
  const topClarityUrl = report.clarity?.byUrl[0];

  const lines: string[] = [];

  if (topQuery) {
    lines.push(
      `Top Query：${topQuery.query} | 点击 ${topQuery.clicks} | 展示 ${topQuery.impressions} | CTR ${formatPercent(topQuery.ctr)}`
    );
  }

  if (topPage) {
    lines.push(
      `Top GSC Page：${formatPageLabel(topPage.page)} | 点击 ${topPage.clicks} | 展示 ${topPage.impressions} | CTR ${formatPercent(topPage.ctr)}`
    );
  }

  if (topLandingPage) {
    lines.push(
      `Top Organic Landing Page：${normalizePageKey(topLandingPage.landingPage)} | sessions ${topLandingPage.sessions} | active users ${topLandingPage.activeUsers}`
    );
  }

  if (latestDailyTrend) {
    lines.push(
      `Latest GA4 Daily Trend：${latestDailyTrend.date} | sessions ${latestDailyTrend.sessions} | active users ${latestDailyTrend.activeUsers} | page views ${latestDailyTrend.pageViews}`
    );
  }

  if (topCountry) {
    lines.push(`Top Country：${topCountry.country} | sessions ${topCountry.sessions} | active users ${topCountry.activeUsers}`);
  }

  if (topGa4Page) {
    lines.push(
      `Top GA4 Page：${normalizePageKey(topGa4Page.page)} | page views ${topGa4Page.pageViews} | sessions ${topGa4Page.sessions}`
    );
  }

  if (topClarityUrl) {
    lines.push(
      `Top Clarity URL：${normalizePageKey(topClarityUrl.dimension)} | sessions ${readClarityNumber(topClarityUrl.metrics, "traffic_totalSessionCount")}`
    );
  }

  return lines;
}

function readClarityNumber(metrics: Record<string, number | string>, key: string): number {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
