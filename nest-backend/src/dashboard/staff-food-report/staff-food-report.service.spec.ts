import { describe, it, expect } from "vitest";
import { StaffFoodReportService } from "./staff-food-report.service.js";

type Row = { kiosk_id: string; product_id: string; movement_date: Date; qty: number; cost: number | null; unit_cost: number | null };
const row = (kiosk_id: string, product_id: string, date: string, over: Partial<Row> = {}): Row => ({ kiosk_id, product_id, movement_date: new Date(`${date}T00:00:00Z`), qty: 1, cost: null, unit_cost: null, ...over });

function run(rows: Row[], start = "2026-09-01", end = "2026-09-30") {
    const prisma = { productMovement: { findMany: async () => rows } };
    const cache = {
        getAll: async (t: string) =>
            t === "kiosk"
                ? [{ kiosk_id: "K1", name: "One", active: true }, { kiosk_id: "K2", name: "Two", active: true }]
                : [{ product_id: "GYOZA", name: "Chicken Gyoza", current_unit_cost: null }, { product_id: "ROLL", name: "Veggie Roll", current_unit_cost: 1.25 }],
    };
    return new StaffFoodReportService(prisma as never, cache as never).bootstrap(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
}

describe("StaffFoodReportService", () => {
    it("prices never-costed rows at the product's cost, and reports units that still can't be priced", async () => {
        const res = await run([row("K1", "ROLL", "2026-09-10"), row("K1", "ROLL", "2026-09-11"), row("K1", "GYOZA", "2026-09-11")]);
        expect(res.grandTotal).toEqual({ qty: 3, cost: 2.5, uncostedQty: 1 });
        expect(res.kioskTotals.find((k) => k.kioskId === "K1")).toMatchObject({ qty: 3, cost: 2.5, uncostedQty: 1 });
    });

    it("uses a stored cost as it is", async () => {
        const res = await run([row("K1", "GYOZA", "2026-09-10", { cost: 4 })]);
        expect(res.grandTotal).toEqual({ qty: 1, cost: 4, uncostedQty: 0 });
    });

    it("breaks the products down per kiosk and combined, most taken first", async () => {
        const res = await run([row("K1", "ROLL", "2026-09-10"), row("K1", "ROLL", "2026-09-12"), row("K1", "GYOZA", "2026-09-11"), row("K2", "GYOZA", "2026-09-14"), row("K2", "GYOZA", "2026-09-15")]);
        expect(res.products.byKiosk.K1!.map((p) => [p.name, p.qty, p.cost, p.lastTaken])).toEqual([["Veggie Roll", 2, 2.5, "2026-09-12"], ["Chicken Gyoza", 1, 0, "2026-09-11"]]);
        expect(res.products.byKiosk.K2!.map((p) => [p.name, p.qty, p.uncostedQty])).toEqual([["Chicken Gyoza", 2, 2]]);
        expect(res.products.all.map((p) => [p.name, p.qty])).toEqual([["Chicken Gyoza", 3], ["Veggie Roll", 2]]);
    });

    it("the product rows add up to the kiosk totals", async () => {
        const res = await run([row("K1", "ROLL", "2026-09-10"), row("K1", "GYOZA", "2026-09-11", { cost: 2 }), row("K2", "ROLL", "2026-09-12")]);
        for (const k of res.kioskTotals) {
            const rows = res.products.byKiosk[k.kioskId]!;
            expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(k.qty);
            expect(Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100).toBe(k.cost);
        }
    });

    it("all time lists days from the first logged day, not from year 2000", async () => {
        const res = await run([row("K1", "ROLL", "2026-08-14")], "2000-01-01", "2026-09-24");
        expect(res.days.at(-1)!.date).toBe("2026-08-14");
        expect(res.days.length).toBe(42);
    });

    it("keeps the day-by-day list of a normal range as it was, empty days included", async () => {
        expect((await run([], "2026-09-01", "2026-09-30")).days).toHaveLength(30);
    });
});
