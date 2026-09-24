import { describe, it, expect } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { UploadService } from "./upload.service.js";

function build() {
    const rows = new Map<string, { file_id: string; mime_type: string; name: string | null; size_bytes: number; data: Buffer }>();
    const prisma = {
        storedFile: {
            create: async ({ data }: { data: { file_id: string; mime_type: string; name: string | null; size_bytes: number; data: Buffer } }) => void rows.set(data.file_id, data),
            findUnique: async ({ where }: { where: { file_id: string } }) => rows.get(where.file_id) ?? null,
        },
    };
    return { svc: new UploadService(prisma as never), rows };
}

describe("UploadService (database storage)", () => {
    it("saves into the database and reads the same bytes, type and name back", async () => {
        const { svc, rows } = build();
        const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
        const ref = await svc.save({ base64: bytes.toString("base64"), mimeType: "image/jpeg", name: "invoice.jpg" }, "K03", "DELIVERY_INVOICE");

        expect(ref.url).toMatch(/^\/uploads\/DELIVERY_INVOICE_K03_\d+_/);
        expect([...rows.values()][0]!.size_bytes).toBe(bytes.length);
        const back = await svc.read(ref.url);
        expect(back.buffer.equals(bytes)).toBe(true);
        expect(back).toMatchObject({ mimeType: "image/jpeg", name: "invoice.jpg" });
    });

    it("accepts a bare id as well as the /uploads/ url", async () => {
        const { svc } = build();
        const ref = await svc.save({ base64: Buffer.from("x").toString("base64"), mimeType: "image/png", name: "a.png" }, "K01", "HELP_ISSUE");
        expect((await svc.read(ref.url.replace("/uploads/", ""))).mimeType).toBe("image/png");
    });

    it("says not found for a file that is neither in the database nor in the old uploads folder", async () => {
        await expect(build().svc.read("/uploads/nope_nope")).rejects.toBeInstanceOf(NotFoundException);
    });
});
