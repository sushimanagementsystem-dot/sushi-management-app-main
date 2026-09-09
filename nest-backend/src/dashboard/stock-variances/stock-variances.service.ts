import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { stockBalanceAsOf } from "../../common/stock-balance.util.js";
import { addDays, startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, StockItem } from "@prisma/client";

export type StockVariance = {
    kioskId: string;
    kioskName: string;
    stockItemName: string;
    unit: string;
    date: string;
    expected: number;
    actual: number;
    difference: number;
};

/**
 * Stock Variances / Missing Products Detection — automatically catches the
 * exact "staff waste it but never log it" gap the request describes: for
 * every COMPLETE stocktake in range, compares what the stock ledger says
 * should be on hand (opening balance + every logged delivery/transfer/
 * waste/damage/staff-food movement, up to that stocktake's own date) against
 * what staff actually counted. A gap between those two numbers means
 * *something* happened to that stock that was never logged as any kind of
 * movement — which is precisely what an unlogged waste/theft/miscount
 * looks like.
 *
 * This is not new math — StocktakeReviewService.confirm() already computes
 * this exact same expected-vs-actual delta (via the same stockBalanceAsOf
 * helper) to post a correcting movement when the owner confirms a
 * stocktake. The gap this closes is that that number was never actually
 * shown to anyone — it was computed and immediately consumed into a
 * silent correction. This surfaces it as the "Kiosk – Item: Expected X,
 * Actual Y, Difference Z" report the request asked for, filtered to the
 * same variance thresholds (STOCKTAKE_VARIANCE_PCT / _MIN_UNITS) already
 * owner-configurable on the Settings page, so "significant" means the same
 * thing here as it does everywhere else in the app.
 */
@Injectable()
export class StockVariancesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly settings: SettingsService,
    ) {}

    async bootstrap(startDate: Date | undefined, endDate: Date | undefined) {
        const kiosks = (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
        const kioskIds = kiosks.map((k) => k.kiosk_id);

        const end = endDate ?? startOfTodayUtc();
        const start = startDate ?? addDays(end, -29); // default: last 30 days

        const headers = await this.prisma.stocktakeHeader.findMany({
            where: { kiosk_id: { in: kioskIds }, completion_status: "COMPLETE", stocktake_date: { gte: start, lte: end } },
            orderBy: { stocktake_date: "desc" },
        });

        const nameById = new Map(kiosks.map((k) => [k.kiosk_id, k.name]));

        if (!headers.length) {
            return { startDate: toDateStr(start), endDate: toDateStr(end), kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })), variances: [] as StockVariance[] };
        }

        const [lines, movements, items] = await Promise.all([
            this.prisma.stocktakeLine.findMany({ where: { stocktake_header_id: { in: headers.map((h) => h.stocktake_header_id) } } }),
            this.prisma.stockMovement.findMany({ where: { kiosk_id: { in: kioskIds } } }),
            this.tableCache.getAll<StockItem>("stock_item"),
        ]);

        const itemById = new Map(items.map((i) => [i.stock_item_id, i]));
        const headerById = new Map(headers.map((h) => [h.stocktake_header_id, h]));
        const movementsByKiosk = new Map<string, typeof movements>();
        for (const m of movements) {
            const bucket = movementsByKiosk.get(m.kiosk_id);
            if (bucket) bucket.push(m);
            else movementsByKiosk.set(m.kiosk_id, [m]);
        }

        const pct = (await this.settings.getNumber("STOCKTAKE_VARIANCE_PCT")) ?? 50;
        const minUnits = (await this.settings.getNumber("STOCKTAKE_VARIANCE_MIN_UNITS")) ?? 5;

        const variances: StockVariance[] = [];
        for (const line of lines) {
            const header = headerById.get(line.stocktake_header_id);
            const item = itemById.get(line.stock_item_id);
            if (!header || !item) continue;

            const kioskMovements = movementsByKiosk.get(header.kiosk_id) ?? [];
            const expected = stockBalanceAsOf(kioskMovements, line.stock_item_id, header.stocktake_date);
            const actual = Number(line.counted_qty);
            const difference = Math.round((actual - expected) * 100) / 100;
            const absDifference = Math.abs(difference);
            if (absDifference === 0) continue;

            // Same rule as the stocktake submission's own "significant
            // change" flag (weekly-stocktake.processor.ts): a minimum
            // absolute unit gap AND a minimum percentage gap, both must
            // hold — except when expected is 0, where a percentage is
            // meaningless (division by zero) and the absolute gap alone
            // decides (an item expected to have nothing on hand showing
            // up, or vice versa, is worth flagging on its own).
            const passesThreshold = expected === 0 ? absDifference >= minUnits : absDifference >= minUnits && (absDifference / Math.abs(expected)) * 100 > pct;
            if (!passesThreshold) continue;

            variances.push({
                kioskId: header.kiosk_id,
                kioskName: nameById.get(header.kiosk_id) || header.kiosk_id,
                stockItemName: item.name,
                unit: item.count_unit,
                date: toDateStr(header.stocktake_date),
                expected: Math.round(expected * 100) / 100,
                actual,
                difference,
            });
        }

        variances.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

        return {
            startDate: toDateStr(start),
            endDate: toDateStr(end),
            kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
            thresholds: { pct, minUnits },
            variances,
        };
    }
}
