import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, endOfDay, startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import { movementCost, productCostMap } from "../../common/movement-cost.util.js";
import { stockBalanceAsOf } from "../../common/stock-balance.util.js";
import { emptyStats, type StatTotals } from "./kpi.types.js";
import type { Kiosk, Product, StockItem, StockMovement } from "@prisma/client";
import { WasteRateService } from "./waste-rate.service.js";
import { ratePct, type RateSample } from "./waste-cohort.js";

/**
 * Owner-facing KPI Dashboard, Kiosk Comparison, and Stock Usage View —
 * port of backend/dashboard/Kpi.js. Scope note (kept from the original):
 * the spec's financial KPIs depend on a Weekly Sales Import module that
 * was never built — this only computes what's derivable from data that
 * exists today; the frontend renders financial metrics as explicit
 * "not available" tiles rather than omitting them.
 */
@Injectable()
export class KpiService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly settings: SettingsService,
        private readonly tableCache: TableCacheService,
        private readonly wasteRate: WasteRateService,
    ) {}

    private async activeKiosks(): Promise<Kiosk[]> {
        return (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
    }

    async bootstrapKpiDashboard(kioskId: string | undefined, startDate: Date | undefined, endDate: Date | undefined) {
        const range = this.resolveRange(startDate, endDate);
        // Same-length window immediately before the selected range — lets
        // the Waste/Damage/Staff Food tiles show a "vs previous period"
        // trend without the caller having to pick a comparison range
        // itself. Deliberately NOT used anywhere else (Kiosk Comparison
        // has no trend UI) to keep that page's query cost unchanged.
        const prevRange = this.previousRange(range);
        const kiosks = await this.activeKiosks();
        const kioskIds = kioskId ? [kioskId] : kiosks.map((k) => k.kiosk_id);

        const [movement, staffFood, stocktakeStatus, deliveryInvoice, ownerActionCounts, plannedByKiosk, previousMovement, wasteSamples] = await Promise.all([
            this.computeProductMovementStats(kioskIds, range.startDate, range.endDate),
            this.computeStaffFoodBreakdown(kioskIds, range.startDate, range.endDate),
            this.computeStocktakeStatus(kioskIds),
            this.computeDeliveryInvoiceStats(kioskIds, range.startDate, range.endDate),
            this.computeOwnerActionCounts(),
            this.fetchPlannedQtyByKiosk(kioskIds, range.startDate, range.endDate),
            this.computeProductMovementStats(kioskIds, prevRange.startDate, prevRange.endDate),
            this.fetchWasteSamples(kioskIds, range.startDate, range.endDate),
        ]);
        const damageWasteRates = this.computeDamageWasteRates(kioskIds, movement.stats, plannedByKiosk, wasteSamples);

        return {
            startDate: toDateStr(range.startDate),
            endDate: toDateStr(range.endDate),
            previousStartDate: toDateStr(prevRange.startDate),
            previousEndDate: toDateStr(prevRange.endDate),
            kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
            movementStats: movement.stats,
            movementByDate: movement.byDate,
            previousMovementStats: previousMovement.stats,
            damageWasteRates,
            staffFood,
            stocktakeStatus,
            deliveryInvoice,
            ownerActionCounts,
        };
    }

    /** Always every active kiosk, one shared period — no per-kiosk period drift when comparing. */
    async bootstrapKioskComparison(startDate: Date | undefined, endDate: Date | undefined) {
        const range = this.resolveRange(startDate, endDate);
        const kiosks = await this.activeKiosks();
        const kioskIds = kiosks.map((k) => k.kiosk_id);

        const [movement, staffFood, stocktakeStatus, deliveryInvoice, plannedByKiosk, wasteSamples, foodWaste] = await Promise.all([
            this.computeProductMovementStats(kioskIds, range.startDate, range.endDate),
            this.computeStaffFoodBreakdown(kioskIds, range.startDate, range.endDate),
            this.computeStocktakeStatus(kioskIds),
            this.computeDeliveryInvoiceStats(kioskIds, range.startDate, range.endDate),
            this.fetchPlannedQtyByKiosk(kioskIds, range.startDate, range.endDate),
            this.fetchWasteSamples(kioskIds, range.startDate, range.endDate),
            this.computeFoodWasteStats(kioskIds, range.startDate, range.endDate),
        ]);
        const damageWasteRates = this.computeDamageWasteRates(kioskIds, movement.stats, plannedByKiosk, wasteSamples);

        return { startDate: toDateStr(range.startDate), endDate: toDateStr(range.endDate), kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })), movementStats: movement.stats, damageWasteRates, foodWaste, staffFood, stocktakeStatus, deliveryInvoice };
    }

    /** Bounded by two stocktakes, not a free date range — the formula is anchored to stocktake events. Only
     * COMPLETE stocktakes the owner has CONFIRMED count: confirming is what posts the correcting movements that
     * make the ledger balance on that day equal what was counted, so before that (or after a decline) the
     * "opening" and "closing" here would be the raw ledger, not the count. */
    async bootstrapStockUsage(kioskId: string | undefined, openingHeaderId: string | undefined, closingHeaderId: string | undefined) {
        const kiosks = (await this.activeKiosks()).map((k) => ({ id: k.kiosk_id, name: k.name }));

        if (!kioskId) return { kiosks, kioskId: "", available: false, reason: "Pick a kiosk." };

        const completeHeaders = await this.prisma.stocktakeHeader.findMany({
            where: { kiosk_id: kioskId, completion_status: "COMPLETE", reconciliation_status: "CONFIRMED" },
            orderBy: { stocktake_date: "desc" },
        });

        if (completeHeaders.length < 2) {
            return {
                kiosks,
                kioskId,
                available: false,
                reason: "Need at least two confirmed stocktakes for this kiosk. A weekly stocktake counts here once the owner has confirmed it in the Action Inbox.",
                completeStocktakes: completeHeaders.map((h) => ({ id: h.stocktake_header_id, date: toDateStr(h.stocktake_date) })),
            };
        }

        const closing = closingHeaderId ? completeHeaders.find((h) => h.stocktake_header_id === closingHeaderId) : completeHeaders[0];
        const opening = openingHeaderId ? completeHeaders.find((h) => h.stocktake_header_id === openingHeaderId) : completeHeaders[1];
        if (!opening || !closing) throw new BadRequestException("Selected stocktake not found.");
        if (opening.stocktake_date >= closing.stocktake_date) throw new BadRequestException("Opening stocktake must be before closing stocktake.");

        const [movements, allStockItems] = await Promise.all([
            this.prisma.stockMovement.findMany({ where: { kiosk_id: kioskId } }),
            this.tableCache.getAll<StockItem>("stock_item"),
        ]);

        const stockItems = allStockItems.filter((s) => s.active);
        const lines = stockItems.map((item) => {
            const ledger = this.computeStockUsageLedger(movements, item.stock_item_id, opening.stocktake_date, closing.stocktake_date);
            return { stockItemId: item.stock_item_id, name: item.name, unit: item.count_unit, ...ledger };
        });

        return {
            kiosks,
            kioskId,
            available: true,
            openingDate: toDateStr(opening.stocktake_date),
            closingDate: toDateStr(closing.stocktake_date),
            completeStocktakes: completeHeaders.map((h) => ({ id: h.stocktake_header_id, date: toDateStr(h.stocktake_date) })),
            lines,
        };
    }

    private resolveRange(startDate: Date | undefined, endDate: Date | undefined): { startDate: Date; endDate: Date } {
        const end = endDate ?? startOfTodayUtc();
        const start = startDate ?? addDays(end, -6);
        return { startDate: start, endDate: end };
    }

    /** Per kiosk × movement_type: qty, cost, count, and how many rows are
     * uncosted (missing unit_cost) — surfaced separately, never silently
     * folded into cost. Also returns the same cost totals broken down by
     * calendar date (`byDate`), one query instead of a second pass over
     * the same rows — the KPI Dashboard's per-tile sparklines are the only
     * current consumer of that half; Kiosk Comparison ignores it. */
    private async computeProductMovementStats(
        kioskIds: string[],
        startDate: Date,
        endDate: Date,
    ): Promise<{ stats: Record<string, Record<string, StatTotals>>; byDate: Record<string, Record<string, Record<string, number>>> }> {
        const [rows, products] = await Promise.all([
            // "before the next midnight", not "<= midnight": movement_date can carry a time of day.
            this.prisma.productMovement.findMany({ where: { kiosk_id: { in: kioskIds }, movement_date: { gte: startDate, lt: addDays(endDate, 1) } } }),
            this.tableCache.getAll<Product>("product"),
        ]);
        const productCost = productCostMap(products);
        const stats: Record<string, Record<string, StatTotals>> = {};
        const byDate: Record<string, Record<string, Record<string, number>>> = {};
        for (const k of kioskIds) {
            stats[k] = { EXPIRED_WASTE: emptyStats(), DAMAGE: emptyStats(), STAFF_FOOD: emptyStats() };
            byDate[k] = { EXPIRED_WASTE: {}, DAMAGE: {}, STAFF_FOOD: {} };
        }
        for (const r of rows) {
            const bucket = stats[r.kiosk_id]?.[r.movement_type];
            if (!bucket) continue;
            const qty = Number(r.qty) || 0;
            const cost = movementCost(r, qty, productCost);
            bucket.qty += qty;
            bucket.cost += cost ?? 0;
            bucket.count += 1;
            if (cost === null) bucket.uncostedCount += 1;
            const dateBucket = byDate[r.kiosk_id]?.[r.movement_type];
            if (dateBucket) {
                const d = toDateStr(r.movement_date);
                dateBucket[d] = (dateBucket[d] ?? 0) + (cost ?? 0);
            }
        }
        return { stats, byDate };
    }

    /** The same-length window immediately preceding `range`, for a
     * "vs previous period" comparison — e.g. range = Sep 11-17 (7 days)
     * gives Sep 4-10, not a fixed "last week" offset, so it stays correct
     * for any preset (Today, Last 30 days, This month, a custom range). */
    private previousRange(range: { startDate: Date; endDate: Date }): { startDate: Date; endDate: Date } {
        const days = Math.round((range.endDate.getTime() - range.startDate.getTime()) / 86400000) + 1;
        const prevEndDate = addDays(range.startDate, -1);
        const prevStartDate = addDays(prevEndDate, -(days - 1));
        return { startDate: prevStartDate, endDate: prevEndDate };
    }

    private async computeStaffFoodBreakdown(kioskIds: string[], startDate: Date, endDate: Date) {
        const [rows, products] = await Promise.all([
            this.prisma.productMovement.findMany({
                where: { kiosk_id: { in: kioskIds }, movement_type: "STAFF_FOOD", movement_date: { gte: startDate, lt: addDays(endDate, 1) } },
            }),
            this.tableCache.getAll<Product>("product"),
        ]);
        const productCost = productCostMap(products);
        const out: Record<string, { total: StatTotals; byDate: Record<string, number> }> = {};
        for (const k of kioskIds) out[k] = { total: emptyStats(), byDate: {} };
        for (const r of rows) {
            const bucket = out[r.kiosk_id];
            if (!bucket) continue;
            const qty = Number(r.qty) || 0;
            const priced = movementCost(r, qty, productCost);
            const cost = priced ?? 0;
            bucket.total.qty += qty;
            bucket.total.cost += cost;
            bucket.total.count += 1;
            if (priced === null) bucket.total.uncostedCount += 1;
            const d = toDateStr(r.movement_date);
            bucket.byDate[d] = (bucket.byDate[d] ?? 0) + cost;
        }
        return out;
    }

    /**
     * Summed in SQL (groupBy), not fetched row-by-row and reduced in JS —
     * production_plan is the single largest table this dashboard touches
     * (one row per kiosk×product×day) and only the per-kiosk total is
     * ever used. Measured: pulling every matching row over this
     * connection cost ~1.2-1.4s on its own (confirmed independent of
     * Prisma — identical with a raw query) vs. ~300ms for the same
     * groupBy aggregate, because only a handful of summary rows cross
     * the wire instead of every matching production_plan row.
     */
    private async fetchPlannedQtyByKiosk(kioskIds: string[], startDate: Date, endDate: Date): Promise<Record<string, number>> {
        const groups = await this.prisma.productionPlan.groupBy({
            by: ["kiosk_id"],
            where: { kiosk_id: { in: kioskIds }, business_date: { gte: startDate, lte: endDate } },
            _sum: { planned_qty: true },
        });
        const plannedByKiosk: Record<string, number> = {};
        for (const g of groups) plannedByKiosk[g.kiosk_id] = Number(g._sum.planned_qty ?? 0);
        return plannedByKiosk;
    }

    /** Morning-waste samples for the period, per kiosk — what the Waste Rate % is worked out from. */
    private async fetchWasteSamples(kioskIds: string[], startDate: Date, endDate: Date): Promise<Map<string, RateSample>> {
        const samples = await this.wasteRate.samples("EXPIRED_WASTE", kioskIds, [{ from: toDateStr(startDate), to: toDateStr(endDate) }]);
        return new Map([...samples].map(([kiosk, [sample]]) => [kiosk, sample!]));
    }

    /** Food Waste is a different thing from Morning Waste: raw stock items thrown away, in grams, costed only where the
     * item has a cost per 100g (rows without one stay UNCOSTED, see FoodWasteProcessor). Never mixed into the waste cost. */
    private async computeFoodWasteStats(kioskIds: string[], startDate: Date, endDate: Date): Promise<Record<string, StatTotals>> {
        const rows = await this.prisma.stockMovement.findMany({
            where: { kiosk_id: { in: kioskIds }, movement_type: "FOOD_WASTE", movement_date: { gte: startDate, lt: addDays(endDate, 1) } },
            select: { kiosk_id: true, qty: true, cost: true },
        });
        const out: Record<string, StatTotals> = Object.fromEntries(kioskIds.map((k) => [k, emptyStats()]));
        for (const r of rows) {
            const bucket = out[r.kiosk_id];
            if (!bucket) continue;
            bucket.qty += Number(r.qty) || 0;
            bucket.count += 1;
            if (r.cost === null) bucket.uncostedCount += 1;
            else bucket.cost += Number(r.cost);
        }
        return out;
    }

    /** Damage/waste rates use production_plan.planned_qty as the volume
     * denominator (the same proxy the Damaged Product threshold check
     * already commits to). Rates are null (not 0) when there's no planned_qty.
     * Takes movementStats/plannedByKiosk already fetched by the caller —
     * both are shared with sibling computations in the same bootstrap call,
     * so this never re-queries them itself. */
    private computeDamageWasteRates(kioskIds: string[], movementStats: Record<string, Record<string, StatTotals>>, plannedByKiosk: Record<string, number>, wasteSamples: Map<string, RateSample>) {
        const out: Record<string, unknown> = {};
        for (const k of kioskIds) {
            const planned = plannedByKiosk[k] ?? 0;
            const sample = wasteSamples.get(k) ?? { events: 0, base: 0 };
            const damage = movementStats[k]!.DAMAGE;
            const waste = movementStats[k]!.EXPIRED_WASTE;
            out[k] = {
                plannedQty: planned,
                damage: { ...damage, ratePer100: planned > 0 ? Math.round((damage.qty / planned) * 10000) / 100 : null },
                // Waste rate = morning-waste units matched to their batch (rateUnits) out of the units planned
                // for those batches (rateBase), not all waste over all planned units, see waste-cohort.ts.
                waste: { ...waste, ratePct: ratePct(sample), rateUnits: sample.events, rateBase: sample.base },
            };
        }
        return out;
    }

    /** FRESH vs STALE (threshold from STOCKTAKE_STALE_DAYS, default 7) vs
     * MISSING (no complete stocktake ever). hasRecentIncomplete flags a
     * started-but-unfinished stocktake newer than the latest complete one. */
    private async computeStocktakeStatus(kioskIds: string[]) {
        const allHeaders = await this.prisma.stocktakeHeader.findMany({ where: { kiosk_id: { in: kioskIds } } });
        const todayD = startOfTodayUtc();
        const staleDays = (await this.settings.getNumber("STOCKTAKE_STALE_DAYS")) ?? 7;

        const out: Record<string, unknown> = {};
        for (const kioskId of kioskIds) {
            const complete = allHeaders.filter((h) => h.kiosk_id === kioskId && h.completion_status === "COMPLETE").sort((a, b) => b.stocktake_date.getTime() - a.stocktake_date.getTime());
            const incomplete = allHeaders.filter((h) => h.kiosk_id === kioskId && h.completion_status === "INCOMPLETE");

            if (!complete.length) {
                out[kioskId] = { status: "MISSING", lastCompleteDate: "", ageDays: null, reconciliationStatus: "", hasRecentIncomplete: incomplete.length > 0 };
                continue;
            }
            const latest = complete[0]!;
            const ageDays = Math.round((todayD.getTime() - latest.stocktake_date.getTime()) / 86400000);
            out[kioskId] = {
                status: ageDays > staleDays ? "STALE" : "FRESH",
                lastCompleteDate: toDateStr(latest.stocktake_date),
                ageDays,
                reconciliationStatus: latest.reconciliation_status,
                hasRecentIncomplete: incomplete.some((h) => h.stocktake_date.getTime() > latest.stocktake_date.getTime()),
            };
        }
        return out;
    }

    private async computeDeliveryInvoiceStats(kioskIds: string[], startDate: Date, endDate: Date) {
        const headers = await this.prisma.deliveryHeader.findMany({ where: { kiosk_id: { in: kioskIds }, delivery_date: { gte: startDate, lte: endDate } } });
        const kioskByHeaderId = new Map(headers.map((h) => [h.delivery_header_id, h.kiosk_id]));
        const headerIds = headers.map((h) => h.delivery_header_id);
        const [files, lines] = await Promise.all([
            this.prisma.deliveryFile.findMany({ where: { delivery_header_id: { in: headerIds }, is_active: true } }),
            this.prisma.invoiceLine.findMany({ where: { delivery_header_id: { in: headerIds } } }),
        ]);

        type Bucket = { submitted: number; inReview: number; reviewed: number; aiPending: number; aiFailed: number; unmappedLines: number; approvedValue: number };
        const out: Record<string, Bucket> = {};
        for (const k of kioskIds) out[k] = { submitted: 0, inReview: 0, reviewed: 0, aiPending: 0, aiFailed: 0, unmappedLines: 0, approvedValue: 0 };

        for (const h of headers) {
            const bucket = out[h.kiosk_id];
            if (!bucket) continue;
            bucket.submitted += 1;
            if (h.status === "IN_REVIEW") bucket.inReview += 1;
            if (h.status === "REVIEWED") bucket.reviewed += 1;
        }
        for (const f of files) {
            const bucket = out[kioskByHeaderId.get(f.delivery_header_id) ?? ""];
            if (!bucket) continue;
            if (f.ai_status === "PENDING") bucket.aiPending += 1;
            if (f.ai_status === "FAILED") bucket.aiFailed += 1;
        }
        for (const l of lines) {
            const bucket = out[kioskByHeaderId.get(l.delivery_header_id) ?? ""];
            if (!bucket) continue;
            if (l.status === "APPROVED") bucket.approvedValue += l.line_total === null ? 0 : Number(l.line_total);
            if (l.status !== "REJECTED" && !l.stock_item_id) bucket.unmappedLines += 1;
        }
        return out;
    }


    /** Opening + Deliveries In + Transfers In − Transfers Out − Closing.
     * Spec also lists "− Returns," but stock_movement has no RETURNS
     * movement_type in this schema — a known spec/schema gap, not invented here. */
    private computeStockUsageLedger(movements: StockMovement[], stockItemId: string, openingDate: Date, closingDate: Date) {
        // A stocktake is a calendar day, but movements can carry a time of day (a Move Stock transfer is stamped
        // when it is applied). Cut both ends at the END of their day, so a movement on the opening day is in the
        // opening balance and one on the closing day is in the closing balance, and none falls between the two.
        const openingEnd = endOfDay(openingDate);
        const closingEnd = endOfDay(closingDate);
        const opening = stockBalanceAsOf(movements, stockItemId, openingEnd);
        const closing = stockBalanceAsOf(movements, stockItemId, closingEnd);

        const between = movements.filter((m) => m.stock_item_id === stockItemId && m.movement_date > openingEnd && m.movement_date <= closingEnd);

        let deliveriesIn = 0;
        let transfersIn = 0;
        let transfersOut = 0;
        for (const m of between) {
            const qty = Number(m.qty) || 0;
            if (m.movement_type === "DELIVERY_IN") deliveriesIn += qty;
            if (m.movement_type === "TRANSFER_IN") transfersIn += qty;
            if (m.movement_type === "TRANSFER_OUT") transfersOut += qty;
        }

        return { opening, closing, deliveriesIn, transfersIn, transfersOut, actualUsage: opening + deliveriesIn + transfersIn - transfersOut - closing };
    }

    // TODO: once ActionInboxService exists, call into it instead of
    // duplicating this trivial groupBy — kept here for now so KPI doesn't
    // depend on an unbuilt module.
    private async computeOwnerActionCounts() {
        const rows = await this.prisma.ownerAction.findMany({ select: { status: true, category: true } });
        const byStatus: Record<string, number> = {};
        const byCategory: Record<string, number> = {};
        for (const r of rows) {
            byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
            byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
        }
        return { byStatus, byCategory };
    }
}
