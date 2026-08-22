// Opportunity detection thresholds and limits

export const OPPORTUNITY_THRESHOLDS = {
  // Low CTR query detection
  LOW_CTR_IMPRESSIONS_MIN: 100,
  LOW_CTR_MAX: 0.02,

  // Ranking window detection
  RANKING_WINDOW_IMPRESSIONS_MIN: 50,
  RANKING_WINDOW_POS_MIN: 8,
  RANKING_WINDOW_POS_MAX: 20,

  // Decline detection
  DECLINE_MIN_VALUE: 20,
  DECLINE_RATIO_MIN: 0.2,
  LANDING_DECLINE_RATIO_MIN: 0.25,

  // Organic share shift
  ORGANIC_SHARE_DELTA_MIN: 0.1,

  // Cross-source opportunity
  CROSS_CTR_MAX: 0.03,
  CROSS_SESSIONS_MIN: 20,
} as const;

export const OPPORTUNITY_LIMITS = {
  LOW_CTR_QUERIES: 2,
  RANKING_WINDOW_QUERIES: 1,
  LOW_CTR_PAGES: 1,
  DECLINING_PAGES: 1,
  DECLINING_LANDING_PAGES: 1,
  MAX_OPPORTUNITIES: 8,
} as const;

export const OPPORTUNITY_PRIORITIES = {
  P0: "P0",
  P1: "P1",
} as const;

export const OPPORTUNITY_AREAS = {
  GSC: "GSC",
  GA4: "GA4",
  CROSS: "Cross",
} as const;

export const OPPORTUNITY_ID_PREFIXES = {
  LOW_CTR_QUERY: "gsc-low-ctr-query:",
  RANKING_WINDOW: "gsc-ranking-window:",
  LOW_CTR_PAGE: "gsc-low-ctr-page:",
  PAGE_DECLINE: "gsc-page-decline:",
  LANDING_DECLINE: "ga4-landing-decline:",
  ORGANIC_SHARE: "ga4-organic-share-shift",
  CROSS_SOURCE: "cross-gsc-ga4:",
} as const;
