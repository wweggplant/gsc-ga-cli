import type { ClarityDimensionRow, SiteReportData } from "../domain/metrics.js";
import { formatPageLabel, formatPercent, normalizePageKey } from "../domain/metrics.js";
import type { ReportInsights } from "../domain/insights.js";
import { buildSourceDataHighlights } from "../domain/insights.js";
import type { FunnelSummary } from "../domain/funnel.js";
import { runReportQa } from "../domain/qa.js";

export interface ReportDocument {
  title: string;
  content: string;
}

export function renderReportMarkdown(
  report: SiteReportData,
  insights: ReportInsights,
  title: string,
  reportDate: string
): ReportDocument {
  const lines: string[] = [
    `# ${title}`,
    "",
    "## Summary",
    "",
    insights.summaryNarrative,
    ""
  ];

  for (const bullet of insights.summaryBullets) {
    lines.push(`- ${bullet}`);
  }

  lines.push(
    "",
    "## GSC",
    "",
    `- 时间窗：${report.windows.current.startDate} 至 ${report.windows.current.endDate}`,
    `- 点击：${report.gsc.current.summary.clicks}`,
    `- 展示：${report.gsc.current.summary.impressions}`,
    `- 平均 CTR：${formatPercent(report.gsc.current.summary.ctr)}`,
    `- 平均排名：${report.gsc.current.summary.position.toFixed(1)}`,
    "",
    "### Top Queries",
    ""
  );

  for (const row of report.gsc.current.queries.slice(0, 5)) {
    lines.push(
      `- \`${row.query}\` | 点击 ${row.clicks} | 展示 ${row.impressions} | CTR ${formatPercent(row.ctr)} | 排名 ${row.position.toFixed(1)}`
    );
  }

  lines.push("", "### Top Pages", "");

  for (const row of report.gsc.current.pages.slice(0, 5)) {
    lines.push(
      `- \`${formatPageLabel(row.page)}\` | 点击 ${row.clicks} | 展示 ${row.impressions} | CTR ${formatPercent(row.ctr)} | 排名 ${row.position.toFixed(1)}`
    );
  }

  lines.push(
    "",
    "## GA4",
    "",
    `- 时间窗：${report.windows.current.startDate} 至 ${report.windows.current.endDate}`,
    `- sessions：${report.ga4.current.summary.sessions}`,
    `- active users：${report.ga4.current.summary.activeUsers}`,
    "",
    "### Organic Landing Pages",
    ""
  );

  for (const row of report.ga4.current.landingPages.slice(0, 5)) {
    lines.push(
      `- \`${normalizePageKey(row.landingPage)}\` | sessions ${row.sessions} | active users ${row.activeUsers}`
    );
  }

  lines.push("", "### Channel Mix", "");

  for (const row of report.ga4.current.channels.slice(0, 5)) {
    lines.push(`- ${row.channel} | sessions ${row.sessions} | active users ${row.activeUsers}`);
  }

  lines.push(...renderChannelMixCaliber(report.ga4.current.channels, report.ga4.current.summary.sessions));

  lines.push("", "### Daily Trend", "");

  for (const row of report.ga4.current.dailyTrend.slice(-14)) {
    lines.push(
      `- ${row.date} | sessions ${row.sessions} | active users ${row.activeUsers} | page views ${row.pageViews}`
    );
  }

  lines.push("", "### Top Countries", "");

  for (const row of report.ga4.current.countries.slice(0, 5)) {
    lines.push(`- ${row.country} | sessions ${row.sessions} | active users ${row.activeUsers}`);
  }

  lines.push("", "### Top Pages", "");

  for (const row of report.ga4.current.pages.slice(0, 10)) {
    lines.push(`- \`${normalizePageKey(row.page)}\` | page views ${row.pageViews} | sessions ${row.sessions}`);
  }

  lines.push(...renderFunnelSection(insights.funnel));

  if (report.clarity) {
    lines.push(
      "",
      "## Microsoft Clarity",
      "",
      `- 时间窗：最近 ${report.clarity.numOfDays} 天（Clarity live window，不等同于 GSC/GA4 report window）`,
      `- 说明：Clarity Data Export API 只支持最近 1-3 天，因此这里只做 UX friction 参考，不参与前周期对比。`,
      "",
      "### URL Friction",
      ""
    );

    for (const row of rankClarityRows(report.clarity.byUrl).slice(0, 8)) {
      lines.push(renderClarityRow(row));
    }

    lines.push("", "### Device Friction", "");

    for (const row of rankClarityRows(report.clarity.byDevice).slice(0, 5)) {
      lines.push(renderClarityRow(row));
    }
  }

  lines.push("", "## Opportunities", "");

  for (const bullet of insights.opportunityBullets) {
    lines.push(`- ${bullet}`);
  }

  lines.push("", "## Next Actions", "");

  for (const action of insights.nextActions) {
    lines.push(`- [ ] [${action.priority}] ${action.text}`);
  }

  const qaWarnings = runReportQa(report, insights);
  if (qaWarnings.length > 0) {
    lines.push("", "## Report QA", "");
    for (const warning of qaWarnings) {
      lines.push(`- [${warning.code}] ${warning.message}`);
    }
  }

  lines.push("", "## Source Data", "");

  for (const line of buildSourceDataHighlights(report)) {
    lines.push(`- ${line}`);
  }

  return {
    title,
    content: lines.join("\n")
  };
}

