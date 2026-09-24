import { describe, it, expect } from "vitest";
import { KpiService } from "./kpi.service.js";

const row = (over: Record<string, unknown>) => ({ kiosk_id: "K1", movement_type: "EXPIRED_WASTE", movement_date: new Date("2026-09-20T00:00:00Z"), qty: 2, unit_cost: null, cost: null, product_id: "P1", ...over });

function stats(rows: unknown[], products: { product_id: string; current_unit_cost: number | null }[]) {
    const prisma = { productMovement: { findMany: async () => rows } };
    const cache = { getAll: async () => products };
    const svc = new KpiService(prisma as never, {} as never, cache as never, {} as never) as unknown as {
        computeProductMovementStats(k: string[], s: Date, e: Date): Promise<{ stats: Record<string, Record<string, { qty: number; cost: number; count: number; uncostedCount: number }>> }>;
    };
    return svc.computeProductMovementStats(["K1"], new Date("2026-09-18T00:00:00Z"), new Date("2026-09-24T00:00:00Z")).then((r) => r.stats.K1!.EXPIRED_WASTE!);
}

describe("waste cost", () => {
    it("uses the cost stored on the movement when there is one", async () => {
        expect(await stats([row({ cost: 3.5 })], [{ product_id: "P1", current_unit_cost: 9 }])).toMatchObject({ cost: 3.5, uncostedCount: 0 });
    });

    it("values a movement that was booked before its product had a cost at the product's cost now, instead of counting it as 0", async () => {
        expect(await stats([row({ qty: 3 })], [{ product_id: "P1", current_unit_cost: 1.5 }])).toMatchObject({ qty: 3, cost: 4.5, uncostedCount: 0 });
    });

    it("reports a movement as uncosted only when the product still has no cost", async () => {
        expect(await stats([row({})], [{ product_id: "P1", current_unit_cost: null }])).toMatchObject({ qty: 2, cost: 0, count: 1, uncostedCount: 1 });
    });
});
