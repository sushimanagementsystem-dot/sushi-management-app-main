import { describe, it, expect } from "vitest";
import { ReportsService } from "./reports.service.js";

type Group = { kiosk_id: string; product_id: string; _sum: { planned_qty: number | null } };
function run(groups: Group[]) {
    let where: { business_date: { gte: Date; lt: Date } } | undefined;
    const prisma = { productionPlan: { groupBy: async (a: { where: typeof where }) => ((where = a.where), groups) } };
    const cache = {
        getAll: async (t: string) =>
            t === "kiosk"
                ? [{ kiosk_id: "K1", name: "One", active: true }, { kiosk_id: "K2", name: "Two", active: true }, { kiosk_id: "K3", name: "Three", active: false }]
                : [{ product_id: "A", name: "Avocado Roll" }, { product_id: "B", name: "Bento" }, { product_id: "C", name: "Bento" }],
    };
    const svc = new ReportsService(prisma as never, cache as never, {} as never);
    return svc.bootstrapProductionReport(new Date("2026-09-18T00:00:00Z"), new Date("2026-09-24T00:00:00Z")).then((res) => ({ res, where: where! }));
}
const g = (kiosk_id: string, product_id: string, qty: number | null): Group => ({ kiosk_id, product_id, _sum: { planned_qty: qty } });

describe("bootstrapProductionReport", () => {
    it("one row per product with a quantity for each kiosk, biggest total first", async () => {
        const { res } = await run([g("K1", "A", 10), g("K2", "A", 4), g("K1", "B", 20)]);
        expect(res.kiosks.map((k) => k.id)).toEqual(["K1", "K2"]);
        expect(res.products).toEqual([
            { productId: "B", productName: "Bento", byKiosk: { K1: 20 }, total: 20 },
            { productId: "A", productName: "Avocado Roll", byKiosk: { K1: 10, K2: 4 }, total: 14 },
        ]);
    });

    it("keeps two products that share a name apart, and drops zero quantities", async () => {
        const { res } = await run([g("K1", "B", 5), g("K1", "C", 7), g("K2", "A", 0), g("K2", "C", null)]);
        expect(res.products.map((p) => [p.productId, p.total])).toEqual([["C", 7], ["B", 5]]);
    });

    it("includes the whole last day: the query stops before the next midnight, not at the last day's midnight", async () => {
        const { where } = await run([]);
        expect(where.business_date.gte.toISOString()).toBe("2026-09-18T00:00:00.000Z");
        expect(where.business_date.lt.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    });
});
