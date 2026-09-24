import { describe, it, expect } from "vitest";
import { KpiService } from "./kpi.service.js";

type Move = { stock_item_id: string; movement_type: string; direction: "IN" | "OUT"; qty: number; movement_date: Date };
const mv = (movement_type: string, direction: "IN" | "OUT", qty: number, at: string): Move => ({ stock_item_id: "S1", movement_type, direction, qty, movement_date: new Date(at) });

const ledger = (movements: Move[], opening: string, closing: string) =>
    (new KpiService({} as never, {} as never, {} as never, {} as never) as unknown as {
        computeStockUsageLedger(m: Move[], id: string, o: Date, c: Date): Record<string, number>;
    }).computeStockUsageLedger(movements, "S1", new Date(opening), new Date(closing));

describe("stock usage: which stocktakes count", () => {
    it("asks the database for COMPLETE and CONFIRMED stocktakes only, and says why when there are fewer than two", async () => {
        let where: unknown;
        const prisma = { stocktakeHeader: { findMany: async (a: { where: unknown }) => ((where = a.where), []) } };
        const cache = { getAll: async () => [{ kiosk_id: "K1", name: "One", active: true }] };
        const svc = new KpiService(prisma as never, {} as never, cache as never, {} as never);
        const res = (await svc.bootstrapStockUsage("K1", undefined, undefined)) as { available: boolean; reason: string };

        expect(where).toMatchObject({ kiosk_id: "K1", completion_status: "COMPLETE", reconciliation_status: "CONFIRMED" });
        expect(res.available).toBe(false);
        expect(res.reason).toMatch(/two confirmed stocktakes/);
    });
});

describe("stock usage ledger", () => {
    it("opening + deliveries + transfers in - transfers out - closing", () => {
        const l = ledger(
            [
                mv("STOCKTAKE_ADJUSTMENT", "IN", 10, "2026-09-01T00:00:00Z"), // opening count: 10 on hand
                mv("DELIVERY_IN", "IN", 6, "2026-09-03T00:00:00Z"),
                mv("TRANSFER_IN", "IN", 2, "2026-09-04T00:00:00Z"),
                mv("TRANSFER_OUT", "OUT", 1, "2026-09-05T00:00:00Z"),
                mv("FOOD_WASTE", "OUT", 4, "2026-09-06T00:00:00Z"),
            ],
            "2026-09-01T00:00:00Z",
            "2026-09-08T00:00:00Z",
        );
        expect(l).toMatchObject({ opening: 10, deliveriesIn: 6, transfersIn: 2, transfersOut: 1, closing: 13 });
        expect(l.actualUsage).toBe(4); // 10 + 6 + 2 - 1 - 13: what left the shelf by any other route
    });

    it("a movement stamped with a time on the opening day is in the opening balance, not lost between the two", () => {
        const l = ledger([mv("TRANSFER_IN", "IN", 5, "2026-09-01T09:31:00Z")], "2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z");
        expect(l).toMatchObject({ opening: 5, closing: 5, transfersIn: 0, actualUsage: 0 }); // it used to read as -5 usage
    });

    it("a movement stamped with a time on the closing day is in the closing balance and in its column", () => {
        const l = ledger([mv("TRANSFER_OUT", "OUT", 3, "2026-09-08T09:31:00Z")], "2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z");
        expect(l).toMatchObject({ opening: 0, closing: -3, transfersOut: 3, actualUsage: 0 });
    });
});
