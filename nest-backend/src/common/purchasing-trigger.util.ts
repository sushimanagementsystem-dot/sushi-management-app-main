import type { StockItemPar, StockMovement, SupplierItemMap } from "@prisma/client";
import { stockBalanceAsOf } from "./stock-balance.util.js";

export type ItemTrigger = {
    triggered: boolean;
    currentStock: number | null;
    shortfall: number;
    flag: "SET_PAR" | "AWAIT_STOCKTAKE" | null;
};

/** Sum of stockBalanceAsOf across every id in stockItemIds — the real item
 * plus its ambient duplicates ("Kiosk (ambient product only)" rows), if
 * any. Evan counts the same physical stock in two locations for stocktake
 * accuracy; purchasing needs the combined total. A plain item with no
 * duplicates is just [stockItemId], same result as before. */
export function combinedStockBalance(stockItemIds: string[], movements: StockMovement[]): number {
    return stockItemIds.reduce((sum, id) => sum + stockBalanceAsOf(movements, id), 0);
}

/**
 * Per spec 20.2-20.4 — port of backend/dashboard/Purchasing.js's
 * computeItemTrigger_. No stock_item_par row -> SET_PAR. No movement
 * history at all for any of stockItemIds at this kiosk -> AWAIT_STOCKTAKE (a
 * current balance of 0 from no data is not the same as a confirmed empty
 * count). Shared by PurchasingScanService (the weekly writer) and
 * ActionInboxService's PURCHASING_RECOMMENDATION detail case, which
 * re-derives the same per-kiosk breakdown live rather than persisting it.
 *
 * stockItemIds: the real item's id plus any ambient duplicates (see
 * combinedStockBalance). Almost always just [stockItemId].
 */
export function computeItemTrigger(stockItemIds: string[], parRow: StockItemPar | null, movements: StockMovement[], hasConfirmedCount = false): ItemTrigger {
    if (!parRow) return { triggered: false, currentStock: null, shortfall: 0, flag: "SET_PAR" };

    // A confirmed stocktake line counts as history even when it posted no movement: confirming a count that equals the
    // ledger balance (e.g. counted 0, balance 0) posts nothing, and without this an item counted at zero would wait
    // for a stocktake forever instead of being ordered.
    const hasHistory = hasConfirmedCount || movements.some((m) => stockItemIds.includes(m.stock_item_id));
    if (!hasHistory) return { triggered: false, currentStock: null, shortfall: 0, flag: "AWAIT_STOCKTAKE" };

    const currentStock = combinedStockBalance(stockItemIds, movements);
    const targetPar = parRow.target_par === null ? null : Number(parRow.target_par);
    const minimumStock = parRow.minimum_stock === null ? null : Number(parRow.minimum_stock);
    const safetyStock = parRow.safety_stock === null ? 0 : Number(parRow.safety_stock);
    const triggerPoint = minimumStock !== null ? minimumStock : targetPar;

    if (triggerPoint === null) return { triggered: false, currentStock, shortfall: 0, flag: "SET_PAR" };
    if (currentStock > triggerPoint) return { triggered: false, currentStock, shortfall: 0, flag: null };

    const refillLevel = (targetPar !== null ? targetPar : triggerPoint) + safetyStock;
    return { triggered: true, currentStock, shortfall: Math.max(0, refillLevel - currentStock), flag: null };
}

/** 20.5: whole packs, then rounded up again to the supplier's order multiple (default 1 = no extra rounding). */
export function applyPackRounding(shortfall: number, packSize: number, orderMultiple: number): number {
    const size = packSize > 0 ? packSize : 1;
    const multiple = orderMultiple > 0 ? orderMultiple : 1;
    return Math.ceil(Math.ceil(shortfall / size) / multiple) * multiple;
}

/** 20.8: some supplier_item_map rows carry a fixed per-triggered-kiosk order
 * quantity instead of a shortfall-based one — e.g. Castlebay's salmon has a
 * 4-case minimum per delivery regardless of the computed shortfall. Set on
 * the specific mapping (fixed_order_qty), not by supplier name — a supplier
 * can carry both fixed-qty items (salmon) and normal shortfall-based ones
 * (packaging) at once. Blank/0 = no override. */
export function fixedOrderQtyOverride(mapping: Pick<SupplierItemMap, "fixed_order_qty"> | null | undefined): number | null {
    const n = mapping?.fixed_order_qty;
    return typeof n === "number" && n > 0 ? n : null;
}

/** Latest date this kiosk+item was physically counted (STOCKTAKE_ADJUSTMENT
 * movement), not just any ledger touch. null if never counted. stockItemIds:
 * the real item's id plus any ambient duplicates — a count logged against
 * either location counts as the item being counted. */
export function stockCountDate(stockItemIds: string[], movements: StockMovement[], confirmedCountDate: Date | null = null): Date | null {
    const dates = movements
        .filter((m) => stockItemIds.includes(m.stock_item_id) && m.movement_type === "STOCKTAKE_ADJUSTMENT")
        .map((m) => m.movement_date);
    if (confirmedCountDate) dates.push(confirmedCountDate);
    dates.sort((a, b) => a.getTime() - b.getTime());
    return dates.length ? dates[dates.length - 1]! : null;
}

/** kiosk_id -> stock_item_id -> date of the latest CONFIRMED stocktake that counted the item there. */
export type ConfirmedCounts = Map<string, Map<string, Date>>;

export async function loadConfirmedCounts(
    prisma: { stocktakeLine: { findMany: (args: never) => Promise<{ stock_item_id: string; stocktake_header: { kiosk_id: string; stocktake_date: Date } }[]> } },
    kioskIds?: string[],
): Promise<ConfirmedCounts> {
    const where = { stocktake_header: { reconciliation_status: "CONFIRMED", ...(kioskIds ? { kiosk_id: { in: kioskIds } } : {}) } };
    const lines = await prisma.stocktakeLine.findMany({ where, select: { stock_item_id: true, stocktake_header: { select: { kiosk_id: true, stocktake_date: true } } } } as never);
    const out: ConfirmedCounts = new Map();
    for (const l of lines) {
        const perKiosk = out.get(l.stocktake_header.kiosk_id) ?? new Map<string, Date>();
        const prev = perKiosk.get(l.stock_item_id);
        if (!prev || prev < l.stocktake_header.stocktake_date) perKiosk.set(l.stock_item_id, l.stocktake_header.stocktake_date);
        out.set(l.stocktake_header.kiosk_id, perKiosk);
    }
    return out;
}
