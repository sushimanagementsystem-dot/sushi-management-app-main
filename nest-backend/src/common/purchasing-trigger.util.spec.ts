import { describe, it, expect } from "vitest";
import { applyPackRounding, combinedStockBalance, computeItemTrigger, fixedOrderQtyOverride, stockCountDate } from "./purchasing-trigger.util.js";

const movement = (over: Record<string, unknown> = {}) => ({
    stock_item_id: "REAL",
    direction: "OUT",
    qty: 10,
    movement_type: "STOCKTAKE_ADJUSTMENT",
    movement_date: new Date("2026-01-01"),
    ...over,
}) as never;

const par = (over: Record<string, unknown> = {}) => ({ target_par: 20, minimum_stock: 10, safety_stock: 0, ...over }) as never;

describe("combinedStockBalance", () => {
    it("is the same as a single item's balance when there are no ambient duplicates", () => {
        const movements = [movement({ direction: "IN", qty: 50 }), movement({ direction: "OUT", qty: 20 })];
        expect(combinedStockBalance(["REAL"], movements)).toBe(30);
    });

    it("sums a real item's balance with every ambient duplicate's balance — Evan's 'counted in two locations' case", () => {
        // 30 units in the real item's own location, 12 more sitting at the kiosk counter (the ambient duplicate) —
        // the physical total is 42, which is what purchasing must compare against par, not just the 30.
        const movements = [
            movement({ stock_item_id: "REAL", direction: "IN", qty: 30 }),
            movement({ stock_item_id: "AMBIENT", direction: "IN", qty: 12 }),
        ];
        expect(combinedStockBalance(["REAL", "AMBIENT"], movements)).toBe(42);
    });

    it("ignores movements against ids not in the list", () => {
        const movements = [movement({ stock_item_id: "REAL", direction: "IN", qty: 30 }), movement({ stock_item_id: "OTHER_ITEM", direction: "IN", qty: 999 })];
        expect(combinedStockBalance(["REAL"], movements)).toBe(30);
    });
});

describe("computeItemTrigger", () => {
    it("SET_PAR when there is no par row at all", () => {
        expect(computeItemTrigger(["REAL"], null, []).flag).toBe("SET_PAR");
    });

    it("AWAIT_STOCKTAKE when neither the item nor any of its ambient duplicates has any movement history", () => {
        const trigger = computeItemTrigger(["REAL", "AMBIENT"], par(), [movement({ stock_item_id: "UNRELATED" })]);
        expect(trigger.flag).toBe("AWAIT_STOCKTAKE");
        expect(trigger.currentStock).toBeNull();
    });

    it("counts a movement on an ambient duplicate as history for the real item too", () => {
        const trigger = computeItemTrigger(["REAL", "AMBIENT"], par(), [movement({ stock_item_id: "AMBIENT", direction: "IN", qty: 5 })]);
        expect(trigger.flag).toBeNull();
        expect(trigger.currentStock).toBe(5);
    });

    it("triggers a shortfall using the combined (real + ambient) balance, not just the real item's own", () => {
        // Real item alone has 8 (below the minimum_stock=10 trigger point), but 12 more sit at the ambient
        // duplicate's location for a true total of 20 — right at target_par, so it must NOT trigger.
        const movements = [movement({ stock_item_id: "REAL", direction: "IN", qty: 8 }), movement({ stock_item_id: "AMBIENT", direction: "IN", qty: 12 })];
        const trigger = computeItemTrigger(["REAL", "AMBIENT"], par(), movements);
        expect(trigger.triggered).toBe(false);
        expect(trigger.currentStock).toBe(20);
    });

    it("still triggers when the combined balance is genuinely below the trigger point", () => {
        const movements = [movement({ stock_item_id: "REAL", direction: "IN", qty: 4 }), movement({ stock_item_id: "AMBIENT", direction: "IN", qty: 3 })];
        const trigger = computeItemTrigger(["REAL", "AMBIENT"], par(), movements);
        expect(trigger.triggered).toBe(true);
        expect(trigger.shortfall).toBe(13); // refill to target_par (20) - current (7)
    });
});

describe("stockCountDate", () => {
    it("is the latest STOCKTAKE_ADJUSTMENT date across the real item and every ambient duplicate", () => {
        const movements = [
            movement({ stock_item_id: "REAL", movement_date: new Date("2026-01-01") }),
            movement({ stock_item_id: "AMBIENT", movement_date: new Date("2026-01-15") }),
        ];
        expect(stockCountDate(["REAL", "AMBIENT"], movements)).toEqual(new Date("2026-01-15"));
    });

    it("null when neither has ever been counted", () => {
        expect(stockCountDate(["REAL", "AMBIENT"], [])).toBeNull();
    });
});

describe("fixedOrderQtyOverride", () => {
    it("null when the mapping has no fixed_order_qty", () => {
        expect(fixedOrderQtyOverride({ fixed_order_qty: null })).toBeNull();
    });

    it("null when the mapping is missing entirely", () => {
        expect(fixedOrderQtyOverride(null)).toBeNull();
        expect(fixedOrderQtyOverride(undefined)).toBeNull();
    });

    it("the fixed quantity when set — e.g. Castlebay's salmon mapping (4 boxes), not the supplier as a whole", () => {
        expect(fixedOrderQtyOverride({ fixed_order_qty: 4 })).toBe(4);
    });

    it("null for a non-positive value", () => {
        expect(fixedOrderQtyOverride({ fixed_order_qty: 0 })).toBeNull();
    });
});

describe("applyPackRounding (sanity check alongside the override — unaffected by this change)", () => {
    it("rounds a shortfall up to whole packs, then to the order multiple", () => {
        expect(applyPackRounding(13, 5, 1)).toBe(3); // ceil(13/5) = 3 packs
        expect(applyPackRounding(13, 5, 2)).toBe(4); // 3 packs rounded up to a multiple of 2
    });
});
