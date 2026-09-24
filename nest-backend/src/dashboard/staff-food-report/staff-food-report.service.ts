import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, startOfTodayUtc, startOfWeekUtc, toDateStr } from "../../common/date.util.js";
import { movementCost, productCostMap } from "../../common/movement-cost.util.js";
import type { Kiosk, Product } from "@prisma/client";

/** cost counts only what could be priced; `uncostedQty` is the units whose product has no cost yet (never guessed). */
type Totals = { qty: number; cost: number; uncostedQty: number };
const emptyTotals = (): Totals => ({ qty: 0, cost: 0, uncostedQty: 0 });
const add = (t: Totals, qty: number, cost: number | null) => {
    t.qty += qty;
    if (cost === null) t.uncostedQty += qty;
    else t.cost += cost;
};

export type ProductRow = { productId: string; name: string; qty: number; cost: number; uncostedQty: number; unitCost: number | null; lastTaken: string };

/** A range longer than this is "all time": the day-by-day list starts at the first day anything was logged instead of at the range start. */
const ALL_TIME_DAYS = 366;

/**
 * Staff Food section — kiosk-wise and date-wise breakdown of comped staff
 * meals, weekly and overall totals, and (the part the owner actually wants)
 * which PRODUCTS each kiosk's staff are taking. Reads the same
 * `product_movement` (movement_type = STAFF_FOOD) rows the Profit tab's
 * cost calculation sums, priced the same way (see movement-cost.util.ts),
 * so whatever it shows here is exactly what's subtracted from net profit.
 *
 * No staff-member breakdown by design — kiosk × date and kiosk × product only.
 */
