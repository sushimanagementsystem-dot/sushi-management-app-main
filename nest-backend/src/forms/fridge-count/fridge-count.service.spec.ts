import { describe, it, expect, vi } from "vitest";
import { FridgeCountService } from "./fridge-count.service.js";

function build(products: Record<string, unknown>[], pars: Record<string, unknown>[]) {
    const tableCache = {
        getAll: vi.fn(async (table: string) => {
            if (table === "product") return products;
            if (table === "production_par") return pars;
            return [];
        }),
    };
    const enumOptions = { getOptions: vi.fn(async () => []) };
    const prisma = { fridgeCount: { findMany: vi.fn(async () => []) } };
    return new FridgeCountService(prisma as never, enumOptions as never, tableCache as never);
}

const par = (product_id: string) => ({ kiosk_id: "K1", product_id });
const kiosk = { kiosk_id: "K1" } as never;

describe("FridgeCountService.getBootstrapData", () => {
    it("still asks staff to count a Retired product, since it stays on the morning fridge count", async () => {
        const svc = build([{ product_id: "P1", name: "Spicy Salmon Faves", active: true, production_role: "RETIRED", product_category_id: "PC1" }], [par("P1")]);
        const res = await svc.getBootstrapData(kiosk);
        expect(res.products).toEqual([expect.objectContaining({ id: "P1", name: "Spicy Salmon Faves" })]);
    });

    it("does not list an inactive product", async () => {
        const svc = build([{ product_id: "P2", name: "Old Item", active: false, production_role: "PRIMARY", product_category_id: "PC1" }], [par("P2")]);
        const res = await svc.getBootstrapData(kiosk);
        expect(res.products).toEqual([]);
    });
});
