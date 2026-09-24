import { Injectable } from "@nestjs/common";
import type { Product } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, toDateStr } from "../../common/date.util.js";
import { addDaysStr, cohortSamples, type DateWindow, type PlanCell, type RateEvent, type RateSample } from "./waste-cohort.js";

export type RateKind = "EXPIRED_WASTE" | "DAMAGE";

const startOf = (date: string) => new Date(`${date}T00:00:00Z`);
/** These dates are stored with whatever time of day the row was written at, so a day's end is "before the next midnight". */
const endOf = (date: string) => addDays(startOf(date), 1);

/**
 * Loads what waste/damage rates are measured from — the production plan and the
 * waste/damage movements — and turns it into per-kiosk samples (see waste-cohort.ts
 * for what "matched to its batch" means). The one place Kiosk Comparison, the KPI
 * dashboard and the Issues alerts get their waste rate from, so they cannot disagree.
 */
@Injectable()
export class WasteRateService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly settings: SettingsService,
    ) {}

    /** One sample per kiosk per window, in the order the windows were given. */
    async samples(kind: RateKind, kioskIds: string[], windows: DateWindow[]): Promise<Map<string, RateSample[]>> {
        if (!kioskIds.length || !windows.length) return new Map(kioskIds.map((k) => [k, windows.map((): RateSample => ({ events: 0, base: 0 }))]));

        const shift = kind === "EXPIRED_WASTE";
        const defaultShelfDays = (await this.settings.getNumber("WASTE_ATTRIBUTION_DAYS_DEFAULT")) ?? 2;
        const products = await this.tableCache.getAll<Product>("product");
        const shelf = new Map(products.map((p) => [p.product_id, p.shelf_life_days ?? defaultShelfDays]));
        const shelfDaysOf = (product: string) => shelf.get(product) ?? defaultShelfDays;

        const from = windows.map((w) => w.from).sort()[0]!;
        const to = windows.map((w) => w.to).sort().at(-1)!;
        // A batch planned on day d is binned on d + shelf life, so plans up to the longest shelf life before `from` still count.
        const longestShelf = shift ? Math.max(defaultShelfDays, ...shelf.values()) : 0;

        const [planRows, moveRows] = await Promise.all([
            this.prisma.productionPlan.findMany({
                where: { kiosk_id: { in: kioskIds }, business_date: { gte: startOf(addDaysStr(from, -longestShelf)), lt: endOf(to) } },
                select: { kiosk_id: true, product_id: true, business_date: true, planned_qty: true },
            }),
            this.prisma.productMovement.findMany({
                where: { kiosk_id: { in: kioskIds }, movement_type: kind, movement_date: { gte: startOf(from), lt: endOf(to) } },
                select: { kiosk_id: true, product_id: true, movement_date: true, attributed_production_date: true, qty: true },
            }),
        ]);

        const plans: PlanCell[] = planRows.map((r) => ({ kiosk: r.kiosk_id, product: r.product_id, date: toDateStr(r.business_date), qty: Number(r.planned_qty) }));
        const events: RateEvent[] = moveRows.map((r) => ({
            kiosk: r.kiosk_id,
            product: r.product_id,
            date: toDateStr(r.movement_date),
            producedOn: r.attributed_production_date ? toDateStr(r.attributed_production_date) : null,
            qty: Number(r.qty),
        }));
        return cohortSamples(kioskIds, plans, events, windows, shelfDaysOf, shift);
    }
}
