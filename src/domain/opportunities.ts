import type {
  Ga4LandingPageRow,
  SiteReportData,
  GscPageRow,
  GscQueryRow
} from "./metrics.js";
import { formatPageLabel, normalizePageKey, pageComparisonKey } from "./metrics.js";
import {
  OPPORTUNITY_ID_PREFIXES,
  OPPORTUNITY_PRIORITIES,
  OPPORTUNITY_AREAS,
  OPPORTUNITY_THRESHOLDS,
  OPPORTUNITY_LIMITS
} from "./constants.js";
import { getChannelMetric } from "./channels.js";

export type OpportunityPriority = "P0" | "P1";
export type OpportunityArea = "GSC" | "GA4" | "Cross";

export interface Opportunity {
  id: string;
  priority: OpportunityPriority;
  area: OpportunityArea;
  title: string;
  evidence: string;
  recommendation: string;
  score: number;
}

export function detectOpportunities(report: SiteReportData): Opportunity[] {
  const opportunities: Opportunity[] = [];

  const lowCtrQueries = report.gsc.current.queries
    .filter((row) => row.impressions >= OPPORTUNITY_THRESHOLDS.LOW_CTR_IMPRESSIONS_MIN && row.ctr <= OPPORTUNITY_THRESHOLDS.LOW_CTR_MAX)
    .sort((left, right) => rankLowCtrQuery(right) - rankLowCtrQuery(left))
    .slice(0, OPPORTUNITY_LIMITS.LOW_CTR_QUERIES);

  for (const row of lowCtrQueries) {
    opportunities.push({
      id: `${OPPORTUNITY_ID_PREFIXES.LOW_CTR_QUERY}${row.query}`,
      priority: row.position <= 10 ? OPPORTUNITY_PRIORITIES.P0 : OPPORTUNITY_PRIORITIES.P1,
      area: OPPORTUNITY_AREAS.GSC,
      title: `高展现低 CTR 关键词：${row.query}`,
      evidence: `${row.query} 当前展示 ${row.impressions}，CTR ${(row.ctr * 100).toFixed(1)}%，平均排名 ${row.position.toFixed(1)}。`,
      recommendation: `优化承接该关键词的标题与 meta description，首屏文案直接回应”${row.query}”的搜索意图。`,
      score: rankLowCtrQuery(row)
    });
  }

  const rankingWindowQueries = report.gsc.current.queries
    .filter((row) =>
      row.impressions >= OPPORTUNITY_THRESHOLDS.RANKING_WINDOW_IMPRESSIONS_MIN &&
      row.position >= OPPORTUNITY_THRESHOLDS.RANKING_WINDOW_POS_MIN &&
      row.position <= OPPORTUNITY_THRESHOLDS.RANKING_WINDOW_POS_MAX
    )
    .sort((left, right) => right.impressions - left.impressions)
    .slice(0, OPPORTUNITY_LIMITS.RANKING_WINDOW_QUERIES);

  for (const row of rankingWindowQueries) {
    opportunities.push({
      id: `${OPPORTUNITY_ID_PREFIXES.RANKING_WINDOW}${row.query}`,
      priority: OPPORTUNITY_PRIORITIES.P1,
      area: OPPORTUNITY_AREAS.GSC,
      title: `接近首页的潜力关键词：${row.query}`,
      evidence: `${row.query} 当前平均排名 ${row.position.toFixed(1)}，展示 ${row.impressions}。`,
      recommendation: `为”${row.query}”补充 FAQ、小标题和相关内链，争取把排名推进到首页。`,
      score: row.impressions + (OPPORTUNITY_THRESHOLDS.RANKING_WINDOW_POS_MAX - row.position) * 20
    });
  }

  const lowCtrPages = report.gsc.current.pages
    .filter((row) => row.impressions >= OPPORTUNITY_THRESHOLDS.LOW_CTR_IMPRESSIONS_MIN && row.ctr <= OPPORTUNITY_THRESHOLDS.LOW_CTR_MAX)
    .sort((left, right) => rankLowCtrPage(right) - rankLowCtrPage(left))
    .slice(0, OPPORTUNITY_LIMITS.LOW_CTR_PAGES);

  for (const row of lowCtrPages) {
    opportunities.push({
      id: `${OPPORTUNITY_ID_PREFIXES.LOW_CTR_PAGE}${formatPageLabel(row.page)}`,
      priority: OPPORTUNITY_PRIORITIES.P1,
      area: OPPORTUNITY_AREAS.GSC,
      title: `高展现低点击页面：${formatPageLabel(row.page)}`,
      evidence: `${formatPageLabel(row.page)} 当前展示 ${row.impressions}，点击 ${row.clicks}，CTR ${(row.ctr * 100).toFixed(1)}%。`,
      recommendation: "检查该页 title、description、SERP 片段和首屏承诺是否足够明确，优先提升点击率。",
      score: rankLowCtrPage(row)
    });
  }

  const decliningPages = detectDecliningPages(report.gsc.current.pages, report.gsc.previous.pages);
  opportunities.push(...decliningPages);

  const decliningLandingPages = detectDecliningLandingPages(
    report.ga4.current.landingPages,
    report.ga4.previous.landingPages
  );
  opportunities.push(...decliningLandingPages);

  const organicShareOpportunity = detectOrganicShareShift(report);
  if (organicShareOpportunity) {
    opportunities.push(organicShareOpportunity);
  }

  const crossOpportunity = detectCrossSourceOpportunity(report);
  if (crossOpportunity) {
    opportunities.push(crossOpportunity);
  }

  return opportunities.sort((left, right) => right.score - left.score).slice(0, OPPORTUNITY_LIMITS.MAX_OPPORTUNITIES);
}

