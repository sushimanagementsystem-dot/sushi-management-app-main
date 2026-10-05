import { describe, it, expect, vi } from "vitest";
import { AuditLogService, type AuditSnapshot } from "./audit-log.service.js";

function build(entry: Record<string, unknown> | null) {
    const product = { create: vi.fn(async () => ({})) };
    const fridgeCount = { createMany: vi.fn(async () => ({ count: 0 })) };
    const auditLogUpdate = vi.fn(async () => ({}));
    const tx = { product, fridgeCount, auditLog: { update: auditLogUpdate } };
    const prisma = {
        auditLog: { findUnique: vi.fn(async () => entry), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ audit_log_id: "AUDIT123", ...data })) },
        $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const tableCache = { invalidate: vi.fn() };
    const svc = new AuditLogService(prisma as never, tableCache as never);
    return { svc, prisma, product, fridgeCount, auditLogUpdate, tableCache };
}

const snapshot: AuditSnapshot = {
    target: { table: "product", row: { product_id: "P190", name: "Benchwarmer" } },
    cascaded: [{ table: "fridge_count", rows: [{ fridge_count_id: "FC1", product_id: "P190" }, { fridge_count_id: "FC2", product_id: "P190" }] }],
};

describe("AuditLogService.record", () => {
    it("writes the snapshot through the given transaction client, not a fresh query", async () => {
        const { svc, prisma } = build(null);
        const tx = { auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ audit_log_id: "AUDIT999", ...data })) } };
        const id = await svc.record(tx as never, "product", "FORCE_DELETE", snapshot, "U1");
        expect(id).toBe("AUDIT999");
        expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { table_name: "product", action: "FORCE_DELETE", snapshot, performed_by: "U1" } });
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
});

describe("AuditLogService.undo", () => {
    it("recreates the target row and every cascaded row, then marks the entry undone", async () => {
        const { svc, product, fridgeCount, auditLogUpdate, tableCache } = build({ audit_log_id: "AUDIT123", snapshot, undone_at: null });
        await svc.undo("AUDIT123", "U2");
        expect(product.create).toHaveBeenCalledWith({ data: snapshot.target.row });
        expect(fridgeCount.createMany).toHaveBeenCalledWith({ data: snapshot.cascaded[0]!.rows });
        expect(auditLogUpdate).toHaveBeenCalledWith({ where: { audit_log_id: "AUDIT123" }, data: { undone_at: expect.any(Date), undone_by: "U2" } });
        expect(tableCache.invalidate).toHaveBeenCalledWith("product");
        expect(tableCache.invalidate).toHaveBeenCalledWith("fridge_count");
    });

    it("refuses to undo an entry that no longer exists", async () => {
        const { svc } = build(null);
        await expect(svc.undo("nope")).rejects.toThrow("Nothing to undo");
    });

    it("refuses to undo the same entry twice", async () => {
        const { svc, product } = build({ audit_log_id: "AUDIT123", snapshot, undone_at: new Date("2026-10-05T00:00:00Z") });
        await expect(svc.undo("AUDIT123")).rejects.toThrow("already undone");
        expect(product.create).not.toHaveBeenCalled();
    });

    it("skips createMany for a plain (non-cascading) delete's snapshot", async () => {
        const plain: AuditSnapshot = { target: { table: "product", row: { product_id: "P999" } }, cascaded: [] };
        const { svc, product, fridgeCount } = build({ audit_log_id: "A2", snapshot: plain, undone_at: null });
        await svc.undo("A2");
        expect(product.create).toHaveBeenCalledWith({ data: plain.target.row });
        expect(fridgeCount.createMany).not.toHaveBeenCalled();
    });
});
