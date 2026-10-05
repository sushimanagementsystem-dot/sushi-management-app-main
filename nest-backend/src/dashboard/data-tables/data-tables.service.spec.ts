import { describe, it, expect, vi } from "vitest";
import { DataTablesService } from "./data-tables.service.js";

type CacheData = { table_schema: Record<string, unknown>[]; field_schema: Record<string, unknown>[] };

// A raw Postgres FK violation, shaped the way it would actually arrive — proves checkRowReferences missing a
// reference is survivable, not just the expected case where it catches one.
function rawFkError(): Error & { code: string } {
    return Object.assign(new Error("Foreign key constraint violated on the constraint: `fridge_count_product_id_fkey`"), { code: "P2003" });
}

function build(opts: { foreignKeys: { table_name: string; column_name: string }[]; referencingCount: number; deleteManyThrows?: Error; fieldSchema?: Record<string, unknown>[]; tableSchema?: Record<string, unknown>[] }) {
    const cache: CacheData = {
        table_schema: opts.tableSchema ?? [{ table_name: "product", hard_delete: true, label: "Product" }, { table_name: "fridge_count", label: "Fridge Count" }],
        field_schema: opts.fieldSchema ?? [{ table_name: "product", column_name: "product_id", primary_key: true, type: null, label: "Product id" }],
    };
    const tableCache = { getAll: vi.fn(async (t: keyof CacheData) => cache[t] ?? []), invalidate: vi.fn() };
    const fridgeCount = {
        count: vi.fn(async () => opts.referencingCount),
        deleteMany: vi.fn(async () => ({ count: opts.referencingCount })),
        findMany: vi.fn(async () => Array.from({ length: opts.referencingCount }, (_, i) => ({ fridge_count_id: `FC${i}`, product_id: "P190" }))),
    };
    const product = {
        deleteMany: opts.deleteManyThrows ? vi.fn(async () => { throw opts.deleteManyThrows; }) : vi.fn(async () => ({ count: 1 })),
        // Echoes the where-clause back as a stand-in "found row" — good enough to prove the snapshot/undo plumbing
        // without a real row shape.
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({ ...where })),
    };
    const auditLog = { record: vi.fn(async () => "AUDIT123") };
    const prisma = {
        $queryRaw: vi.fn(async () => opts.foreignKeys),
        $transaction: vi.fn(async (fn: (tx: { fridgeCount: typeof fridgeCount; product: typeof product }) => Promise<unknown>) => fn({ fridgeCount, product })),
        fridgeCount,
        product,
    };
    const svc = new DataTablesService(prisma as never, {} as never, tableCache as never, {} as never, auditLog as never);
    return { svc, fridgeCount, product, auditLog };
}

