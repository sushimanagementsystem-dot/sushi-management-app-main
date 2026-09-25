import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { UploadService } from "../../upload/upload.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";

export type InvoiceFileUpload = { base64?: string; mimeType?: string; name?: string };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Owner-side, optional re-upload of one invoice page — for a page that is missing, corrupted or that the AI couldn't read.
 *
 * Nothing is ever overwritten or deleted: the old page's delivery_file row stays exactly as it was (same file, same url) apart
 * from being switched to is_active=false with when/who, and its stored file is untouched. The new image is uploaded FIRST; only
 * once that has succeeded (and is confirmed readable back) is a new delivery_file row linked and the old one retired, in one
 * transaction. If the upload or the link fails, the invoice, its lines and its current image are left exactly as they were.
 * No invoice header or line is created — this only adds a page version. AI is not re-run here; the owner chooses that afterwards
 * (rerun_invoice_ai), which only reads is_active pages.
 */
@Injectable()
export class InvoiceFileService {
    private readonly logger = new Logger(InvoiceFileService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly upload: UploadService,
        private readonly ownerActionState: OwnerActionStateService,
    ) {}

    async replace(deliveryHeaderId: string, deliveryFileId: string, file: InvoiceFileUpload, actorId: string) {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Delivery not found.");
        if (header.status !== "IN_REVIEW") throw new BadRequestException("This invoice has already been reviewed, so its image can't be replaced. Undo the review first if you need to.");

        const current = await this.prisma.deliveryFile.findUnique({ where: { delivery_file_id: deliveryFileId } });
        if (!current || current.delivery_header_id !== deliveryHeaderId) throw new NotFoundException("That image isn't part of this invoice.");
        if (!current.is_active) throw new BadRequestException("That image has already been replaced — refresh the invoice to see the current one.");

        if (!file?.base64) throw new BadRequestException("Choose an image or PDF to upload.");
        if (!file.mimeType || !ALLOWED_TYPES.includes(file.mimeType)) throw new BadRequestException("Only photos (JPEG, PNG, GIF, WebP) or PDF files can be used for an invoice.");
        if (Buffer.byteLength(file.base64, "base64") > MAX_BYTES) throw new BadRequestException("That file is too large (15 MB maximum).");

        // 1. Upload. A failure here has touched nothing.
        let uploaded: { url: string; name: string };
        try {
            uploaded = await this.upload.save({ base64: file.base64, mimeType: file.mimeType, name: file.name || "invoice", }, header.kiosk_id, "DELIVERY_INVOICE");
            const check = await this.upload.exists(uploaded.url);
            if (!check.exists) throw new Error("uploaded file could not be read back");
        } catch (err) {
            this.logger.warn(`Invoice re-upload failed for ${deliveryHeaderId}: ${err instanceof Error ? err.message : String(err)}`);
            throw new ServiceUnavailableException("The new image didn't upload, so nothing was changed — the invoice still uses its current image. Please try again.");
        }

        // 2. Only now link it: new page row + retire the old one + audit note, together.
        try {
            const action = header.submission_id ? await this.prisma.ownerAction.findFirst({ where: { source_submission_id: header.submission_id, category: "INVOICE_REVIEW" } }) : null;
            const created = await this.prisma.$transaction(
                async (tx) => {
                    const row = await tx.deliveryFile.create({
                        data: {
                            delivery_header_id: deliveryHeaderId,
                            drive_file_id: uploaded.url,
                            file_url: uploaded.url,
                            file_name: uploaded.name,
                            page_sequence: current.page_sequence,
                            ai_status: "PENDING",
                            is_active: true,
                            replaces_file_id: current.delivery_file_id,
                        },
                    });
                    await tx.deliveryFile.update({ where: { delivery_file_id: current.delivery_file_id }, data: { is_active: false, superseded_at: new Date(), superseded_by: actorId } });
                    if (action) {
                        await this.ownerActionState.logActivity(tx, action.owner_action_id, actorId, "delivery_file.image", current.file_url ?? current.drive_file_id, uploaded.url, `image re-uploaded (page ${current.page_sequence ?? "?"}); previous version kept`);
                    }
                    return row;
                },
                { timeout: 30_000 },
            );
            return { newFileId: created.delivery_file_id, url: uploaded.url, replacedFileId: current.delivery_file_id, aiRerunNeeded: true };
        } catch (err) {
            // Our own just-written upload is unreferenced — remove it. The old page and invoice were never touched.
            await this.upload.discard(uploaded.url).catch(() => undefined);
            this.logger.warn(`Invoice re-upload could not be linked for ${deliveryHeaderId}: ${err instanceof Error ? err.message : String(err)}`);
            throw new ServiceUnavailableException("The image uploaded but couldn't be attached, so nothing was changed. Please try again.");
        }
    }
}
