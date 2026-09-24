import { Injectable, NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

export type UploadedFileRef = { url: string; name: string };
export type ReadUpload = { buffer: Buffer; mimeType: string; name: string };

/**
 * Port of backend/core/Upload.js's saveUpload_ (base64 -> stored file ->
 * {id,url,name}). The old system stored to Google Drive; here every upload
 * is kept in Postgres (`stored_file`), served back at `/uploads/<id>` by
 * UploadController. A database survives redeploys and restarts on any host,
 * which a local `uploads/` folder does not (a container's disk is thrown
 * away on every deploy). Callers only see this interface's shape, so the
 * storage can still be swapped for object storage later without touching them.
 *
 * Files written to disk by the earlier local-disk version are still served:
 * read() falls back to the `uploads/` folder when there is no database row.
 */
@Injectable()
export class UploadService {
    private readonly legacyDir = join(process.cwd(), "uploads");

    constructor(private readonly prisma: PrismaService) {}

    async save(file: { base64: string; mimeType: string; name: string }, kioskId: string, formType: string): Promise<UploadedFileRef> {
        const id = `${formType}_${kioskId}_${Date.now()}_${randomUUID()}`;
        const data = Buffer.from(file.base64, "base64");
        await this.prisma.storedFile.create({ data: { file_id: id, mime_type: file.mimeType, name: file.name, size_bytes: data.length, data } });
        return { url: `/uploads/${id}`, name: file.name };
    }

    async read(url: string): Promise<ReadUpload> {
        const id = basename(url);
        const row = await this.prisma.storedFile.findUnique({ where: { file_id: id } });
        if (row) return { buffer: Buffer.from(row.data), mimeType: row.mime_type, name: row.name ?? id };

        try {
            const [buffer, metaRaw] = await Promise.all([readFile(join(this.legacyDir, id)), readFile(join(this.legacyDir, `${id}.json`), "utf8")]);
            const meta = JSON.parse(metaRaw) as { mimeType: string; name: string };
            return { buffer, mimeType: meta.mimeType, name: meta.name };
        } catch {
            throw new NotFoundException(`Uploaded file not found: ${url}`);
        }
    }
}