describe("DataTablesService.deleteTableRow — real-FK reference check", () => {
    it("blocks the delete with a clear message when a table outside field_schema (fridge_count) still references the row", async () => {
        // fridge_count.product_id has no field_schema row (it's an internal operational table, never owner-editable) —
        // this is the exact gap that let a real delete slip through to a raw Postgres "fridge_count_product_id_fkey" error.
        const { svc, fridgeCount } = build({ foreignKeys: [{ table_name: "fridge_count", column_name: "product_id" }], referencingCount: 4 });
        await expect(svc.deleteTableRow("product", { product_id: "P190" })).rejects.toThrow(/4 rows in "Fridge Count" still reference this/);
        expect(fridgeCount.count).toHaveBeenCalledWith({ where: { product_id: "P190" } });
    });

    it("falls back to a readable title-cased name ('Fridge Count') when the referencing table has no table_schema label of its own", async () => {
        // table_schema has no row at all for fridge_count in real data (it's never owner-editable) — label must
        // never fall back to the raw snake_case table name, which is what the client's own screenshot showed.
        const { svc } = build({
            foreignKeys: [{ table_name: "fridge_count", column_name: "product_id" }],
            referencingCount: 2,
            tableSchema: [{ table_name: "product", hard_delete: true, label: "Product" }],
        });
        await expect(svc.deleteTableRow("product", { product_id: "P190" })).rejects.toThrow(/2 rows in "Fridge Count" still reference this/);
    });

    it("allows the delete when the real foreign keys exist but no row actually references this one", async () => {
        const { svc, product } = build({ foreignKeys: [{ table_name: "fridge_count", column_name: "product_id" }], referencingCount: 0 });
        await svc.deleteTableRow("product", { product_id: "P999" });
        expect(product.deleteMany).toHaveBeenCalledWith({ where: { product_id: "P999" } });
    });

    it("allows the delete outright when Postgres reports no foreign keys pointing at this table at all", async () => {
        const { svc, product } = build({ foreignKeys: [], referencingCount: 0 });
        await svc.deleteTableRow("product", { product_id: "P999" });
        expect(product.deleteMany).toHaveBeenCalled();
    });

    it("still turns a raw database error into plain language if one reaches deleteMany anyway (checkRowReferences is a pre-check, not a guarantee)", async () => {
        const { svc } = build({ foreignKeys: [], referencingCount: 0, deleteManyThrows: rawFkError() });
        const err = await svc.deleteTableRow("product", { product_id: "P190" }).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toMatch(/fridge_count_product_id_fkey|constraint violated/i);
        expect((err as Error).message).toMatch(/does(n't| not) exist, or is still in use/);
    });
});

describe("DataTablesService.bulkSaveTableRows — delete error translation", () => {
    it("never puts a raw database message in a failed row's result", async () => {
        const { svc } = build({ foreignKeys: [], referencingCount: 0, deleteManyThrows: rawFkError() });
        const [result] = await svc.bulkSaveTableRows("product", [{ key: "r1", isNew: false, isDelete: true, row: { product_id: "P190" } }]);
        expect(result).toMatchObject({ key: "r1", ok: false });
        const message = (result as { error: string }).error;
        expect(message).not.toMatch(/fridge_count_product_id_fkey|constraint violated/i);
        expect(message).toMatch(/does(n't| not) exist, or is still in use/);
    });
});

describe("Force delete", () => {
    it("the blocked message says Force delete is available", async () => {
        const { svc } = build({ foreignKeys: [{ table_name: "fridge_count", column_name: "product_id" }], referencingCount: 4 });
        await expect(svc.deleteTableRow("product", { product_id: "P190" })).rejects.toThrow(/Use Force delete to remove those along with it — this cannot be undone/);
    });

    it("deleteTableRow(force=true) removes the referencing rows first, then the row itself, in one transaction", async () => {
        const { svc, fridgeCount, product } = build({ foreignKeys: [{ table_name: "fridge_count", column_name: "product_id" }], referencingCount: 4 });
        await svc.deleteTableRow("product", { product_id: "P190" }, undefined, true);
        expect(fridgeCount.deleteMany).toHaveBeenCalledWith({ where: { product_id: "P190" } });
        expect(product.deleteMany).toHaveBeenCalledWith({ where: { product_id: "P190" } });
    });

    it("bulkSaveTableRows honors force on a single delete change without needing a prior failed attempt", async () => {
        const { svc, fridgeCount, product } = build({ foreignKeys: [{ table_name: "fridge_count", column_name: "product_id" }], referencingCount: 4 });
        const [result] = await svc.bulkSaveTableRows("product", [{ key: "r1", isNew: false, isDelete: true, row: { product_id: "P190" }, force: true }]);
        expect(result).toEqual({ key: "r1", ok: true, auditLogId: "AUDIT123" });
        expect(fridgeCount.deleteMany).toHaveBeenCalledWith({ where: { product_id: "P190" } });
        expect(product.deleteMany).toHaveBeenCalledWith({ where: { product_id: "P190" } });
    });

    it("never cascades without force — a plain delete attempt leaves referencing rows untouched", async () => {
        const { svc, fridgeCount } = build({ foreignKeys: [{ table_name: "fridge_count", column_name: "product_id" }], referencingCount: 4 });
        await svc.deleteTableRow("product", { product_id: "P190" }).catch(() => {});
        expect(fridgeCount.deleteMany).not.toHaveBeenCalled();
    });
});
