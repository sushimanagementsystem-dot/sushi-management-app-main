import { describe, it, expect, vi } from "vitest";
import { ProductionEngineService } from "./production-engine.service.js";

function build(products: Record<string, unknown>[], pars: Record<string, unknown>[]) {
    const tableCache = {
        getAll: vi.fn(async (table: string) => {
            if (table === "product") return products;
            if (table === "production_par") return pars;
            if (table === "component") return [];
            if (table === "recipe_component") return [];
            if (table === "defrost_item") return [];
            if (table === "defrost_par") return [];
            return [];
        }),
    };
    const settings = { get: vi.fn(async () => null), getNumber: vi.fn(async () => null) };
    const secondaryAllocation = {
        allocate: vi.fn(async (_tx: unknown, lines: unknown) => ({ lines, prawnKatsu: { prepRolls: 0, bags: 0, shortfallNote: null } })),
    };
    const svc = new ProductionEngineService(settings as never, secondaryAllocation as never, tableCache as never);
    return svc;
}

const kiosk = { kiosk_id: "K1" } as never;
const par = (product_id: string, monday: number) => ({ kiosk_id: "K1", product_id, MONDAY: monday, TUESDAY: 0, WEDNESDAY: 0, THURSDAY: 0, FRIDAY: 0, SATURDAY: 0, SUNDAY: 0 });

describe("ProductionEngineService.computeProductionPlan — Retired products", () => {
    it("excludes a product whose Production Role is Retired, even while still Active", async () => {
        const svc = build(
            [{ product_id: "P1", name: "Salmon Nigiri", active: true, production_role: "RETIRED" }],
            [par("P1", 5)],
        );
        const plan = await svc.computeProductionPlan({} as never, kiosk, new Date("2026-10-05T00:00:00Z"), {}, 0);
        expect(plan.lines).toEqual([]);
    });

    it("still includes an active, non-retired product with the same par setup", async () => {
        const svc = build(
            [{ product_id: "P2", name: "California Roll", active: true, production_role: "PRIMARY" }],
            [par("P2", 5)],
        );
        const plan = await svc.computeProductionPlan({} as never, kiosk, new Date("2026-10-05T00:00:00Z"), {}, 0);
        expect(plan.lines).toEqual([expect.objectContaining({ product_id: "P2", make: 5 })]);
    });
});
