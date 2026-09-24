import { Injectable } from "@nestjs/common";
import { KioskTaskStatusService } from "../kiosk-task-status/kiosk-task-status.service.js";
import { StockVariancesService } from "../stock-variances/stock-variances.service.js";
import { RateAlertsService } from "./rate-alerts.service.js";
import type { Issue } from "./issue.types.js";
import { resolveDateRange, type DateRangeKey } from "../../common/date-range.util.js";
import { toDateStr } from "../../common/date.util.js";

export type { Issue } from "./issue.types.js";

/** Stocktake variances are looked up from this day when the owner picks "All time". */
const ALL_TIME_START = new Date(Date.UTC(2000, 0, 1));

/**
 * Issues — the single "what's wrong right now" list the owner asked for:
 * open the dashboard, see kiosk + problem + nothing-else-to-do in one
 * glance, instead of having to check Task Completion, Stock Variances, and
 * Kiosk Comparison separately. Every item is computed, not stored, from the
 * same services those pages use (KioskTaskStatusService,
 * StockVariancesService); waste/damage outliers come from RateAlertsService,
 * which documents exactly what those rates are measured against.
 *
 * The date filter (Today / Yesterday / This week / All time) picks a range
 * [from, to]:
 *  - stock variances are those whose stocktake falls inside the range;
 *  - point-in-time checks (missing daily tasks, waste/damage outliers) are
 *    evaluated as of the range's last day — "Yesterday" shows what was
 *    missing / out of line yesterday, the other presets show it as of today.
 */
@Injectable()
export class IssuesService {
    constructor(
        private readonly kioskTaskStatus: KioskTaskStatusService,
        private readonly stockVariances: StockVariancesService,
        private readonly rateAlerts: RateAlertsService,
    ) {}

    async bootstrap(offset = 0, limit = 15, range: DateRangeKey = "week") {
        const { from, to } = resolveDateRange(range);
        const asOfStr = toDateStr(to);

        const [taskStatus, variances, rateIssues] = await Promise.all([
            this.kioskTaskStatus.bootstrap(to),
            this.stockVariances.bootstrap(from ?? ALL_TIME_START, to),
            this.rateAlerts.findOutliers(to),
        ]);

        const issues: Issue[] = [];

        // 1. Missing daily tasks as of the range's last day — same signal
        // Task Completion shows, filtered down to just the gaps.
        for (const kiosk of taskStatus.kiosks) {
            for (const task of taskStatus.tasks) {
                const done = taskStatus.status[kiosk.id]?.[task.key];
                if (!done) {
                    issues.push({
                        id: `task-${kiosk.id}-${task.key}`,
                        kioskId: kiosk.id,
                        kioskName: kiosk.name,
                        category: "MISSING_TASK",
                        severity: "high",
                        title: `${kiosk.name} – ${task.label} not submitted`,
                        date: asOfStr,
                    });
                }
            }
        }

        // 2. Stock variances in the range — same rows Stock Variances
        // shows, already threshold-filtered by that service.
        for (const v of variances.variances) {
            const sign = v.difference > 0 ? "+" : "";
            issues.push({
                id: `variance-${v.kioskId}-${v.stockItemName}-${v.date}`,
                kioskId: v.kioskId,
                kioskName: v.kioskName,
                category: "STOCK_VARIANCE",
                severity: "high",
                title: `${v.kioskName} – ${v.stockItemName}: expected ${v.expected}, actual ${v.actual} (${sign}${v.difference} ${v.unit})`,
                date: v.date,
            });
        }

        // 3. Waste/damage rates clearly above the kiosk's own usual level.
        issues.push(...rateIssues);

        // Newest-dated issue first (a stock variance from today outranks
        // one from three days ago); severity, then kiosk name, break ties
        // within the same date.
        const severityRank = { high: 0, warn: 1 } as const;
        issues.sort((a, b) => b.date.localeCompare(a.date) || severityRank[a.severity] - severityRank[b.severity] || a.kioskName.localeCompare(b.kioskName));

        // counts/total are over the FULL list — "17 issues, 16 need
        // attention" has to stay accurate even when the page below only
        // ships 15 of them. The heavy part (the service calls above) runs
        // once regardless of page size; this only trims what crosses the wire.
        const total = issues.length;
        const page = issues.slice(offset, offset + limit);

        return {
            generatedAt: asOfStr,
            range,
            issues: page,
            offset,
            limit,
            hasMore: offset + page.length < total,
            counts: {
                high: issues.filter((i) => i.severity === "high").length,
                warn: issues.filter((i) => i.severity === "warn").length,
                total,
            },
        };
    }
}
