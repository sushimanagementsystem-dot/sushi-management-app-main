import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { InvoiceReviewService } from "./invoice-review.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";

type Line = { invoice_line_id: string; status: string; stock_item_id?: string };

function build(opts: { status?: string; lines?: Line[]; laterStocktakes?: number; actionStatus?: string | null }) {
    const calls: string[] = [];
    const tx = {
        stockMovement: { deleteMany: vi.fn(async (a: { where: { reference_id: { in: string[] } } }) => (calls.push("delete movements " + a.where.reference_id.in.join(",")), { count: a.where.reference_id.in.length })) },
        invoiceLine: { updateMany: vi.fn(async () => void calls.push("lines -> DRAFT")) },
        deliveryHeader: { update: vi.fn(async (a: { data: { status: string } }) => void calls.push("header -> " + a.data.status)) },
        ownerAction: { update: vi.fn(async (a: { data: { status: string } }) => void calls.push("action -> " + a.data.status)), findFirst: async () => (opts.actionStatus === null ? null : { owner_action_id: "OA", status: opts.actionStatus ?? "RESOLVED" }) },
        activityLog: { create: vi.fn(async () => void calls.push("log")) },
    };
    const prisma = {
        deliveryHeader: { findUnique: async () => ({ delivery_header_id: "H", kiosk_id: "K1", submission_id: "S", status: opts.status ?? "REVIEWED", delivery_date: new Date("2026-09-24T00:00:00Z") }) },
        invoiceLine: { findMany: async () => opts.lines ?? [{ invoice_line_id: "L1", status: "APPROVED" }, { invoice_line_id: "L2", status: "APPROVED" }] },
        stockMovement: { count: async () => opts.laterStocktakes ?? 0 },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const state = new OwnerActionStateService(prisma as never);
    return { svc: new InvoiceReviewService(prisma as never, state), calls };
}

describe("InvoiceReviewService.undo", () => {
    it("removes the delivery movements, reopens the lines, the invoice and the card", async () => {
        const { svc, calls } = build({});
        expect(await svc.undo("H", "owner")).toEqual({ movementsRemoved: 2 });
        expect(calls).toEqual(expect.arrayContaining(["delete movements L1,L2", "lines -> DRAFT", "header -> IN_REVIEW", "action -> OPEN"]));
    });

    it("also undoes a decline (rejected lines, nothing to remove)", async () => {
        const { svc, calls } = build({ lines: [{ invoice_line_id: "L1", status: "REJECTED" }] });
        expect(await svc.undo("H", "owner")).toEqual({ movementsRemoved: 0 });
        expect(calls.some((c) => c.startsWith("delete movements"))).toBe(false);
        expect(calls).toContain("header -> IN_REVIEW");
    });

    it("refuses when the invoice was never confirmed or declined", async () => {
        await expect(build({ status: "IN_REVIEW" }).svc.undo("H", "owner")).rejects.toThrow(/nothing to undo/);
    });

    it("only counts a later stocktake that covers the same stock items", async () => {
        let asked: unknown;
        const { svc } = build({});
        (svc as unknown as { prisma: { stockMovement: { count: (a: unknown) => Promise<number> } } }).prisma.stockMovement.count = async (a) => ((asked = a), 0);
        await svc.undo("H", "owner");
        expect(JSON.stringify(asked)).toContain("stock_item_id");
    });

    it("refuses when a later stocktake was confirmed, and changes nothing", async () => {
        const { svc, calls } = build({ laterStocktakes: 3 });
        await expect(svc.undo("H", "owner")).rejects.toBeInstanceOf(BadRequestException);
        expect(calls).toEqual([]);
    });

    it("leaves a manually closed card alone", async () => {
        const { calls, svc } = build({ actionStatus: "CLOSED" });
        await svc.undo("H", "owner");
        expect(calls).not.toContain("action -> OPEN");
    });
});
