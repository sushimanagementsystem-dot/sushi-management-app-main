import type { StockMovement } from "@prisma/client";

/** IN-minus-OUT ledger balance for one stock item, from a pre-fetched
 * movements array — shared by KpiService's Stock Usage View and
 * StocktakeReviewService's confirm-stocktake reconciliation (both derive
 * "current stock" from the same full movement history, see
 * backend/dashboard/Kpi.js's stockBalanceAsOf_). asOfDate: inclusive upper
 * bound, or undefined for the full ledger to date. */
export function stockBalanceAsOf(movements: StockMovement[], stockItemId: string, asOfDate?: Date): number {
    return movements
        .filter((m) => m.stock_item_id === stockItemId && (!asOfDate || m.movement_date <= asOfDate))
        .reduce((sum, m) => sum + (m.direction === "IN" ? Number(m.qty) : -Number(m.qty)), 0);
}
