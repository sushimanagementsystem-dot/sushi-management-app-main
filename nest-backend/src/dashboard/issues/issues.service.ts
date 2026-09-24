import { Injectable } from "@nestjs/common";
import { KpiService } from "../kpi/kpi.service.js";
import { KioskTaskStatusService } from "../kiosk-task-status/kiosk-task-status.service.js";
import { StockVariancesService } from "../stock-variances/stock-variances.service.js";
import { addDays, startOfTodayUtc, toDateStr } from "../../common/date.util.js";

export type Issue = {
    id: string;
    kioskId: string;
    kioskName: string;
    category: "MISSING_TASK" | "STOCK_VARIANCE" | "WASTE_HIGH" | "DAMAGE_HIGH";
    severity: "high" | "warn";
    title: string;
    /** YYYY-MM-DD this issue is dated to — today for a missing task or a
     * rate outlier (both evaluated as of today), or the specific day a
     * stock variance actually happened. Drives the newest-first sort below. */
    date: string;
};

/**
 * Issues — the single "what's wrong right now" list the owner asked for:
 * open the dashboard, see kiosk + problem + nothing-else-to-do in one
 * glance, instead of having to check Task Completion, Stock Variances, and
 * Kiosk Comparison separately to notice the same three things. Every item
 * here is computed, not stored — this reuses the exact same services
 * those other pages already call (KioskTaskStatusService,
 * StockVariancesService, KpiService's damage/waste rates), so an issue
 * shown here is never a second, differently-computed number from what
 * those pages would show if you went and checked yourself.
 */
@Injectable()
export class IssuesService {
    constructor(
        private readonly kpi: KpiService,
        private readonly kioskTaskStatus: KioskTaskStatusService,
        private readonly stockVariances: StockVariancesService,
    ) {}

    async bootstrap(offset = 0, limit = 15) {
        const today = startOfTodayUtc();
        const todayStr = toDateStr(today);
        const weekAgo = addDays(today, -6);

        const [taskStatus, variances, comparison] = await Promise.all([
            this.kioskTaskStatus.bootstrap(today),
            this.stockVariances.bootstrap(weekAgo, today),
            this.kpi.bootstrapKioskComparison(weekAgo, today),
        ]);

        const issues: Issue[] = [];

        // 1. Today's missing daily tasks — same signal Task Completion
        // shows, filtered down to just the gaps.
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
                        date: todayStr,
                    });
                }
            }
        }

        // 2. Stock variances in the last 7 days — same rows Stock
        // Variances shows, already threshold-filtered by that service.
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

        // 3. Waste/damage rate well above the other kiosks' average over
        // the same week — "unusually high" only means something relative
        // to the rest of the kiosks, so this needs at least two kiosks
        // with a computable rate to be meaningful.
        this.pushRateOutliers(issues, comparison.kiosks, comparison.damageWasteRates, "waste", "ratePct", "WASTE_HIGH", "Waste", "%", todayStr);
        this.pushRateOutliers(issues, comparison.kiosks, comparison.damageWasteRates, "damage", "ratePer100", "DAMAGE_HIGH", "Damage", " per 100 planned units", todayStr);

        // Newest-dated issue first (a stock variance from today outranks
        // one from three days ago); severity, then kiosk name, break ties
        // within the same date — same order this list always had before
        // date was introduced, just no longer the top-level sort.
        const severityRank = { high: 0, warn: 1 } as const;
        issues.sort((a, b) => b.date.localeCompare(a.date) || severityRank[a.severity] - severityRank[b.severity] || a.kioskName.localeCompare(b.kioskName));

        // counts/total are over the FULL list — "17 issues, 16 need
        // attention" has to stay accurate even when the page below only
        // ships 15 of them. The heavy part (the three service calls
        // above) runs once regardless of page size; this only trims what
        // actually crosses the wire, so payload stays flat as issues grow
        // instead of shipping every one of them on every load/refetch.
        const total = issues.length;
        const page = issues.slice(offset, offset + limit);

        return {
            generatedAt: toDateStr(today),
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

    private pushRateOutliers(
        issues: Issue[],
        kiosks: { id: string; name: string }[],
        damageWasteRates: Record<string, any>,
        rateGroup: "waste" | "damage",
        rateField: string,
        category: Issue["category"],
        label: string,
        unitSuffix: string,
        todayStr: string,
    ) {
        const rates = kiosks
            .map((k) => ({ kiosk: k, rate: damageWasteRates[k.id]?.[rateGroup]?.[rateField] }))
            .filter((r): r is { kiosk: { id: string; name: string }; rate: number } => typeof r.rate === "number");
        if (rates.length < 2) return;

        const avg = rates.reduce((sum, r) => sum + r.rate, 0) / rates.length;
        if (avg <= 0) return;

        for (const r of rates) {
            // Both a relative gap (50% above average) and a minimum
            // absolute gap (2 points) have to hold — same two-part
            // threshold shape as Stock Variances' own flagging, so
            // "unusually high" doesn't fire on tiny noise around a
            // near-zero average.
            if (r.rate >= avg * 1.5 && r.rate - avg >= 2) {
                issues.push({
                    id: `${category}-${r.kiosk.id}`,
                    kioskId: r.kiosk.id,
                    kioskName: r.kiosk.name,
                    category,
                    severity: "warn",
                    title: `${r.kiosk.name} – ${label} unusually high (${r.rate}${unitSuffix} vs ${Math.round(avg * 100) / 100}${unitSuffix} average)`,
                    date: todayStr,
                });
            }
        }
    }
}
