import { describe, it, expect } from "vitest";
import { FoodWasteProcessor } from "./food-waste.processor.js";

type Ctx = { kiosk: { kiosk_id: string }; submission: { submission_id: string }; businessDate: Date; payload: { client_key: string; lines: { stock_item_id: string; amount: number; description?: string }[] } };

function build(items: Record<string, unknown>[]) {
    const byId = new Map(items.map((i) => [i.stock_item_id as string, i]));
    const movements: Record<string, unknown>[] = [];
    const tx = {
        stockItem: { findUnique: async ({ where }: { where: { stock_item_id: string } }) => byId.get(where.stock_item_id) ?? null },
        stockMovement: { create: async ({ data }: { data: Record<string, unknown> }) => void movements.push(data) },
    };
    const processor = new FoodWasteProcessor();
    return { processor, tx, movements };
}

function ctx(lines: Ctx["payload"]["lines"]): Ctx {
    return { kiosk: { kiosk_id: "K01" }, submission: { submission_id: "SUB1" }, businessDate: new Date("2026-10-14"), payload: { client_key: "k", lines } };
}

describe("FoodWasteProcessor — price-source lookup", () => {
    it("uses the item's own cost_per_100g when it has no price source", async () => {
        const { processor, tx, movements } = build([{ stock_item_id: "STK022", measurement_type: "WEIGHT_G", cost_per_100g: "3.5", current_unit_cost: "35", food_waste_price_source_id: null }]);
        await processor.process(tx as never, ctx([{ stock_item_id: "STK022", amount: 200 }]) as never);
        expect(movements[0]).toMatchObject({ unit_cost: "3.5", cost: 7 });
    });

    it("reads the rate from the linked real item instead of its own (null) cost_per_100g", async () => {
        const { processor, tx, movements } = build([
            { stock_item_id: "FW010", measurement_type: "WEIGHT_G", cost_per_100g: null, current_unit_cost: "0.75", food_waste_price_source_id: "STK009" },
            { stock_item_id: "STK009", measurement_type: "WEIGHT_G", cost_per_100g: "0.5833", current_unit_cost: "26.5", food_waste_price_source_id: null },
        ]);
        await processor.process(tx as never, ctx([{ stock_item_id: "FW010", amount: 100 }]) as never);
        expect(movements[0]).toMatchObject({ stock_item_id: "FW010", unit_cost: "0.5833", cost: 0.58 });
    });

    it("stays UNCOSTED when the linked price-source item has no cost_per_100g set", async () => {
        const { processor, tx, movements } = build([
            { stock_item_id: "FW099", measurement_type: "WEIGHT_G", cost_per_100g: null, current_unit_cost: "1", food_waste_price_source_id: "STK099" },
            { stock_item_id: "STK099", measurement_type: "WEIGHT_G", cost_per_100g: null, current_unit_cost: null, food_waste_price_source_id: null },
        ]);
        await processor.process(tx as never, ctx([{ stock_item_id: "FW099", amount: 50 }]) as never);
        expect(movements[0]).toMatchObject({ unit_cost: null, cost: null });
    });

    it("applies the price-source lookup for COUNT items too, via current_unit_cost", async () => {
        const { processor, tx, movements } = build([
            { stock_item_id: "FW200", measurement_type: "COUNT", cost_per_100g: null, current_unit_cost: "9", food_waste_price_source_id: "STK200" },
            { stock_item_id: "STK200", measurement_type: "COUNT", cost_per_100g: null, current_unit_cost: "2.5", food_waste_price_source_id: null },
        ]);
        await processor.process(tx as never, ctx([{ stock_item_id: "FW200", amount: 4 }]) as never);
        expect(movements[0]).toMatchObject({ unit_cost: "2.5", cost: 10 });
    });
});
