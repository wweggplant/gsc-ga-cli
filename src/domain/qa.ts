import { formatPageLabel } from "./metrics.js";
import type { SiteReportData } from "./metrics.js";
import type { ReportInsights } from "./insights.js";

export interface QaWarning {
  code: string;
  message: string;
}

// Sentinel labels legitimately merge multiple unknown-page rows; do not treat
// those merges as a collision.
const SENTINEL_LABELS = new Set([
  "(empty)",
  "(not set)",
  "(other)",
  "(not provided)",
  "(data source not available)",
  "(none)",
  "(unknown)"
]);

/**
 * Lightweight report QA. Returns warnings for three regression classes:
 *   1. gsc-page-key-collision — two rendered GSC page rows share a display label.
 *   2. summary-false-stable   — the narrative concludes "稳定" (must never happen).
 *   3. funnel-not-measured    — funnel event query failed (NOT_MEASURED).
 *
 * Intended for defense-in-depth; a clean report yields no warnings.
 */
export function runReportQa(report: SiteReportData, insights: ReportInsights): QaWarning[] {
  const warnings: QaWarning[] = [];

  const labelCounts = new Map<string, number>();
  for (const row of report.gsc.current.pages) {
    const label = formatPageLabel(row.page);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  for (const [label, count] of labelCounts) {
    if (count > 1 && !SENTINEL_LABELS.has(label)) {
      warnings.push({
        code: "gsc-page-key-collision",
        message: `GSC 页面展示键碰撞：${count} 行归一化为「${label}」，无法区分。`
      });
    }
  }

  // Summary regression: the literal "稳定" must never appear anywhere in the
  // insight text (narrative, bullets, opportunity bullets, next actions).
  const allInsightText = [
    insights.summaryNarrative,
    ...insights.summaryBullets,
    ...insights.opportunityBullets,
    ...insights.nextActions.map((action) => action.text)
  ].join("\n");
  if (allInsightText.includes("稳定")) {
    warnings.push({
      code: "summary-false-stable",
      message: "报告文案出现「稳定」，可能与汇总指标变化矛盾。"
    });
  }

  if (insights.funnel.coverage === "not-measured") {
    warnings.push({
      code: "funnel-not-measured",
      message: "漏斗事件查询失败（NOT_MEASURED），Activation 未裁决。"
    });
  }

  return warnings;
}
