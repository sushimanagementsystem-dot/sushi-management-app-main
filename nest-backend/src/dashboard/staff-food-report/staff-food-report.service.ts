import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, startOfTodayUtc, startOfWeekUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk } from "@prisma/client";

type Totals = { qty: number; cost: number };
const emptyTotals = (): Totals => ({ qty: 0, cost: 0 });

/**
 * Staff Food section — kiosk-wise and date-wise breakdown of comped staff
 * meals, plus weekly and overall totals. Reads the same `product_movement`
 * (movement_type = STAFF_FOOD) rows the Profit tab's cost calculation
 * already sums — this is purely a different view of that same data, so
 * whatever it shows here is exactly what's already being subtracted from
 * net profit (see ProfitService), not a second, separately-tracked figure.
 *
 * No staff-member breakdown by design — the kiosk form itself never asks
 * who is eating (staff_food.user_id is optional and populated from the
 * submitter's own session, never a name field the requester wanted
 * avoided), and the request was explicitly for kiosk × date, not
 * kiosk × staff member.
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

        const rows = await this.prisma.productMovement.findMany({
            where: { kiosk_id: { in: kioskIds }, movement_type: "STAFF_FOOD", movement_date: { gte: start, lte: end } },
            select: { kiosk_id: true, movement_date: true, qty: true, cost: true },
        });

        // dateStr -> kioskId -> Totals
        const byDay = new Map<string, Map<string, Totals>>();
        // weekStartStr -> kioskId -> Totals
        const byWeek = new Map<string, Map<string, Totals>>();
        const kioskTotals = new Map<string, Totals>(kioskIds.map((k) => [k, emptyTotals()]));
        const grandTotal = emptyTotals();

        for (const r of rows) {
            const qty = Number(r.qty) || 0;
            const cost = r.cost === null ? 0 : Number(r.cost);
            const dateStr = toDateStr(r.movement_date);
            const weekStr = toDateStr(startOfWeekUtc(r.movement_date));

            let dayBucket = byDay.get(dateStr);
            if (!dayBucket) byDay.set(dateStr, (dayBucket = new Map()));
            const dayTotals = dayBucket.get(r.kiosk_id) ?? emptyTotals();
            dayTotals.qty += qty;
            dayTotals.cost += cost;
            dayBucket.set(r.kiosk_id, dayTotals);

            let weekBucket = byWeek.get(weekStr);
            if (!weekBucket) byWeek.set(weekStr, (weekBucket = new Map()));
            const weekTotals = weekBucket.get(r.kiosk_id) ?? emptyTotals();
            weekTotals.qty += qty;
            weekTotals.cost += cost;
            weekBucket.set(r.kiosk_id, weekTotals);

            const kTotal = kioskTotals.get(r.kiosk_id) ?? emptyTotals();
            kTotal.qty += qty;
            kTotal.cost += cost;
            kioskTotals.set(r.kiosk_id, kTotal);

            grandTotal.qty += qty;
            grandTotal.cost += cost;
        }

        const nameById = new Map(kiosks.map((k) => [k.kiosk_id, k.name]));
        const toKioskRows = (bucket: Map<string, Totals> | undefined) =>
            kioskIds.map((kId) => ({ kioskId: kId, kioskName: nameById.get(kId) || kId, ...(bucket?.get(kId) ?? emptyTotals()) }));

        // Most recent first, same convention as the Submissions/Profit tabs.
        const days = [] as { date: string; kiosks: ReturnType<typeof toKioskRows> }[];
        for (let d = end; d >= start; d = addDays(d, -1)) {
            const dateStr = toDateStr(d);
            days.push({ date: dateStr, kiosks: toKioskRows(byDay.get(dateStr)) });
        }

        const weekStartsAsc: Date[] = [];
        for (let d = startOfWeekUtc(start); d <= startOfWeekUtc(end); d = addDays(d, 7)) weekStartsAsc.push(d);
        const weeks = weekStartsAsc
            .slice()
            .reverse()
            .map((weekStart) => {
                const weekStartStr = toDateStr(weekStart);
                const kioskRows = toKioskRows(byWeek.get(weekStartStr));
                const weekTotal = kioskRows.reduce((sum, r) => ({ qty: sum.qty + r.qty, cost: sum.cost + r.cost }), emptyTotals());
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
        };
    }
}
