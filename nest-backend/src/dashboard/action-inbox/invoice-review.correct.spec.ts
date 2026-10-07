import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { InvoiceReviewService } from "./invoice-review.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";

type Line = { invoice_line_id: string; status: string; stock_item_id: string | null; qty: number; unit_cost: number | null; delivery_header_id: string };

function build(opts: { line?: Partial<Line> } = {}) {
    const calls: string[] = [];
    const line: Line = {
        invoice_line_id: "L1",
        status: "APPROVED",
        stock_item_id: "STK008",
        qty: 1,
        unit_cost: 2,
        delivery_header_id: "H",
        ...opts.line,
    };
    const tx = {
        invoiceLine: { update: vi.fn(async (a: { data: { qty: number; unit_cost: number | null; line_total: number | null } }) => void calls.push(`line -> qty=${a.data.qty} cost=${a.data.unit_cost} total=${a.data.line_total}`)) },
        stockMovement: {
            create: vi.fn(async (a: { data: { movement_type: string; direction: string; qty: number } }) => void calls.push(`movement ${a.data.movement_type} ${a.data.direction} ${a.data.qty}`)),
        },
        ownerAction: { findFirst: async () => ({ owner_action_id: "OA" }) },
        activityLog: { create: vi.fn(async () => void calls.push("log")) },
    };
    const prisma = {
        invoiceLine: { findUnique: async () => line },
        deliveryHeader: { findUnique: async () => ({ delivery_header_id: "H", kiosk_id: "K1", submission_id: "S" }) },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const state = new OwnerActionStateService(prisma as never);
    return { svc: new InvoiceReviewService(prisma as never, state), calls };
}

describe("InvoiceReviewService.correctLine", () => {
    it("updates the line and posts an IN correction when the quantity goes up", async () => {
        const { svc, calls } = build({ line: { qty: 1, unit_cost: 2 } });
        const res = await svc.correctLine("L1", 3, 2, "owner");
        expect(res).toEqual({ movementPosted: true });
        expect(calls).toContain("line -> qty=3 cost=2 total=6");
        expect(calls).toContain("movement DELIVERY_CORRECTION IN 2");
    });

    it("posts an OUT correction when the quantity goes down, never touching the original DELIVERY_IN row", async () => {
        const { svc, calls } = build({ line: { qty: 5, unit_cost: 2 } });
        await svc.correctLine("L1", 2, 2, "owner");
        expect(calls).toContain("movement DELIVERY_CORRECTION OUT 3");
    });

    it("skips posting a movement when the quantity is unchanged (cost-only fix)", async () => {
        const { svc, calls } = build({ line: { qty: 2, unit_cost: 2 } });
        const res = await svc.correctLine("L1", 2, 5, "owner");
        expect(res).toEqual({ movementPosted: false });
        expect(calls.some((c) => c.startsWith("movement"))).toBe(false);
        expect(calls).toContain("line -> qty=2 cost=5 total=10");
    });

    it("refuses a line that was never approved", async () => {
        const { svc } = build({ line: { status: "DRAFT" } });
        await expect(svc.correctLine("L1", 3, 2, "owner")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses a line with no stock item (nothing was ever posted to correct)", async () => {
        const { svc } = build({ line: { stock_item_id: null } });
        await expect(svc.correctLine("L1", 3, 2, "owner")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses a zero or negative quantity", async () => {
        const { svc } = build();
        await expect(svc.correctLine("L1", 0, 2, "owner")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("logs the correction against the invoice's owner-action card", async () => {
        const { svc, calls } = build({ line: { qty: 1 } });
        await svc.correctLine("L1", 4, 2, "owner");
        expect(calls).toContain("log");
    });
});
