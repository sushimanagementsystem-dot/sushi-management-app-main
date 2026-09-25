import { describe, it, expect, vi } from "vitest";
import { InvoiceFileService } from "./invoice-file.service.js";

const header = { delivery_header_id: "H1", kiosk_id: "K01", status: "IN_REVIEW", submission_id: "S1" };
const current = { delivery_file_id: "F1", delivery_header_id: "H1", drive_file_id: "/uploads/old", file_url: "/uploads/old", page_sequence: 1, is_active: true };
const okFile = { base64: "QUJD", mimeType: "image/jpeg", name: "new.jpg" };

function setup(over: { header?: unknown; file?: unknown; save?: () => Promise<unknown>; exists?: boolean; txFails?: boolean } = {}) {
    const calls: string[] = [];
    const tx = {
        deliveryFile: {
            create: vi.fn(async (a: { data: Record<string, unknown> }) => (calls.push("create"), { delivery_file_id: "F2", ...a.data })),
            update: vi.fn(async () => (calls.push("retire"), {})),
        },
    };
    const prisma = {
        deliveryHeader: { findUnique: vi.fn(async () => ("header" in over ? over.header : header)) },
        deliveryFile: { findUnique: vi.fn(async () => ("file" in over ? over.file : current)) },
        ownerAction: { findFirst: vi.fn(async () => ({ owner_action_id: "OA1" })) },
        $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
            if (over.txFails) throw new Error("db down");
            return fn(tx);
        }),
    };
    const upload = {
        save: vi.fn(over.save ?? (async () => (calls.push("upload"), { url: "/uploads/new", name: "new.jpg" }))),
        exists: vi.fn(async () => ({ exists: over.exists ?? true, createdAt: null, sizeBytes: 3 })),
        discard: vi.fn(async () => calls.push("discard")),
    };
    const state = { logActivity: vi.fn(async () => calls.push("log")) };
    const svc = new InvoiceFileService(prisma as never, upload as never, state as never);
    return { svc, prisma, upload, tx, state, calls };
}

describe("InvoiceFileService.replace", () => {
    it("uploads first, then links a NEW page row and retires (never deletes) the old one, without touching the invoice or its lines", async () => {
        const { svc, tx, calls } = setup();
        const out = await svc.replace("H1", "F1", okFile, "U1");
        expect(calls).toEqual(["upload", "create", "retire", "log"]);
        expect(tx.deliveryFile.create.mock.calls[0]![0].data).toMatchObject({ delivery_header_id: "H1", file_url: "/uploads/new", drive_file_id: "/uploads/new", page_sequence: 1, ai_status: "PENDING", is_active: true, replaces_file_id: "F1" });
        // the old row is only flagged — its file reference is not in the update, and nothing is deleted
        expect(tx.deliveryFile.update.mock.calls[0]![0]).toMatchObject({ where: { delivery_file_id: "F1" }, data: { is_active: false, superseded_by: "U1" } });
        expect(Object.keys(tx.deliveryFile.update.mock.calls[0]![0].data)).toEqual(["is_active", "superseded_at", "superseded_by"]);
        expect(out).toMatchObject({ newFileId: "F2", replacedFileId: "F1", aiRerunNeeded: true });
    });

    it("if the upload fails, nothing is linked, retired or logged", async () => {
        const { svc, prisma, calls } = setup({ save: async () => { throw new Error("storage down"); } });
        await expect(svc.replace("H1", "F1", okFile, "U1")).rejects.toThrow(/nothing was changed/);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });

    it("if the upload can't be read back, it is treated as failed and nothing is linked", async () => {
        const { svc, prisma } = setup({ exists: false });
        await expect(svc.replace("H1", "F1", okFile, "U1")).rejects.toThrow(/nothing was changed/);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("if linking fails after a good upload, the unreferenced new upload is discarded and the old page is untouched", async () => {
        const { svc, upload, tx } = setup({ txFails: true });
        await expect(svc.replace("H1", "F1", okFile, "U1")).rejects.toThrow(/nothing was changed/);
        expect(upload.discard).toHaveBeenCalledWith("/uploads/new");
        expect(tx.deliveryFile.update).not.toHaveBeenCalled();
    });

    it("refuses without touching storage: no file, wrong type, already-reviewed invoice, a page of another invoice, an already-replaced page", async () => {
        const a = setup();
        await expect(a.svc.replace("H1", "F1", {}, "U1")).rejects.toThrow(/Choose an image/);
        await expect(a.svc.replace("H1", "F1", { ...okFile, mimeType: "video/mp4" }, "U1")).rejects.toThrow(/Only photos/);
        const b = setup({ header: { ...header, status: "REVIEWED" } });
        await expect(b.svc.replace("H1", "F1", okFile, "U1")).rejects.toThrow(/already been reviewed/);
        const c = setup({ file: { ...current, delivery_header_id: "OTHER" } });
        await expect(c.svc.replace("H1", "F1", okFile, "U1")).rejects.toThrow(/isn't part of this invoice/);
        const d = setup({ file: { ...current, is_active: false } });
        await expect(d.svc.replace("H1", "F1", okFile, "U1")).rejects.toThrow(/already been replaced/);
        for (const x of [a, b, c, d]) expect(x.upload.save).not.toHaveBeenCalled();
    });
});
