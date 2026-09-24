import { describe, it, expect } from "vitest";
import { StockVariancesService } from "./stock-variances.service.js";

type Move = { kiosk_id: string; stock_item_id: string; movement_type: string; direction: "IN" | "OUT"; qty: number; movement_date: Date; reference_id?: string | null };
const mv = (movement_type: string, direction: "IN" | "OUT", qty: number, at: string, reference_id: string | null = null): Move => ({ kiosk_id: "K1", stock_item_id: "S1", movement_type, direction, qty, movement_date: new Date(at), reference_id });

/** One kiosk, one item, one COMPLETE stocktake on 09-17 counting `counted`. */
function run(movements: Move[], counted: number, settings: Record<string, number> = {}) {
    const prisma = {
        stocktakeHeader: { findMany: async () => [{ stocktake_header_id: "H1", kiosk_id: "K1", stocktake_date: new Date("2026-09-17T00:00:00Z") }] },
        stocktakeLine: { findMany: async () => [{ stocktake_line_id: "L1", stocktake_header_id: "H1", stock_item_id: "S1", counted_qty: counted }] },
        stockMovement: { findMany: async () => movements },
    };
    const cache = {
        getAll: async (t: string) => (t === "kiosk" ? [{ kiosk_id: "K1", name: "One", active: true }] : [{ stock_item_id: "S1", name: "Chicken", count_unit: "BAG" }]),
    };
    const svc = new StockVariancesService(prisma as never, cache as never, { getNumber: async (k: string) => settings[k] ?? null } as never);
    return svc.bootstrap(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-30T00:00:00Z")) as Promise<{ variances: { expected: number; actual: number; difference: number }[] }>;
}

const opening = mv("STOCKTAKE_ADJUSTMENT", "IN", 20, "2026-09-10T00:00:00Z", "L0"); // last week's confirmed count: 20 on hand

describe("StockVariancesService", () => {
    it("expected = the ledger at the count day; the gap to the count is the variance", async () => {
        const { variances } = await run([opening, mv("TRANSFER_OUT", "OUT", 2, "2026-09-12T00:00:00Z"), mv("DELIVERY_IN", "IN", 4, "2026-09-13T00:00:00Z")], 6);
        expect(variances).toEqual([expect.objectContaining({ expected: 22, actual: 6, difference: -16 })]);
    });

    it("still reports the variance after the owner has confirmed the stocktake (its own correction is not part of 'expected')", async () => {
        const ownCorrection = mv("STOCKTAKE_ADJUSTMENT", "OUT", 16, "2026-09-17T00:00:00Z", "L1"); // posted by confirming this very stocktake
        const { variances } = await run([opening, mv("DELIVERY_IN", "IN", 2, "2026-09-12T00:00:00Z"), ownCorrection], 6);
        expect(variances).toEqual([expect.objectContaining({ expected: 22, actual: 6, difference: -16 })]);
    });

    it("but an earlier stocktake's correction does count as the starting point", async () => {
        const { variances } = await run([opening], 20);
        expect(variances).toEqual([]); // 20 expected, 20 counted
    });

    it("includes a movement stamped with a time on the count day, and ignores ones dated after it", async () => {
        const { variances } = await run([opening, mv("TRANSFER_IN", "IN", 10, "2026-09-17T09:31:00Z"), mv("DELIVERY_IN", "IN", 50, "2026-09-18T00:00:00Z")], 30);
        expect(variances).toEqual([]); // 20 + 10 = 30 expected
    });

    it("applies both thresholds: at least minUnits AND over pct of expected", async () => {
        // 30 expected, 26 counted: 4 units < 5 minimum.  30 vs 22: 8 units but 26.7% < 50%.  30 vs 12: 18 units and 60%.
        expect((await run([mv("DELIVERY_IN", "IN", 30, "2026-09-01T00:00:00Z")], 26)).variances).toEqual([]);
        expect((await run([mv("DELIVERY_IN", "IN", 30, "2026-09-01T00:00:00Z")], 22)).variances).toEqual([]);
        expect((await run([mv("DELIVERY_IN", "IN", 30, "2026-09-01T00:00:00Z")], 12)).variances).toHaveLength(1);
    });

    it("with nothing expected, the unit minimum alone decides", async () => {
        expect((await run([], 4)).variances).toEqual([]);
        expect((await run([], 5)).variances).toHaveLength(1);
    });

    it("reads the thresholds from settings", async () => {
        expect((await run([mv("DELIVERY_IN", "IN", 30, "2026-09-01T00:00:00Z")], 22, { STOCKTAKE_VARIANCE_PCT: 20, STOCKTAKE_VARIANCE_MIN_UNITS: 2 })).variances).toHaveLength(1);
    });
});
