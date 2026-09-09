import { Injectable } from "@nestjs/common";
import type { Kiosk, Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { UploadService } from "../../upload/upload.service.js";
import { InvoiceAiService } from "../../production-engine/invoice-ai.service.js";

type UploadedFile = { base64: string; mimeType: string; name: string };
type UploadedFileRef = { id: string; url: string; name: string; page: number };
type DeliveryInvoicePayload = {
    client_key: string;
    supplier_id: string;
    document_type: string;
    as_expected?: boolean;
    staff_invoice_number?: string;
    delivery_note?: string;
    files?: UploadedFile[];
    uploadedFiles?: UploadedFileRef[];
};

/**
 * Delivery Invoices — port of backend/forms/FormDeliveryInvoice.js. One
 * response = one supplier document; every page belongs to the same
 * delivery_header. Runs AI extraction inline (see InvoiceAiService)
 * before returning — draft invoice_line rows come from that, never
 * written directly here. Owner approval is still required before any
 * line or stock_movement becomes real.
 */
@Injectable()
export class DeliveryInvoiceProcessor implements SubmissionProcessor<DeliveryInvoicePayload> {
    readonly formType = "DELIVERY_INVOICE";
    readonly tables = [{ model: "delivery_header" }];

    constructor(
        private readonly upload: UploadService,
        private readonly invoiceAi: InvoiceAiService,
    ) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<DeliveryInvoicePayload>;
        if (!p.client_key) return { valid: false, message: "Missing form key — reload the page and try again." };
        if (!p.supplier_id) return { valid: false, message: "Select the supplier." };
        if (!p.document_type) return { valid: false, message: "Select the document type." };
        const files = p.files ?? [];
        if (!files.length) return { valid: false, message: "Upload at least one page/photo." };
        for (let i = 0; i < files.length; i++) {
            if (!files[i]!.base64) return { valid: false, message: `File ${i + 1}: upload didn't complete, try again.` };
        }
        return { valid: true };
    }

    buildKey(ctx: KeyContext<DeliveryInvoicePayload>): string {
        return `DELIVERY_INVOICE|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
    }

    async prepareIntake(payload: unknown, kiosk: Kiosk): Promise<DeliveryInvoicePayload> {
        const p = payload as DeliveryInvoicePayload;
        const uploadedFiles: UploadedFileRef[] = [];
        for (let i = 0; i < (p.files ?? []).length; i++) {
            const saved = await this.upload.save(p.files![i]!, kiosk.kiosk_id, "DELIVERY_INVOICE");
            uploadedFiles.push({ id: saved.url, url: saved.url, name: saved.name, page: i + 1 });
        }
        return { ...p, uploadedFiles, files: undefined };
    }

    /** Blocks the resubmit entirely once the owner has already acted — see
     * class doc. Runs before the generic per-table clear. */
    async clearExtra(tx: Prisma.TransactionClient, oldSubmissionIds: string[]): Promise<void> {
        const oldHeaders = await tx.deliveryHeader.findMany({ where: { submission_id: { in: oldSubmissionIds } } });
        const blocked = oldHeaders.find((h) => h.status !== "RECEIVED");
        if (blocked) {
            throw new Error("This delivery has already been reviewed by the owner — it can no longer be resubmitted. Contact the owner if a correction is needed.");
        }
        const oldHeaderIds = oldHeaders.map((h) => h.delivery_header_id);
        if (!oldHeaderIds.length) return;
        await tx.invoiceLine.deleteMany({ where: { delivery_header_id: { in: oldHeaderIds } } });
        await tx.deliveryFile.deleteMany({ where: { delivery_header_id: { in: oldHeaderIds } } });
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<DeliveryInvoicePayload>): Promise<string> {
        const p = ctx.payload;
        const supplier = await tx.supplier.findUnique({ where: { supplier_id: p.supplier_id } });

        const header = await tx.deliveryHeader.create({
            data: {
                submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                delivery_date: ctx.businessDate,
                supplier_id: supplier?.supplier_id ?? p.supplier_id,
                document_type: p.document_type,
                as_expected: p.as_expected === true,
                staff_invoice_number: String(p.staff_invoice_number ?? "").trim() || null,
                delivery_note: String(p.delivery_note ?? "").trim() || null,
                status: "RECEIVED",
            },
        });

        const fileRows = [];
        for (const f of p.uploadedFiles ?? []) {
            const row = await tx.deliveryFile.create({
                data: { delivery_header_id: header.delivery_header_id, drive_file_id: f.id, file_name: f.name, file_url: f.url, page_sequence: f.page, ai_status: "PENDING" },
            });
            fileRows.push(row);
        }

        const ai = await this.invoiceAi.runExtraction(tx, header.delivery_header_id, fileRows, supplier?.supplier_id ?? null);

        await tx.deliveryHeader.update({ where: { delivery_header_id: header.delivery_header_id }, data: { status: "IN_REVIEW" } });
        await tx.ownerAction.create({
            data: {
                source_submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                category: "INVOICE_REVIEW",
                title:
                    ai.ranOk && ai.lineCount > 0
                        ? `Invoice review: ${ai.lineCount} line(s) extracted, ready for review`
                        : ai.ranOk
                          ? "Invoice review: AI found no lines — manual entry needed"
                          : "Invoice review: AI extraction failed — manual entry needed",
                owner_note: ai.ranOk ? null : ai.errorSummary,
                status: "OPEN",
                priority: "NORMAL",
            },
        });

        return supplier ? "PROCESSED" : "PROCESSED_WITH_WARNING";
    }
}
