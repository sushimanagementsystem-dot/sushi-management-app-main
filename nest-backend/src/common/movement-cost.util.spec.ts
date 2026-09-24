import { describe, it, expect } from "vitest";
import { movementCost, productCostMap } from "./movement-cost.util.js";

const costs = productCostMap([
    { product_id: "A", current_unit_cost: "1.2574" },
    { product_id: "B", current_unit_cost: null },
]);
const row = (over: Record<string, unknown> = {}) => ({ cost: null, unit_cost: null, product_id: "A", ...over });

describe("movementCost", () => {
    it("uses the stored cost when there is one", () => expect(movementCost(row({ cost: "3.5" }), 2, costs)).toBe(3.5));
    it("prices a row that was never costed at the product's cost now", () => expect(movementCost(row(), 3, costs)).toBe(3.77));
    it("prefers the unit cost stored on the row over the product's current one", () => expect(movementCost(row({ unit_cost: 2 }), 3, costs)).toBe(6));
    it("is null, not zero, when nothing prices it", () => {
        expect(movementCost(row({ product_id: "B" }), 1, costs)).toBeNull();
        expect(movementCost(row({ product_id: "unknown" }), 1, costs)).toBeNull();
    });
    it("a stored cost of 0 stays 0", () => expect(movementCost(row({ cost: 0 }), 1, costs)).toBe(0));
});