function renderChannelMixCaliber(channels: Array<{ sessions: number }>, headlineSessions: number): string[] {
  const lines = [
    "- 口径：channel 分项按 sessionDefaultChannelGroup 维度统计，可能与上方 sessions 总数因去重 / 未归因不完全相等，不构成严格分解。"
  ];

  const channelTotal = channels.reduce((sum, row) => sum + row.sessions, 0);
  if (headlineSessions > 0 && channelTotal > 0) {
    const ratio = channelTotal / headlineSessions;
    if (ratio > 1.2 || ratio < 0.8) {
      lines.push(
        `- reconciliation 提示：channel 分项 sessions 合计 ${channelTotal}，与总数 ${headlineSessions} 差异较大（约 ${(ratio * 100).toFixed(0)}%），仅作结构参考，不作为加总校验。`
      );
    }
  }

  return lines;
}

function renderFunnelSection(funnel: FunnelSummary): string[] {
  const coverageLabel: Record<FunnelSummary["coverage"], string> = {
    "not-configured": "NOT_CONFIGURED（未在站点配置中设置 funnelEvents，无法裁决 Activation）",
    "not-measured": "NOT_MEASURED（事件查询失败，无法裁决 Activation）",
    ok: "ok"
  };

  const lines = [
    "",
    "### Activation（漏斗事件）",
    "",
    "- 口径：仅展示站点配置的事件；ZERO = 查询成功且当前/上一窗口均为 0，不代表事件未配置。",
    `- 覆盖：${coverageLabel[funnel.coverage]}`
  ];

  for (const event of funnel.events) {
    const badge = event.status === "zero" ? " | ZERO" : "";
    lines.push(
      `- \`${event.label}\` | current ${event.currentCount}（${event.currentUsers} users） | previous ${event.previousCount}（${event.previousUsers} users）${badge}`
    );
  }

  return lines;
}

function renderClarityRow(row: ClarityDimensionRow): string {
  const sessions = readClarityMetric(row, ["traffic_totalSessionCount"]);
  const botSessions = readClarityMetric(row, ["traffic_totalBotSessionCount"]);
  const users = readClarityMetric(row, ["traffic_distantUserCount"]);
  const distinctUsers = readClarityMetric(row, ["traffic_distinctUserCount"]);
  const rageClicks = readClarityMetric(row, [
    "rage_click_count_subTotal",
    "rage_click_count_RageClickCount",
    "rage_click_count_rageClickCount",
    "rage_click_count_totalSessionCount"
  ]);
  const deadClicks = readClarityMetric(row, [
    "dead_click_count_subTotal",
    "dead_click_count_DeadClickCount",
    "dead_click_count_deadClickCount",
    "dead_click_count_totalSessionCount"
  ]);
  const scriptErrors = readClarityMetric(row, [
    "script_error_count_subTotal",
    "script_error_count_ScriptErrorCount",
    "script_error_count_scriptErrorCount",
    "script_error_count_totalSessionCount"
  ]);

  return [
    `- \`${formatClarityDimension(row.dimension)}\``,
    `sessions ${sessions}`,
    `bot sessions ${botSessions}`,
    `users ${distinctUsers || users}`,
    `rage clicks ${rageClicks}`,
    `dead clicks ${deadClicks}`,
    `script errors ${scriptErrors}`
  ].join(" | ");
}

function rankClarityRows(rows: ClarityDimensionRow[]): ClarityDimensionRow[] {
  return [...rows].sort((left, right) => {
    const rightFriction = readClarityMetric(right, [
      "rage_click_count_RageClickCount",
      "rage_click_count_rageClickCount",
      "rage_click_count_subTotal",
      "dead_click_count_DeadClickCount",
      "dead_click_count_deadClickCount",
      "dead_click_count_subTotal",
      "script_error_count_ScriptErrorCount",
      "script_error_count_scriptErrorCount",
      "script_error_count_subTotal"
    ]);
    const leftFriction = readClarityMetric(left, [
      "rage_click_count_RageClickCount",
      "rage_click_count_rageClickCount",
      "rage_click_count_subTotal",
      "dead_click_count_DeadClickCount",
      "dead_click_count_deadClickCount",
      "dead_click_count_subTotal",
      "script_error_count_ScriptErrorCount",
      "script_error_count_scriptErrorCount",
      "script_error_count_subTotal"
    ]);

    if (rightFriction !== leftFriction) {
      return rightFriction - leftFriction;
    }

    return readClarityMetric(right, ["traffic_totalSessionCount"]) - readClarityMetric(left, ["traffic_totalSessionCount"]);
  });
}

function readClarityMetric(row: ClarityDimensionRow, keys: string[]): number {
  for (const key of keys) {
    const value = row.metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function formatClarityDimension(value: string): string {
  if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
    return normalizePageKey(value);
  }

  return value || "(unknown)";
}