function rankLowCtrQuery(row: GscQueryRow): number {
  return row.impressions * 2 + Math.max(0, 20 - row.position) * 15;
}

function rankLowCtrPage(row: GscPageRow): number {
  return row.impressions + row.clicks * 20;
}

interface DeclineConfig<T> {
  idPrefix: string;
  area: keyof typeof OPPORTUNITY_AREAS;
  titlePrefix: string;
  evidencePrefix: string;
  recommendation: string;
  scoreMultiplier: number;
  minValue: number;
  dropRatioThreshold: number;
  getValue: (item: T) => number;
  getKey: (item: T) => string;
}

function detectDecliningItems<T>(
  currentItems: T[],
  previousItems: T[],
  config: DeclineConfig<T>
): Opportunity[] {
  const previousByKey = new Map(previousItems.map((row) => [config.getKey(row), row]));

  return currentItems
    .map<Opportunity | null>((row) => {
      const key = config.getKey(row);
      const previous = previousByKey.get(key);
      const currentValue = config.getValue(row);

      if (!previous || config.getValue(previous) < config.minValue) {
        return null;
      }

      const previousValue = config.getValue(previous);
      const dropRatio = previousValue === 0 ? 0 : (previousValue - currentValue) / previousValue;

      if (dropRatio < config.dropRatioThreshold) {
        return null;
      }

      return {
        id: `${config.idPrefix}:${key}`,
        priority: OPPORTUNITY_PRIORITIES.P0,
        area: OPPORTUNITY_AREAS[config.area],
        title: `${config.titlePrefix}：${formatPageLabel(key)}`,
        evidence: `${formatPageLabel(key)} ${config.evidencePrefix} 从 ${previousValue} 降到 ${currentValue}，跌幅 ${(dropRatio * 100).toFixed(1)}%。`,
        recommendation: config.recommendation,
        score: previousValue * dropRatio * config.scoreMultiplier,
      };
    })
    .filter((row): row is Opportunity => row !== null)
    .slice(0, 1);
}

function detectDecliningPages(currentPages: GscPageRow[], previousPages: GscPageRow[]): Opportunity[] {
  return detectDecliningItems(currentPages, previousPages, {
    idPrefix: OPPORTUNITY_ID_PREFIXES.PAGE_DECLINE,
    area: "GSC",
    titlePrefix: "点击下滑页面",
    evidencePrefix: "点击",
    recommendation: "优先检查该页是否被新结果挤压、标题是否变化，必要时补内链与内容更新。",
    scoreMultiplier: 10,
    minValue: OPPORTUNITY_THRESHOLDS.DECLINE_MIN_VALUE,
    dropRatioThreshold: OPPORTUNITY_THRESHOLDS.DECLINE_RATIO_MIN,
    getValue: (row) => row.clicks,
    getKey: (row) => pageComparisonKey(row.page),
  });
}