@Injectable()
export class StaffFoodReportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    async bootstrap(startDate: Date | undefined, endDate: Date | undefined) {
        const kiosks = (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
        const kioskIds = kiosks.map((k) => k.kiosk_id);

        const end = endDate ?? startOfTodayUtc();
        const start = startDate ?? addDays(end, -29); // default: last 30 days

        const [rows, products] = await Promise.all([
            this.prisma.productMovement.findMany({
                // "before the next midnight", not "<= midnight": movement_date can carry a time of day.
                where: { kiosk_id: { in: kioskIds }, movement_type: "STAFF_FOOD", movement_date: { gte: start, lt: addDays(end, 1) } },
                select: { kiosk_id: true, product_id: true, movement_date: true, qty: true, cost: true, unit_cost: true },
            }),
            this.tableCache.getAll<Product>("product"),
        ]);
        const productCosts = productCostMap(products);
        const productName = new Map(products.map((p) => [p.product_id, p.name]));

        const byDay = new Map<string, Map<string, Totals>>(); // dateStr -> kioskId -> Totals
        const byWeek = new Map<string, Map<string, Totals>>(); // weekStartStr -> kioskId -> Totals
        const kioskTotals = new Map<string, Totals>(kioskIds.map((k) => [k, emptyTotals()]));
        const grandTotal = emptyTotals();
        const byProduct = new Map<string, Map<string, ProductRow>>(); // kioskId -> productId -> row
        let earliest: Date | null = null;

        for (const r of rows) {
            const qty = Number(r.qty) || 0;
            const cost = movementCost(r, qty, productCosts);
            const dateStr = toDateStr(r.movement_date);
            const weekStr = toDateStr(startOfWeekUtc(r.movement_date));
            if (!earliest || r.movement_date < earliest) earliest = r.movement_date;

            const nested = (map: Map<string, Map<string, Totals>>, key: string) => {
                let bucket = map.get(key);
                if (!bucket) map.set(key, (bucket = new Map()));
                const totals = bucket.get(r.kiosk_id) ?? emptyTotals();
                bucket.set(r.kiosk_id, totals);
                return totals;
            };
            add(nested(byDay, dateStr), qty, cost);
            add(nested(byWeek, weekStr), qty, cost);
            add(kioskTotals.get(r.kiosk_id)!, qty, cost); // rows are only fetched for active kiosks, so the entry exists
            add(grandTotal, qty, cost);

            let perKiosk = byProduct.get(r.kiosk_id);
            if (!perKiosk) byProduct.set(r.kiosk_id, (perKiosk = new Map()));
            const row =
                perKiosk.get(r.product_id) ??
                ({ productId: r.product_id, name: productName.get(r.product_id) ?? r.product_id, qty: 0, cost: 0, uncostedQty: 0, unitCost: productCosts.get(r.product_id) ?? null, lastTaken: dateStr } satisfies ProductRow);
            row.qty += qty;
            if (cost === null) row.uncostedQty += qty;
            else row.cost += cost;
            if (dateStr > row.lastTaken) row.lastTaken = dateStr;
            perKiosk.set(r.product_id, row);
        }
        const nameById = new Map(kiosks.map((k) => [k.kiosk_id, k.name]));
        const toKioskRows = (bucket: Map<string, Totals> | undefined) =>
            kioskIds.map((kId) => ({ kioskId: kId, kioskName: nameById.get(kId) || kId, ...(bucket?.get(kId) ?? emptyTotals()) }));

        // "All time" reaches back years before anything was logged — list days/weeks from the first real day, not from the range start.
        const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
        const listStart = spanDays > ALL_TIME_DAYS && earliest ? new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), earliest.getUTCDate())) : start;

        // Most recent first, same convention as the Submissions/Profit tabs.
        const days = [] as { date: string; kiosks: ReturnType<typeof toKioskRows> }[];
        for (let d = end; d >= listStart; d = addDays(d, -1)) {
            const dateStr = toDateStr(d);
            days.push({ date: dateStr, kiosks: toKioskRows(byDay.get(dateStr)) });
        }

        const weekStartsAsc: Date[] = [];
        for (let d = startOfWeekUtc(listStart); d <= startOfWeekUtc(end); d = addDays(d, 7)) weekStartsAsc.push(d);
        const weeks = weekStartsAsc
            .slice()
            .reverse()
            .map((weekStart) => {
                const weekStartStr = toDateStr(weekStart);
                const kioskRows = toKioskRows(byWeek.get(weekStartStr));
                const weekTotal = kioskRows.reduce((sum, r) => ({ qty: sum.qty + r.qty, cost: sum.cost + r.cost, uncostedQty: sum.uncostedQty + r.uncostedQty }), emptyTotals());
                return { weekStart: weekStartStr, weekEnd: toDateStr(addDays(weekStart, 6)), kiosks: kioskRows, total: weekTotal };
            });

        return {
            startDate: toDateStr(start),
            endDate: toDateStr(end),
            kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
            days,
            weeks,
            kioskTotals: toKioskRows(kioskTotals),
            grandTotal,
            products: this.productBreakdown(kioskIds, byProduct),
        };
    }

    /** Per kiosk and combined: every product taken, most units first (then by name, so ties are stable). */
    private productBreakdown(kioskIds: string[], byProduct: Map<string, Map<string, ProductRow>>) {
        const sorted = (rows: ProductRow[]) => rows.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
        const perKiosk: Record<string, ProductRow[]> = {};
        const all = new Map<string, ProductRow>();
        for (const k of kioskIds) {
            const rows = [...(byProduct.get(k)?.values() ?? [])].map((r) => ({ ...r }));
            perKiosk[k] = sorted(rows);
            for (const r of rows) {
                const combined = all.get(r.productId) ?? { ...r, qty: 0, cost: 0, uncostedQty: 0 };
                combined.qty += r.qty;
                combined.cost += r.cost;
                combined.uncostedQty += r.uncostedQty;
                if (r.lastTaken > combined.lastTaken) combined.lastTaken = r.lastTaken;
                all.set(r.productId, combined);
            }
        }
        return { byKiosk: perKiosk, all: sorted([...all.values()]) };
    }
}
