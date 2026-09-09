import type { StockItemPar, StockMovement } from "@prisma/client";
import { stockBalanceAsOf } from "./stock-balance.util.js";

export type ItemTrigger = {
    triggered: boolean;
    currentStock: number | null;
    shortfall: number;
    flag: "SET_PAR" | "AWAIT_STOCKTAKE" | null;
};

/**
 * Per spec 20.2-20.4 — port of backend/dashboard/Purchasing.js's
 * computeItemTrigger_. No stock_item_par row -> SET_PAR. No movement
 * history at all for this item at this kiosk -> AWAIT_STOCKTAKE (a current
 * balance of 0 from no data is not the same as a confirmed empty count).
 * Shared by PurchasingScanService (the weekly writer) and
 * ActionInboxService's PURCHASING_RECOMMENDATION detail case, which
 * re-derives the same per-kiosk breakdown live rather than persisting it.
 */
export function computeItemTrigger(stockItemId: string, parRow: StockItemPar | null, movements: StockMovement[]): ItemTrigger {
    if (!parRow) return { triggered: false, currentStock: null, shortfall: 0, flag: "SET_PAR" };

    const hasHistory = movements.some((m) => m.stock_item_id === stockItemId);
    if (!hasHistory) return { triggered: false, currentStock: null, shortfall: 0, flag: "AWAIT_STOCKTAKE" };

    const currentStock = stockBalanceAsOf(movements, stockItemId);
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

/** 20.8: Castlebay salmon orders are always 4 boxes per triggered kiosk, not shortfall-based. */
export function castlebayPacksOverride(supplierName: string | undefined | null): number | null {
    return supplierName && /^castlebay$/i.test(supplierName.trim()) ? 4 : null;
}

/** Latest date this kiosk+item was physically counted (STOCKTAKE_ADJUSTMENT
 * movement), not just any ledger touch. null if never counted. */
export function stockCountDate(stockItemId: string, movements: StockMovement[]): Date | null {
    const dates = movements
        .filter((m) => m.stock_item_id === stockItemId && m.movement_type === "STOCKTAKE_ADJUSTMENT")
        .map((m) => m.movement_date)
        .sort((a, b) => a.getTime() - b.getTime());
    return dates.length ? dates[dates.length - 1]! : null;
}
