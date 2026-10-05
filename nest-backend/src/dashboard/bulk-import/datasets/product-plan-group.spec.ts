import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { runBulk } from "../bulk-import.engine.js";
import { productPlanGroupDataset as ds } from "./product-plan-group.js";

const products = [
    { product_id: "P1", name: "Mixed Maki", brand_id: "YO", product_category_id: "PC03", plan_group: "Salmon" },
    { product_id: "P2", name: "California Roll", brand_id: "YO", product_category_id: "PC03", plan_group: "California" },
    { product_id: "P3", name: "Classic Platter", brand_id: "SUSHI_CIRCLE", product_category_id: "PC10", plan_group: "Sharers" },
];
const groupOptions = [
    { value: "Veggie", label: "Veggie", sort_order: 1 },
    { value: "Salmon", label: "Salmon", sort_order: 2 },
    { value: "California", label: "California", sort_order: 3 },
];

function build() {
    const db = {
        product: { findMany: vi.fn(async () => products) },
        brand: { findMany: vi.fn(async () => [{ brand_id: "YO", name: "YO!" }, { brand_id: "SUSHI_CIRCLE", name: "Sushi Circle" }]) },
        enumOption: { findMany: vi.fn(async ({ where }: { where: { enum_type: string } }) => (where.enum_type === "plan_group" ? groupOptions : [{ value: "PC03", label: "Rolls" }, { value: "PC10", label: "Sides" }])) },
        $executeRaw: vi.fn((_strings: unknown, ...values: unknown[]) => Promise.resolve(values[0] instanceof Array ? values[0].length : 0)) as unknown as (...args: unknown[]) => Promise<number>,
    };
    return db;
}

const sheet = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Brand", "Category", "Product", "Plan Group", "Product code"], ...rows]), "S");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

describe("productPlanGroupDataset", () => {
    it("matches by product code, and re-categorizes Mixed Maki into Veggie", async () => {
        const db = build();
        const ctx = await ds.load(db);
        const { preview } = runBulk(ds, ctx, sheet([["", "", "Mixed Maki", "Veggie", "P1"]]));
        expect(preview.rows[0]).toMatchObject({ status: "changed" });
        expect(preview.canApply).toBe(true);
    });

    it("rejects a Plan Group that doesn't exist, across either brand", async () => {
        const db = build();
        const ctx = await ds.load(db);
        const { preview } = runBulk(ds, ctx, sheet([["", "", "Classic Platter", "Veg", "P3"]])); // typo: "Veg" not "Veggie"
        expect(preview.rows[0]!.status).toBe("invalid");
        expect(preview.rows[0]!.message).toContain('"Veg" is not a Plan Group');
        expect(preview.canApply).toBe(false);
    });

    it("accepts a Plan Group regardless of typed case/spacing, and writes the canonical stored value", async () => {
        const db = build();
        const ctx = await ds.load(db);
        const { preview, changes } = runBulk(ds, ctx, sheet([["", "", "Classic Platter", " california ", "P3"]]));
        expect(preview.canApply).toBe(true);
        await ds.apply(db, changes, ctx);
        expect(db.$executeRaw).toHaveBeenCalledTimes(1);
        const args = (db.$executeRaw as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
        expect(args[1]).toEqual(["P3"]); // ids
        expect(args[2]).toEqual(["California"]); // resolved to the enum_option's own casing
    });

    it("leaves Plan Group alone when the cell is left blank", async () => {
        const db = build();
        const ctx = await ds.load(db);
        const { preview } = runBulk(ds, ctx, sheet([["", "", "California Roll", "", "P2"]]));
        expect(preview.rows[0]!.status).toBe("unchanged");
    });
});
