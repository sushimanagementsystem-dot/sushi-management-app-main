import { Injectable } from "@nestjs/common";
import type { Kiosk } from "@prisma/client";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, toDateStr } from "../../common/date.util.js";
import { WasteRateService, type RateKind } from "../kpi/waste-rate.service.js";
import type { DateWindow, RateSample } from "../kpi/waste-cohort.js";
import type { Issue } from "./issue.types.js";
import { RATE_RULES, assessRateOutlier, sumSamples } from "./rate-outlier.js";

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Waste / damage "unusually high" alerts.
 *
 * The rate itself is WasteRateService's (see waste-cohort.ts): units binned in a
 * period, matched to the plan of the batches they came from, out of the units
 * planned for those batches. Here it is judged like this:
 *  - the period is the last 7 finished days before the alert date ("recent"),
 *    the 28 days before that are the kiosk's "usual";
 *  - "usual" is the kiosk's OWN pooled rate; only when it has too little history
 *    is it compared with the other kiosks (never including itself);
 *  - a rate is flagged only with enough volume behind it and only when it is
 *    clearly, and statistically, above usual — see rate-outlier.ts.
 */
@Injectable()
export class RateAlertsService {
    constructor(
        private readonly tableCache: TableCacheService,
        private readonly wasteRate: WasteRateService,
    ) {}

    /** Every waste/damage outlier as it stands on `asOf` (a UTC calendar day). */
    async findOutliers(asOf: Date): Promise<Issue[]> {
        const kiosks = (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
        const kioskIds = kiosks.map((k) => k.kiosk_id);

        const { recentDays, historyDays } = RATE_RULES;
        const recentTo = addDays(asOf, -1); // today is not finished, so its waste is not all in
        const recentFrom = addDays(recentTo, -(recentDays - 1));
        const window = (from: Date, to: Date): DateWindow => ({ from: toDateStr(from), to: toDateStr(to) });
        const windows = [window(recentFrom, recentTo), window(addDays(recentFrom, -historyDays), addDays(recentFrom, -1))];

        const [waste, damage] = await Promise.all([this.wasteRate.samples("EXPIRED_WASTE", kioskIds, windows), this.wasteRate.samples("DAMAGE", kioskIds, windows)]);
        const asOfStr = toDateStr(asOf);
        return [...this.flag(kiosks, waste, asOfStr, "EXPIRED_WASTE", "Waste", "%"), ...this.flag(kiosks, damage, asOfStr, "DAMAGE", "Damage", " per 100 planned units")];
    }

    private flag(kiosks: Kiosk[], samples: Map<string, RateSample[]>, asOf: string, kind: RateKind, label: string, unit: string): Issue[] {
        const category = kind === "EXPIRED_WASTE" ? "WASTE_HIGH" : "DAMAGE_HIGH";
        const issues: Issue[] = [];
        for (const k of kiosks) {
            const [recent, own] = samples.get(k.kiosk_id)!;
            const others = sumSamples(kiosks.filter((o) => o.kiosk_id !== k.kiosk_id).map((o) => samples.get(o.kiosk_id)![1]!));
            const usesOwnHistory = own!.base >= RATE_RULES.minHistoryBase;
            const verdict = assessRateOutlier(recent!, usesOwnHistory ? own! : others);
            if (!verdict.flagged || verdict.ratePct === null || verdict.baselinePct === null) continue;

            issues.push({
                id: `${category}-${k.kiosk_id}`,
                kioskId: k.kiosk_id,
                kioskName: k.name,
                category,
                severity: "warn",
                title: `${k.name} – ${label} unusually high (${round1(verdict.ratePct)}${unit}, ${recent!.events} of ${recent!.base} planned units, vs ${round1(verdict.baselinePct)}${unit} ${usesOwnHistory ? "usual for this kiosk" : "at the other kiosks"})`,
                date: asOf,
            });
        }
        return issues;
    }
}
