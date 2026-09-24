import { describe, it, expect, vi } from "vitest";
import { ActionInboxService } from "./action-inbox.service.js";

const row = (id: string, priority: string, created: string) => ({ owner_action_id: id, priority, status: "OPEN", category: "OTHER", kiosk_id: "K01", created_at: new Date(created) });

function build(rows: ReturnType<typeof row>[], existing?: Record<string, unknown>) {
    const findMany = vi.fn(async () => rows);
    const update = vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...existing, ...args.data }));
    const tx = { ownerAction: { update } };
    const prisma = {
        ownerAction: {
            findMany,
            groupBy: vi.fn(async () => []),
            count: vi.fn(async () => 0),
            findUnique: vi.fn(async () => existing ?? null),
        },
        $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const cache = { getAll: vi.fn(async () => []) };
    const state = { logActivity: vi.fn(async () => undefined) };
    const svc = new ActionInboxService(prisma as never, cache as never, state as never);
    return { svc, findMany, update, prisma, state };
}

describe("ActionInboxService.bootstrap", () => {
    it("shows urgent items first, and within a priority the newest first", async () => {
        const { svc } = build([
            row("old-normal", "NORMAL", "2026-09-01T10:00:00Z"),
            row("new-normal", "NORMAL", "2026-09-23T10:00:00Z"),
            row("old-urgent", "URGENT", "2026-09-02T10:00:00Z"),
            row("new-urgent", "URGENT", "2026-09-22T10:00:00Z"),
        ]);
        const res = await svc.bootstrap({});
        expect(res.rows.map((r) => r.owner_action_id)).toEqual(["new-urgent", "old-urgent", "new-normal", "old-normal"]);
    });

    it("turns the date range into a created_at window in the database query", async () => {
        const { svc, findMany } = build([]);
        await svc.bootstrap({ createdFrom: "2026-09-23T00:00:00.000Z", createdTo: "2026-09-24T00:00:00.000Z" });

        const where = (findMany.mock.calls[0] as unknown as [{ where: { created_at?: { gte?: Date; lt?: Date } } }])[0].where;
        expect(where.created_at?.gte?.toISOString()).toBe("2026-09-23T00:00:00.000Z");
        expect(where.created_at?.lt?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    });

    it("applies no date condition for 'All time'", async () => {
        const { svc, findMany } = build([]);
        await svc.bootstrap({});
        expect((findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where).not.toHaveProperty("created_at");
    });
});

describe("ActionInboxService.updateOwnerAction", () => {
    const existing = { owner_action_id: "A1", status: "OPEN", priority: "NORMAL", assigned_to: null, owner_note: null, due_date: new Date("2026-10-01T00:00:00Z") };

    it("saving with an empty Owner Note (never set) is a no-op, not an error", async () => {
        const { svc, prisma } = build([], existing);
        const res = await svc.updateOwnerAction("A1", { owner_note: "", assigned_to: "" }, "U1");

        expect(res.row).toBe(existing);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("clearing a due date stores null instead of an empty string Prisma would reject", async () => {
        const { svc, update } = build([], existing);
        await svc.updateOwnerAction("A1", { due_date: "" }, "U1");

        expect(update).toHaveBeenCalledWith({ where: { owner_action_id: "A1" }, data: { due_date: null } });
    });

    it("clearing a previously written note stores null and logs the change", async () => {
        const { svc, update, state } = build([], { ...existing, owner_note: "call the supplier" });
        await svc.updateOwnerAction("A1", { owner_note: "   " }, "U1");

        expect(update).toHaveBeenCalledWith({ where: { owner_action_id: "A1" }, data: { owner_note: null } });
        expect(state.logActivity).toHaveBeenCalledTimes(1);
    });
});
