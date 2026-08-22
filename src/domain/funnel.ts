import type { Ga4FunnelEventRow, Ga4WindowReport } from "./metrics.js";

/**
 * Per-event comparison status.
 * - "zero": the event was queried successfully in both windows and is genuinely 0.
 * - "measured": at least one window recorded a non-zero count.
 */
export type FunnelEventStatus = "zero" | "measured";

/**
 * Site-level coverage.
 * - "not-configured": no funnelEvents configured, or either window was not queried (NOT_CONFIGURED).
 * - "not-measured": at least one window's event query failed (NOT_MEASURED).
 * - "ok": BOTH windows measured successfully (so a ZERO is "queried, truly 0").
 */
export type FunnelCoverage = "not-configured" | "not-measured" | "ok";

export interface FunnelEventComparison {
  name: string;
  label: string;
  currentCount: number;
  previousCount: number;
  currentUsers: number;
  previousUsers: number;
  status: FunnelEventStatus;
}

export interface FunnelSummary {
  coverage: FunnelCoverage;
  events: FunnelEventComparison[];
}

export function buildFunnelSummary(current: Ga4WindowReport, previous: Ga4WindowReport): FunnelSummary {
  const currentStatus = current.funnelStatus ?? "not-configured";
  const previousStatus = previous.funnelStatus ?? "not-configured";

  // ZERO means "queried successfully and truly 0". That requires BOTH windows to
  // have been queried. If either side is unconfigured, we cannot establish ZERO
  // (the missing side's 0 is "not queried", not "measured 0").
  if (currentStatus === "not-configured" || previousStatus === "not-configured") {
    return { coverage: "not-configured", events: [] };
  }

  if (currentStatus === "error" || previousStatus === "error") {
    return { coverage: "not-measured", events: [] };
  }

  const currentByName = indexFunnelRows(current.funnelEvents ?? []);
  const previousByName = indexFunnelRows(previous.funnelEvents ?? []);

  const names = uniqueFunnelNames(current.funnelEvents ?? [], previous.funnelEvents ?? []);

  const events: FunnelEventComparison[] = names.map((name) => {
    const currentRow = currentByName.get(name);
    const previousRow = previousByName.get(name);

    const currentCount = currentRow?.eventCount ?? 0;
    const previousCount = previousRow?.eventCount ?? 0;
    const currentUsers = currentRow?.totalUsers ?? 0;
    const previousUsers = previousRow?.totalUsers ?? 0;

    return {
      name,
      label: currentRow?.label ?? previousRow?.label ?? name,
      currentCount,
      previousCount,
      currentUsers,
      previousUsers,
      status: currentCount === 0 && previousCount === 0 ? "zero" : "measured"
    };
  });

  return { coverage: "ok", events };
}

function indexFunnelRows(rows: Ga4FunnelEventRow[]): Map<string, Ga4FunnelEventRow> {
  return new Map(rows.map((row) => [row.name, row]));
}

function uniqueFunnelNames(...rowSets: Ga4FunnelEventRow[][]): string[] {
  const seen = new Set<string>();
  for (const rows of rowSets) {
    for (const row of rows) {
      seen.add(row.name);
    }
  }
  return [...seen];
}