function detectDecliningLandingPages(
  currentPages: Ga4LandingPageRow[],
  previousPages: Ga4LandingPageRow[]
): Opportunity[] {
  return detectDecliningItems(currentPages, previousPages, {
    idPrefix: OPPORTUNITY_ID_PREFIXES.LANDING_DECLINE,
    area: "GA4",
    titlePrefix: "Organic landing page 流量下滑",
    evidencePrefix: "organic sessions",
    recommendation: "结合 GSC 检查该页的关键词与排名变化，确认是点击率问题、排名问题还是页面可用性问题。",
    scoreMultiplier: 12,
    minValue: OPPORTUNITY_THRESHOLDS.DECLINE_MIN_VALUE,
    dropRatioThreshold: OPPORTUNITY_THRESHOLDS.LANDING_DECLINE_RATIO_MIN,
    getValue: (row) => row.sessions,
    getKey: (row) => pageComparisonKey(row.landingPage),
  });
}

function detectOrganicShareShift(report: SiteReportData): Opportunity | null {
  const currentOrganic = getChannelMetric(report.ga4.current.channels, "Organic Search");
  const previousOrganic = getChannelMetric(report.ga4.previous.channels, "Organic Search");

  const currentTotal = report.ga4.current.summary.sessions;
  const previousTotal = report.ga4.previous.summary.sessions;

  if (currentTotal === 0 || previousTotal === 0) {
    return null;
  }

  const currentShare = currentOrganic / currentTotal;
  const previousShare = previousOrganic / previousTotal;
  const delta = currentShare - previousShare;

  if (Math.abs(delta) < OPPORTUNITY_THRESHOLDS.ORGANIC_SHARE_DELTA_MIN) {
    return null;
  }

  return {
    id: OPPORTUNITY_ID_PREFIXES.ORGANIC_SHARE,
    priority: delta < 0 ? OPPORTUNITY_PRIORITIES.P0 : OPPORTUNITY_PRIORITIES.P1,
    area: OPPORTUNITY_AREAS.GA4,
    title: `Organic Search 占比${delta < 0 ? "下滑" : "上升"}明显`,
    evidence: `Organic Search 占比从 ${(previousShare * 100).toFixed(1)}% 变为 ${(currentShare * 100).toFixed(1)}%。`,
    recommendation:
      delta < 0
        ? "优先排查自然搜索入口页与品牌词点击变化，确认是否被其他渠道稀释。"
        : "自然搜索占比提升，建议加大对已起量页面的内链和相关内容扩写。 ",
    score: Math.abs(delta) * 1000
  };
}

function detectCrossSourceOpportunity(report: SiteReportData): Opportunity | null {
  // Bridge GSC full-URL pages to GA4 path-only landing pages by normalized path.
  // Multiple host/protocol variants can share a path; pick the one with the
  // highest impressions deterministically (not last-write-wins) and surface its
  // full URL below so the GA4<->GSC association is transparent, never ambiguous.
  const bestByPath = new Map<string, GscPageRow>();
  for (const row of report.gsc.current.pages) {
    if (
      row.impressions >= OPPORTUNITY_THRESHOLDS.LOW_CTR_IMPRESSIONS_MIN &&
      row.ctr <= OPPORTUNITY_THRESHOLDS.CROSS_CTR_MAX
    ) {
      const key = normalizePageKey(row.page);
      const existing = bestByPath.get(key);
      if (!existing || row.impressions > existing.impressions) {
        bestByPath.set(key, row);
      }
    }
  }

  const landingPage = report.ga4.current.landingPages
    .filter((row) => row.sessions >= OPPORTUNITY_THRESHOLDS.CROSS_SESSIONS_MIN)
    .sort((left, right) => right.sessions - left.sessions)
    .find((row) => bestByPath.has(normalizePageKey(row.landingPage)));

  if (!landingPage) {
    return null;
  }

  const matchedPage = bestByPath.get(normalizePageKey(landingPage.landingPage));
  if (!matchedPage) {
    return null;
  }

  const matchedGscUrl = formatPageLabel(matchedPage.page);
  const landingLabel = formatPageLabel(landingPage.landingPage);

  return {
    id: `${OPPORTUNITY_ID_PREFIXES.CROSS_SOURCE}${landingLabel}`,
    priority: OPPORTUNITY_PRIORITIES.P0,
    area: OPPORTUNITY_AREAS.CROSS,
    title: `高流量页仍有点击率优化空间：${matchedGscUrl}`,
    evidence: `${matchedGscUrl}（GA4 landing ${landingLabel}）在 GA4 带来 ${landingPage.sessions} organic sessions，同时 GSC CTR 仅 ${(matchedPage.ctr * 100).toFixed(1)}%。`,
    recommendation: "优先优化这类高流量页的 SERP 片段与首屏信息，因为提升点击率会立刻放大收益。",
    score: landingPage.sessions * 20 + matchedPage.impressions
  };
}
