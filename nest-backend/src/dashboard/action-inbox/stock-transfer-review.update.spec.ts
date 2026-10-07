import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { StockTransferReviewService } from "./stock-transfer-review.service.js";

function build(status: string) {
    const calls: unknown[] = [];
    const prisma = {
        stockTransfer: {
            findUnique: async () => ({ transfer_id: "T1", status, qty: 1, source_kiosk_id: "K01", destination_kiosk_id: "K02" }),
            update: async (a: unknown) => (calls.push(a), { transfer_id: "T1", qty: 2 }),
        },
    };
    return { svc: new StockTransferReviewService(prisma as never, {} as never, {} as never), calls };
}

describe("StockTransferReviewService.update", () => {
    it("edits a PENDING transfer's qty", async () => {
        const { svc, calls } = build("PENDING");
        await svc.update("T1", { qty: 2 });
        expect(calls).toEqual([{ where: { transfer_id: "T1" }, data: { qty: 2 } }]);
    });

    it("also edits an APPROVED-but-not-yet-applied transfer's qty — nothing real has posted yet", async () => {
        const { svc, calls } = build("APPROVED");
        await svc.update("T1", { qty: 2 });
        expect(calls).toEqual([{ where: { transfer_id: "T1" }, data: { qty: 2 } }]);
    });

    it("refuses once the transfer has been applied — a real stock movement already exists by then", async () => {
        const { svc } = build("APPLIED");
        await expect(svc.update("T1", { qty: 2 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses a rejected transfer", async () => {
        const { svc } = build("REJECTED");
        await expect(svc.update("T1", { qty: 2 })).rejects.toBeInstanceOf(BadRequestException);
    });
});
