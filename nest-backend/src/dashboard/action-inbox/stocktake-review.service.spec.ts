import { describe, it, expect, vi } from "vitest";
import { StocktakeReviewService } from "./stocktake-review.service.js";

const mv = (movement_type: string, direction: "IN" | "OUT", qty: number, at: string) => ({ stock_item_id: "S1", movement_type, direction, qty, movement_date: new Date(at) });

function build(movements: ReturnType<typeof mv>[], countedQty: number, stocktakeDate = "2026-09-10T00:00:00Z", purchasing: { runAfterStocktakeConfirmed: () => Promise<unknown> } = { runAfterStocktakeConfirmed: async () => ({ ran: false }) }) {
    const created: Record<string, unknown>[] = [];
    const tx = {
        stockMovement: { createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => void created.push(...data)) },
        stocktakeHeader: { update: vi.fn(async () => ({})) },
    };
    const prisma = {
        stocktakeHeader: { findUnique: async () => ({ stocktake_header_id: "H1", kiosk_id: "K1", submission_id: null, stocktake_date: new Date(stocktakeDate), reconciliation_status: "PENDING" }) },
        stocktakeLine: { findMany: async () => [{ stocktake_line_id: "L1", stock_item_id: "S1", counted_qty: countedQty }] },
        stockMovement: { findMany: async () => movements },
        stockItem: { findMany: async () => [{ stock_item_id: "S1", current_unit_cost: null }] },
        $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    };
    const ownerState = { findOwnerAction: async () => null };
    return { svc: new StocktakeReviewService(prisma as never, ownerState as never, purchasing as never), created };
}

describe("StocktakeReviewService.confirm", () => {
    it("reconciles the count against the ledger as of the count day, even when confirmed after later movements", async () => {
        const { svc, created } = build(
            [mv("DELIVERY_IN", "IN", 4, "2026-09-05T00:00:00Z"), mv("DELIVERY_IN", "IN", 6, "2026-09-12T00:00:00Z"), mv("TRANSFER_OUT", "OUT", 2, "2026-09-13T00:00:00Z")],
            10, // counted 10 on 09-10; the ledger that day said 4
        );
        await svc.confirm("H1", "owner");
        // +6 to bring 4 up to 10. The later delivery/transfer (a net +4) must NOT be folded into the adjustment.
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ movement_type: "STOCKTAKE_ADJUSTMENT", direction: "IN", qty: 6 });
    });

    it("counts a movement stamped with a time on the stocktake day as part of that day's balance", async () => {
        const { svc, created } = build([mv("TRANSFER_IN", "IN", 5, "2026-09-10T09:31:00Z")], 5);
        await svc.confirm("H1", "owner");
        expect(created).toHaveLength(0); // the ledger already said 5
    });

    it("posts an OUT adjustment when the count is below the ledger", async () => {
        const { svc, created } = build([mv("DELIVERY_IN", "IN", 8, "2026-09-01T00:00:00Z")], 3);
        await svc.confirm("H1", "owner");
        expect(created[0]).toMatchObject({ direction: "OUT", qty: 5 });
    });

    it("drafts the orders once the stocktake is confirmed, and a failure while drafting never fails the confirmation", async () => {
        const runAfter = vi.fn(async () => {
            throw new Error("mail is down");
        });
        const { svc, created } = build([mv("DELIVERY_IN", "IN", 8, "2026-09-01T00:00:00Z")], 3, "2026-09-10T00:00:00Z", { runAfterStocktakeConfirmed: runAfter });
        await expect(svc.confirm("H1", "owner")).resolves.toBeUndefined();
        expect(runAfter).toHaveBeenCalledTimes(1);
        expect(created).toHaveLength(1); // the stocktake itself was still posted
    });
});
