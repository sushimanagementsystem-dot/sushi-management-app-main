import { describe, it, expect, vi } from "vitest";
import { InvoicesListService } from "./invoices-list.service.js";

function build(opts: { header?: Record<string, unknown> | null; lineIds?: string[]; postedCount?: number; action?: Record<string, unknown> | null }) {
    const header = opts.header === undefined ? { delivery_header_id: "D1", submission_id: "S1" } : opts.header;
    const lineIds = opts.lineIds ?? ["L1"];
    const postedCount = opts.postedCount ?? 0;
    const action = opts.action === undefined ? { owner_action_id: "A1" } : opts.action;

    const deleted: string[] = [];
    const tx = {
        ownerAction: { findFirst: vi.fn(async () => action), delete: vi.fn(async ({ where }: { where: { owner_action_id: string } }) => void deleted.push("ownerAction:" + where.owner_action_id)) },
        activityLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        invoiceLine: { deleteMany: vi.fn(async () => void deleted.push("invoiceLine:" + header!.delivery_header_id)) },
        deliveryFile: { deleteMany: vi.fn(async () => void deleted.push("deliveryFile:" + header!.delivery_header_id)) },
        deliveryHeader: { delete: vi.fn(async ({ where }: { where: { delivery_header_id: string } }) => void deleted.push("deliveryHeader:" + where.delivery_header_id)) },
    };
    const prisma = {
        deliveryHeader: { findUnique: vi.fn(async () => header) },
        invoiceLine: { findMany: vi.fn(async () => lineIds.map((id) => ({ invoice_line_id: id }))) },
        stockMovement: { count: vi.fn(async () => postedCount) },
        $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    };
    const svc = new InvoicesListService(prisma as never, {} as never);
    return { svc, deleted, tx };
}

describe("InvoicesListService.deleteInvoice", () => {
    it("deletes the invoice, its lines/files, and the linked Action Inbox item", async () => {
        const { svc, deleted } = build({});
        await svc.deleteInvoice("D1");
        expect(deleted).toEqual(["ownerAction:A1", "invoiceLine:D1", "deliveryFile:D1", "deliveryHeader:D1"]);
    });

    it("refuses when a DELIVERY_IN stock movement was already posted from this invoice", async () => {
        const { svc } = build({ postedCount: 2 });
        await expect(svc.deleteInvoice("D1")).rejects.toThrow(/2 stock movement/);
    });

    it("still deletes a broken invoice with no linked owner_action (already reviewed/closed out)", async () => {
        const { svc, deleted } = build({ action: null });
        await svc.deleteInvoice("D1");
        expect(deleted).toEqual(["invoiceLine:D1", "deliveryFile:D1", "deliveryHeader:D1"]);
    });

    it("404s on an invoice that doesn't exist", async () => {
        const { svc } = build({ header: null });
        await expect(svc.deleteInvoice("nope")).rejects.toThrow("Invoice not found.");
    });
});
