import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, startOfTodayUtc, startOfWeekUtc, toDateStr } from "../../common/date.util.js";
import { movementCost, productCostMap } from "../../common/movement-cost.util.js";
import { profitFigures } from "./profit-calc.js";
import { parseLabourReport } from "./labour-report.js";
import type { Kiosk, Product, StockItem } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";

const COST_MOVEMENT_TYPES = ["EXPIRED_WASTE", "DAMAGE", "STAFF_FOOD"] as const;

type WeekCosts = { wasteCost: number; damageCost: number; staffFoodCost: number };
type CogsResult = { cogs: number | null; openingDate: string | null; closingDate: string | null; uncostedCount: number };

/**
 * Profit tab — net profit per kiosk, per week. The original spec (§22,
 * "Weekly Sales Import") was marked "DEVELOPMENT" and never shipped an
 * automated sales feed (see KpiService's doc comment) — this ships the
 * simpler version actually asked for: sales entered manually per kiosk
 * per week, net profit computed from the arithmetic in profit-calc.ts.
 *
 * COGS (confirmed with Evan, 2026-10-04): opening stocktake value +
 * approved deliveries − closing stocktake value, for the period between
 * two consecutive CONFIRMED stocktakes at a kiosk — i.e. real stock usage,
 * which already includes waste, damage and staff food (all three leave the
 * shelf between the two counts). Those three are still shown as their own
 * columns, for visibility into what's inside COGS, but are never added to
 * it a second time. A week with no closing stocktake shows a blank COGS —
 * there's nothing to compute yet, not a zero. Items with no unit cost value
 * at €0 in the calculation (not excluded — Evan wants COGS computed for
 * everything, not silently incomplete) and are counted in `uncostedCount`
 * so they're easy to find and price in Data Tables > Stock Item.
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
        // Movement and delivery dates can carry a time of day, so Sunday is "before Monday", not "<= Sunday midnight".
        const dayAfterEnd = addDays(queryEnd, 1);

        const [costMovements, salesRows, products, costRows, labourRows] = await Promise.all([
            this.prisma.productMovement.findMany({
                where: { kiosk_id: { in: kioskIds }, movement_type: { in: [...COST_MOVEMENT_TYPES] }, movement_date: { gte: queryStart, lt: dayAfterEnd } },
                select: { kiosk_id: true, movement_type: true, movement_date: true, cost: true, unit_cost: true, qty: true, product_id: true },
            }),
            this.prisma.weeklySales.findMany({
                where: { kiosk_id: { in: kioskIds }, week_start: { gte: queryStart, lte: queryEnd } },
            }),
            this.tableCache.getAll<Product>("product"),
            this.prisma.weeklyCosts.findMany({ where: { kiosk_id: { in: kioskIds }, week_start: { gte: queryStart, lte: queryEnd } } }),
            this.prisma.weeklyLabour.findMany({ where: { kiosk_id: { in: kioskIds }, week_start: { gte: queryStart, lte: queryEnd } } }),
        ]);
        // A movement booked before its product had a cost has none stored — price it at the product's cost now, as the
        // Staff Food, Kiosk Comparison and KPI pages do, so the same waste / staff-food figure is subtracted here.
        const productCosts = productCostMap(products);

        // kioskId -> weekStartStr -> WeekCosts (waste/damage/staff food — shown as a breakdown, no longer added into COGS)
        const costsByKioskWeek = new Map<string, Map<string, WeekCosts>>();
        const emptyWeek = (): WeekCosts => ({ wasteCost: 0, damageCost: 0, staffFoodCost: 0 });
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
            const cost = movementCost(m, Number(m.qty) || 0, productCosts) ?? 0;
            if (m.movement_type === "EXPIRED_WASTE") bucket.wasteCost += cost;
            else if (m.movement_type === "DAMAGE") bucket.damageCost += cost;
            else if (m.movement_type === "STAFF_FOOD") bucket.staffFoodCost += cost;
        }

        const cogsByKioskWeek = await this.computeStocktakeCogs(kioskIds, queryEnd);

        // kioskId -> weekStartStr -> {amount, note}
        const salesByKioskWeek = new Map<string, Map<string, { amount: number; note: string | null }>>();
        for (const s of salesRows) {
            const weekStr = toDateStr(s.week_start);
            let byWeek = salesByKioskWeek.get(s.kiosk_id);
            if (!byWeek) salesByKioskWeek.set(s.kiosk_id, (byWeek = new Map()));
            byWeek.set(weekStr, { amount: Number(s.sales_amount), note: s.note });
        }

        const typedCostsByKioskWeek = new Map(costRows.map((c) => [`${c.kiosk_id}|${toDateStr(c.week_start)}`, c]));
        const labourByKioskWeek = new Map(labourRows.map((l) => [`${l.kiosk_id}|${toDateStr(l.week_start)}`, l]));
        const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

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
                    const cogsResult = cogsByKioskWeek.get(kId)?.get(weekStartStr) ?? { cogs: null, openingDate: null, closingDate: null, uncostedCount: 0 };
                    const sales = salesByKioskWeek.get(kId)?.get(weekStartStr) ?? null;
                    const typed = typedCostsByKioskWeek.get(`${kId}|${weekStartStr}`);
                    const labour = labourByKioskWeek.get(`${kId}|${weekStartStr}`);
                    const fixedCosts = num(typed?.fixed_costs);
                    const miscCosts = num(typed?.misc_costs);
                    const labourCost = num(labour?.labour_cost);
                    const { totalCosts, royalty, totalLabour, grossProfit, ebitda } = profitFigures({
                        sales: sales ? sales.amount : null,
                        cogs: cogsResult.cogs,
                        fixedCosts,
                        miscCosts,
                        labourCost,
                    });
                    return {
                        kioskId: kId,
                        kioskName: nameById.get(kId) || kId,
                        salesAmount: sales ? sales.amount : null,
                        salesNote: sales ? sales.note : null,
                        cogs: cogsResult.cogs,
                        cogsOpeningDate: cogsResult.openingDate,
                        cogsClosingDate: cogsResult.closingDate,
                        cogsUncostedCount: cogsResult.uncostedCount,
                        wasteCost: costs.wasteCost,
                        damageCost: costs.damageCost,
                        staffFoodCost: costs.staffFoodCost,
                        fixedCosts,
                        miscCosts,
                        totalCosts,
                        royalty,
                        grossProfit,
                        labourHours: num(labour?.hours),
                        labourRate: num(labour?.hourly_rate),
                        labourCost,
                        totalLabour,
                        ebitda,
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

    /**
     * COGS per kiosk per week: walks each kiosk's CONFIRMED stocktakes in
     * date order and, for every consecutive pair, values opening and
     * closing (counted_qty x the item's current_unit_cost, €0 for an item
     * with no cost yet — see class doc) and adds every APPROVED invoice
     * line delivered strictly between the two dates. That figure is filed
     * under whichever week the CLOSING stocktake's date falls in — "this
     * week's number" is "since the last time stock was counted," matching
     * how Evan actually runs it (a Sunday evening or Monday morning count).
     * A kiosk-week with no closing stocktake in it is simply absent from
     * the returned map — the caller treats that as "nothing to show yet."
     */
    private async computeStocktakeCogs(kioskIds: string[], upTo: Date): Promise<Map<string, Map<string, CogsResult>>> {
        const dayAfterUpTo = addDays(upTo, 1);
        const [headers, invoiceLines, stockItems] = await Promise.all([
            this.prisma.stocktakeHeader.findMany({
                where: { kiosk_id: { in: kioskIds }, reconciliation_status: "CONFIRMED", stocktake_date: { lt: dayAfterUpTo } },
                orderBy: { stocktake_date: "asc" },
                include: { stocktake_lines: { select: { stock_item_id: true, counted_qty: true } } },
            }),
            this.prisma.invoiceLine.findMany({
                where: { status: "APPROVED", delivery_header: { kiosk_id: { in: kioskIds }, delivery_date: { lt: dayAfterUpTo } } },
                select: { line_total: true, delivery_header: { select: { kiosk_id: true, delivery_date: true } } },
            }),
            this.tableCache.getAll<StockItem>("stock_item"),
        ]);
        const unitCostById = new Map(stockItems.map((s) => [s.stock_item_id, s.current_unit_cost === null ? null : Number(s.current_unit_cost)]));

        const headersByKiosk = new Map<string, typeof headers>();
        for (const h of headers) (headersByKiosk.get(h.kiosk_id) ?? headersByKiosk.set(h.kiosk_id, []).get(h.kiosk_id)!).push(h);

        const valuation = (lines: { stock_item_id: string; counted_qty: unknown }[]): { value: number; uncosted: Set<string> } => {
            let value = 0;
            const uncosted = new Set<string>();
            for (const l of lines) {
                const cost = unitCostById.get(l.stock_item_id);
                if (cost === null || cost === undefined) {
                    uncosted.add(l.stock_item_id);
                    continue;
                }
                value += Number(l.counted_qty) * cost;
            }
            return { value, uncosted };
        };

        const result = new Map<string, Map<string, CogsResult>>();
        for (const [kioskId, kioskHeaders] of headersByKiosk) {
            const byWeek = new Map<string, CogsResult>();
            for (let i = 1; i < kioskHeaders.length; i++) {
                const opening = kioskHeaders[i - 1]!;
                const closing = kioskHeaders[i]!;
                const openingVal = valuation(opening.stocktake_lines);
                const closingVal = valuation(closing.stocktake_lines);
                const purchases = invoiceLines
                    .filter((l) => l.delivery_header.kiosk_id === kioskId && l.delivery_header.delivery_date > opening.stocktake_date && l.delivery_header.delivery_date <= closing.stocktake_date)
                    .reduce((sum, l) => sum + (l.line_total === null ? 0 : Number(l.line_total)), 0);
                const uncostedCount = new Set([...openingVal.uncosted, ...closingVal.uncosted]).size;
                const weekStr = toDateStr(startOfWeekUtc(closing.stocktake_date));
                byWeek.set(weekStr, {
                    cogs: Math.round((openingVal.value + purchases - closingVal.value) * 100) / 100,
                    openingDate: toDateStr(opening.stocktake_date),
                    closingDate: toDateStr(closing.stocktake_date),
                    uncostedCount,
                });
            }
            result.set(kioskId, byWeek);
        }
        return result;
    }

    /** Sets the fixed and/or misc cost for one kiosk-week (whichever is given; the other is left as it was). */
    async saveWeeklyCosts(kioskId: string, weekOf: Date, fixedCosts: number | undefined, miscCosts: number | undefined, enteredBy: string) {
        if (fixedCosts === undefined && miscCosts === undefined) throw new BadRequestException("Enter a fixed cost or a misc cost.");
        const kiosk = (await this.activeKiosks()).find((k) => k.kiosk_id === kioskId);
        if (!kiosk) throw new BadRequestException("Unknown kiosk.");
        const weekStart = startOfWeekUtc(weekOf);
        const values = { ...(fixedCosts !== undefined ? { fixed_costs: fixedCosts } : {}), ...(miscCosts !== undefined ? { misc_costs: miscCosts } : {}), entered_by: enteredBy };
        await this.prisma.weeklyCosts.upsert({
            where: { kiosk_id_week_start: { kiosk_id: kioskId, week_start: weekStart } },
            create: { kiosk_id: kioskId, week_start: weekStart, ...values },
            update: values,
        });
        return {};
    }

    /** Reads an uploaded payroll export and says what it would save — nothing is written until the owner submits the rows. */
    async previewLabourReport(fileBase64: string, weekOf: Date) {
        const kiosks = (await this.activeKiosks()).map((k) => ({ id: k.kiosk_id, name: k.name }));
        return parseLabourReport(Buffer.from(fileBase64, "base64"), kiosks, { weekOf });
    }

    /** Saves the reviewed labour rows — one per kiosk per week; sending a week again replaces it (a correction, not a duplicate). */
    async saveWeeklyLabour(rows: { kioskId: string; weekStart: string; hours: number; hourlyRate?: number | null; labourCost?: number | null }[], fileName: string | undefined, uploadedBy: string) {
        if (!rows.length) throw new BadRequestException("There are no rows to submit.");
        const known = new Set((await this.activeKiosks()).map((k) => k.kiosk_id));
        const bad = rows.find((r) => !known.has(r.kioskId));
        if (bad) throw new BadRequestException(`Unknown kiosk "${bad.kioskId}".`);

        const clean = rows.map((r) => {
            const weekStart = startOfWeekUtc(new Date(r.weekStart));
            const hours = Math.round(r.hours * 100) / 100;
            const rate = r.hourlyRate ?? null;
            const cost = r.labourCost ?? (rate !== null ? Math.round(hours * rate * 100) / 100 : null);
            return { kiosk_id: r.kioskId, week_start: weekStart, hours, hourly_rate: rate, labour_cost: cost };
        });
        await this.prisma.$transaction(
            async (tx) => {
                for (const c of clean) {
                    const data = { hours: c.hours, hourly_rate: c.hourly_rate, labour_cost: c.labour_cost, source_file: fileName || null, uploaded_by: uploadedBy };
                    await tx.weeklyLabour.upsert({ where: { kiosk_id_week_start: { kiosk_id: c.kiosk_id, week_start: c.week_start } }, create: { kiosk_id: c.kiosk_id, week_start: c.week_start, ...data }, update: data });
                }
            },
            { timeout: 30_000 },
        );
        return { saved: clean.length };
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
