import { describe, it, expect, vi } from "vitest";
import { FoodWasteService } from "./food-waste.service.js";

function build(items: Partial<{ stock_item_id: string; name: string; stock_category_id: string; active: boolean; food_waste_eligible: boolean; ambient_duplicate_of: string | null; count_unit: string; measurement_type: string }>[]) {
    const settings = { get: vi.fn(async (key: string) => (key === "FOOD_WASTE_PACKAGING_CATEGORIES" ? "SC05" : key === "FOOD_WASTE_RICE_CATEGORIES" ? "SC09" : null)) };
    const tableCache = { getAll: vi.fn(async () => items) };
    const svc = new FoodWasteService(settings as never, tableCache as never);
    return { svc };
}

const base = { active: true, food_waste_eligible: true, ambient_duplicate_of: null, count_unit: "G", measurement_type: "WEIGHT_G" };

describe("FoodWasteService.getBootstrapData — three categories", () => {
    it("buckets a RICE-category item as RICE, not FOOD, even though it's tracked per-100g the same way FOOD per-100g items are", async () => {
        const { svc } = build([{ ...base, stock_item_id: "STK170", name: "Plain Rice", stock_category_id: "SC09" }]);
        const res = await svc.getBootstrapData({} as never);
        expect(res.items).toEqual([expect.objectContaining({ id: "STK170", cat: "RICE" })]);
    });

    it("buckets a packaging-category item as PACKAGING", async () => {
        const { svc } = build([{ ...base, stock_item_id: "STK101", name: "Blue Gloves M", stock_category_id: "SC05" }]);
        const res = await svc.getBootstrapData({} as never);
        expect(res.items).toEqual([expect.objectContaining({ id: "STK101", cat: "PACKAGING" })]);
    });

    it("falls back to FOOD for anything not in either list, including the regular per-100g food category", async () => {
        const { svc } = build([{ ...base, stock_item_id: "STK050", name: "Tuna", stock_category_id: "SC08" }]);
        const res = await svc.getBootstrapData({} as never);
        expect(res.items).toEqual([expect.objectContaining({ id: "STK050", cat: "FOOD" })]);
    });

    it("excludes an item with food_waste_eligible off, inactive, or an ambient-kiosk duplicate", async () => {
        const { svc } = build([
            { ...base, stock_item_id: "A", name: "A", stock_category_id: "SC04", food_waste_eligible: false },
            { ...base, stock_item_id: "B", name: "B", stock_category_id: "SC04", active: false },
            { ...base, stock_item_id: "C", name: "C", stock_category_id: "SC04", ambient_duplicate_of: "STK009" },
            { ...base, stock_item_id: "D", name: "D", stock_category_id: "SC04" },
        ]);
        const res = await svc.getBootstrapData({} as never);
        expect(res.items.map((i) => i.id)).toEqual(["D"]);
    });
});
