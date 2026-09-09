import { Injectable, NotFoundException } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

export type UploadedFileRef = { url: string; name: string };
export type ReadUpload = { buffer: Buffer; mimeType: string; name: string };

/**
 * Port of backend/core/Upload.js's saveUpload_ (base64 -> stored file ->
 * {id,url,name}). The old system stored to Google Drive; that's not
 * available here, so this is a **local-disk placeholder** — fine for dev,
 * NOT for production (files won't survive a redeploy/restart on most
 * hosts, and won't be served over HTTPS without extra setup). Needs a
 * real decision before go-live: S3, Cloudflare R2, or similar — swap the
 * implementation here, callers (forms) never change since they only see
 * this interface's shape.
 */
@Injectable()
export class UploadService {
    private readonly uploadDir = join(process.cwd(), "uploads");

    async save(file: { base64: string; mimeType: string; name: string }, kioskId: string, formType: string): Promise<UploadedFileRef> {
        await mkdir(this.uploadDir, { recursive: true });
        const id = `${formType}_${kioskId}_${Date.now()}_${randomUUID()}`;
        await writeFile(join(this.uploadDir, id), Buffer.from(file.base64, "base64"));
        // Sidecar metadata — mimeType/name preserved exactly, not guessed
        // back from a file extension when read() is called later (possibly
        // from a different process, e.g. the pipeline sweep).
        await writeFile(join(this.uploadDir, `${id}.json`), JSON.stringify({ mimeType: file.mimeType, name: file.name }));
        return { url: `/uploads/${id}`, name: file.name };
    }

    async read(url: string): Promise<ReadUpload> {
        const id = basename(url);
        try {
            const [buffer, metaRaw] = await Promise.all([
                readFile(join(this.uploadDir, id)),
                readFile(join(this.uploadDir, `${id}.json`), "utf8"),
            ]);
            const meta = JSON.parse(metaRaw) as { mimeType: string; name: string };
            return { buffer, mimeType: meta.mimeType, name: meta.name };
        } catch {
            throw new NotFoundException(`Uploaded file not found: ${url}`);
        }
    }
}
