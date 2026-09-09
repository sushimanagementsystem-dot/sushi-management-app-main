import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, startOfTodayUtc, startOfWeekUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk } from "@prisma/client";

const COST_MOVEMENT_TYPES = ["EXPIRED_WASTE", "DAMAGE", "STAFF_FOOD"] as const;

type WeekCosts = { wasteCost: number; damageCost: number; staffFoodCost: number; cogs: number };

/**
 * Profit tab — net profit per kiosk, per week. The original spec (§22,
 * "Weekly Sales Import") was marked "DEVELOPMENT" and never shipped an
 * automated sales feed (see KpiService's doc comment) — this ships the
 * simpler version actually asked for: sales entered manually per kiosk
 * per week, net profit computed as
 *
 *   Sales − (COGS + Waste cost + Damage cost + Staff Food cost)
 *
 * where COGS is approved delivery-invoice line value for that week (the
 * same "money actually spent buying stock" figure the Action Inbox's
 * invoice review already approves), and waste/damage/staff-food costs are
 * the same product_movement-derived costs the KPI Dashboard already
 * computes — this only re-groups them by week instead of one flat range.
 */
@Injectable()
export class ProfitService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    private async activeKiosks(): Promise<Kiosk[]> {
        return (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
    }

    async bootstrapProfitPage(kioskId: string | undefined, startDate: Date | undefined, endDate: Date | undefined) {
        const kiosks = await this.activeKiosks();
        const kioskIds = kioskId ? [kioskId] : kiosks.map((k) => k.kiosk_id);

        const end = endDate ?? startOfTodayUtc();
        const start = startDate ?? addDays(end, -7 * 7); // default: last 8 weeks
        const weekStarts = this.buildWeekStarts(start, end);
        const queryStart = weekStarts[0]!;
        const queryEnd = addDays(weekStarts[weekStarts.length - 1]!, 6); // Sunday of the last week

        const [costMovements, deliveryHeaders, salesRows] = await Promise.all([
            this.prisma.productMovement.findMany({
                where: { kiosk_id: { in: kioskIds }, movement_type: { in: [...COST_MOVEMENT_TYPES] }, movement_date: { gte: queryStart, lte: queryEnd } },
                select: { kiosk_id: true, movement_type: true, movement_date: true, cost: true },
            }),
            this.prisma.deliveryHeader.findMany({
                where: { kiosk_id: { in: kioskIds }, delivery_date: { gte: queryStart, lte: queryEnd } },
                select: { delivery_header_id: true, kiosk_id: true, delivery_date: true },
            }),
            this.prisma.weeklySales.findMany({
                where: { kiosk_id: { in: kioskIds }, week_start: { gte: queryStart, lte: queryEnd } },
            }),
        ]);

        const headerById = new Map(deliveryHeaders.map((h) => [h.delivery_header_id, h]));
        const invoiceLines = deliveryHeaders.length
            ? await this.prisma.invoiceLine.findMany({
                  where: { delivery_header_id: { in: deliveryHeaders.map((h) => h.delivery_header_id) }, status: "APPROVED" },
                  select: { delivery_header_id: true, line_total: true },
              })
            : [];

        // kioskId -> weekStartStr -> WeekCosts
        const costsByKioskWeek = new Map<string, Map<string, WeekCosts>>();
        const emptyWeek = (): WeekCosts => ({ wasteCost: 0, damageCost: 0, staffFoodCost: 0, cogs: 0 });
        const bucketFor = (kId: string, weekStr: string) => {
            let byWeek = costsByKioskWeek.get(kId);
            if (!byWeek) costsByKioskWeek.set(kId, (byWeek = new Map()));
            let bucket = byWeek.get(weekStr);
            if (!bucket) byWeek.set(weekStr, (bucket = emptyWeek()));
            return bucket;
        };

        for (const m of costMovements) {
            const weekStr = toDateStr(startOfWeekUtc(m.movement_date));
            const bucket = bucketFor(m.kiosk_id, weekStr);
            const cost = m.cost === null ? 0 : Number(m.cost);
            if (m.movement_type === "EXPIRED_WASTE") bucket.wasteCost += cost;
            else if (m.movement_type === "DAMAGE") bucket.damageCost += cost;
            else if (m.movement_type === "STAFF_FOOD") bucket.staffFoodCost += cost;
        }
        for (const line of invoiceLines) {
            const header = headerById.get(line.delivery_header_id);
            if (!header) continue;
            const weekStr = toDateStr(startOfWeekUtc(header.delivery_date));
            const bucket = bucketFor(header.kiosk_id, weekStr);
            bucket.cogs += line.line_total === null ? 0 : Number(line.line_total);
        }

        // kioskId -> weekStartStr -> {amount, note}
        const salesByKioskWeek = new Map<string, Map<string, { amount: number; note: string | null }>>();
        for (const s of salesRows) {
            const weekStr = toDateStr(s.week_start);
            let byWeek = salesByKioskWeek.get(s.kiosk_id);
            if (!byWeek) salesByKioskWeek.set(s.kiosk_id, (byWeek = new Map()));
            byWeek.set(weekStr, { amount: Number(s.sales_amount), note: s.note });
        }

        const nameById = new Map(kiosks.map((k) => [k.kiosk_id, k.name]));

        // Most recent week first — an owner opening this tab cares about
        // the current/last week, not scrolling from the oldest.
        const weeks = weekStarts
            .slice()
            .reverse()
            .map((weekStart) => {
                const weekStartStr = toDateStr(weekStart);
                const weekEndStr = toDateStr(addDays(weekStart, 6));
                const kioskRows = kioskIds.map((kId) => {
                    const costs = costsByKioskWeek.get(kId)?.get(weekStartStr) ?? emptyWeek();
                    const sales = salesByKioskWeek.get(kId)?.get(weekStartStr) ?? null;
                    const totalCosts = costs.cogs + costs.wasteCost + costs.damageCost + costs.staffFoodCost;
                    return {
                        kioskId: kId,
                        kioskName: nameById.get(kId) || kId,
                        salesAmount: sales ? sales.amount : null,
                        salesNote: sales ? sales.note : null,
                        cogs: costs.cogs,
                        wasteCost: costs.wasteCost,
                        damageCost: costs.damageCost,
                        staffFoodCost: costs.staffFoodCost,
                        totalCosts,
                        netProfit: sales ? sales.amount - totalCosts : null,
                    };
                });
                return { weekStart: weekStartStr, weekEnd: weekEndStr, kiosks: kioskRows };
            });

        return {
            kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
            startDate: toDateStr(queryStart),
            endDate: toDateStr(queryEnd),
            weeks,
        };
    }

    /** weekOf can be any date inside the target week — normalized to that
     * week's Monday so the frontend never computes the anchor itself.
     * Upserts on (kiosk_id, week_start), so re-saving a past week is just
     * a correction, not a new row. */
    async saveWeeklySales(kioskId: string, weekOf: Date, salesAmount: number, note: string | undefined, enteredBy: string) {
        const weekStart = startOfWeekUtc(weekOf);
        await this.prisma.weeklySales.upsert({
            where: { kiosk_id_week_start: { kiosk_id: kioskId, week_start: weekStart } },
            create: { kiosk_id: kioskId, week_start: weekStart, sales_amount: salesAmount, note: note || null, entered_by: enteredBy },
            update: { sales_amount: salesAmount, note: note || null, entered_by: enteredBy },
        });
        return { ok: true };
    }

    /** Monday-anchored week buckets covering [start, end], inclusive of
     * whichever partial weeks those two dates fall in. */
    private buildWeekStarts(start: Date, end: Date): Date[] {
        const first = startOfWeekUtc(start);
        const last = startOfWeekUtc(end);
        const out: Date[] = [];
        for (let d = first; d <= last; d = addDays(d, 7)) out.push(d);
        return out;
    }
}
