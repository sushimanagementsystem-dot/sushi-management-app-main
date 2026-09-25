import { describe, it, expect } from "vitest";
import { ProductPricesService } from "./product-prices.service.js";

const CATEGORIES = [
    { value: "SC01", label: "KIOSK" },
    { value: "SC08", label: "Food Waste (per 100g)" },
];
const ITEMS = [
    { stock_item_id: "S1", name: "AVOCADO", stock_category_id: "SC01", count_unit: "EACH", current_unit_cost: "1.5", active: true },
    { stock_item_id: "FW1", name: "Avocado", stock_category_id: "SC08", count_unit: "100g", current_unit_cost: "0.75", active: true },
    { stock_item_id: "S2", name: "OLD ITEM", stock_category_id: "SC01", count_unit: "EACH", current_unit_cost: null, active: false },
];

function build() {
    const cache = { getAll: async () => ITEMS };
    const enums = { getOptions: async () => CATEGORIES };
    return { svc: new ProductPricesService(cache as never, enums as never) };
}

describe("ProductPricesService", () => {
    it("lists only the Stock Take items: active, and not in the Food Waste (per 100g) category", async () => {
        const { rows } = await build().svc.stockItemRows();
        expect(rows.map((r) => [r.stock_item_id, r.category_label])).toEqual([["S1", "KIOSK"]]);
    });

});
