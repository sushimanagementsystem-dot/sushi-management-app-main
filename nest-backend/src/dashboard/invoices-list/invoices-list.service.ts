import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays } from "../../common/date.util.js";
import type { Kiosk } from "@prisma/client";

const MAX_ROWS = 500;

/**
 * Every delivery invoice across kiosks, newest first — the owner's
 * browse/review view, separate from the Action Inbox (which only shows
 * whatever is still awaiting a decision). Filtered by kiosk and by
 * delivery date, capped so a long history can't make one call huge.
 */
@Injectable()
export class InvoicesListService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    async bootstrap(kioskId: string | undefined, from: Date | undefined, to: Date | undefined) {
        const kiosks = await this.tableCache.getAll<Kiosk>("kiosk");
        const kioskNameById = new Map(kiosks.map((k) => [k.kiosk_id, k.name]));

        const where: Record<string, unknown> = {};
        if (kioskId) where.kiosk_id = kioskId;
        if (from || to) {
            where.delivery_date = {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: addDays(to, 1) } : {}),
            };
        }

        const [headers, total] = await Promise.all([
            this.prisma.deliveryHeader.findMany({
                where,
                orderBy: { delivery_date: "desc" },
                take: MAX_ROWS,
                include: {
                    supplier: { select: { name: true } },
                    delivery_files: { where: { is_active: true }, orderBy: { page_sequence: "asc" } },
                    _count: { select: { invoice_lines: true } },
                },
            }),
            this.prisma.deliveryHeader.count({ where }),
        ]);

        return {
            totalRows: total,
            shownRows: headers.length,
            kiosks: kiosks.filter((k) => k.active).map((k) => ({ id: k.kiosk_id, name: k.name })),
            rows: headers.map((h) => ({
                deliveryHeaderId: h.delivery_header_id,
                kioskId: h.kiosk_id,
                kioskName: kioskNameById.get(h.kiosk_id) ?? h.kiosk_id,
                supplierName: h.supplier?.name ?? "",
                deliveryDate: h.delivery_date,
                documentType: h.document_type,
                status: h.status,
                staffInvoiceNumber: h.staff_invoice_number,
                lineCount: h._count.invoice_lines,
                files: h.delivery_files.map((f) => ({
                    deliveryFileId: f.delivery_file_id,
                    fileName: f.file_name,
                    fileUrl: f.file_url ?? f.drive_file_id ?? null,
                    pageSequence: f.page_sequence,
                    aiStatus: f.ai_status,
                    aiError: f.ai_error,
                })),
            })),
        };
    }

    async detail(deliveryHeaderId: string) {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Invoice not found.");

        const [lines, inboxAction] = await Promise.all([
            this.prisma.invoiceLine.findMany({ where: { delivery_header_id: deliveryHeaderId }, include: { stock_item: { select: { name: true } } } }),
            header.submission_id
                ? this.prisma.ownerAction.findFirst({ where: { source_submission_id: header.submission_id, category: "INVOICE_REVIEW" }, select: { owner_action_id: true } })
                : null,
        ]);

        const shown = lines.map((l) => {
            const lineTotal = l.line_total !== null ? Number(l.line_total) : l.unit_cost !== null ? Number(l.qty) * Number(l.unit_cost) : null;
            return {
                invoiceLineId: l.invoice_line_id,
                description: l.description_raw ?? "",
                stockItemName: l.stock_item?.name ?? "",
                qty: Number(l.qty),
                unitCost: l.unit_cost !== null ? Number(l.unit_cost) : null,
                lineTotal,
                status: l.status,
            };
        });
        const total = shown.filter((l) => l.status !== "DECLINED").reduce((sum, l) => sum + (l.lineTotal ?? 0), 0);

        return {
            status: header.status,
            inReview: header.status === "IN_REVIEW",
            inboxActionId: inboxAction?.owner_action_id ?? null,
            total,
            lines: shown,
        };
    }

    /**
     * Permanently removes an invoice that can never be reviewed — e.g. AI extraction failed because the uploaded
     * image itself is gone from storage, so there's nothing left to read, re-run, or confirm. Refuses to touch
     * anything that already posted real stock: a DELIVERY_IN stock_movement is the one durable effect Confirm has,
     * so its presence means this invoice is real history, not a dead draft, no matter what `status` currently says.
     */
    async deleteInvoice(deliveryHeaderId: string): Promise<void> {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Invoice not found.");

        const lineIds = (await this.prisma.invoiceLine.findMany({ where: { delivery_header_id: deliveryHeaderId }, select: { invoice_line_id: true } })).map(
            (l) => l.invoice_line_id,
        );
        const postedCount = lineIds.length
            ? await this.prisma.stockMovement.count({ where: { movement_type: "DELIVERY_IN", reference_id: { in: lineIds } } })
            : 0;
        if (postedCount > 0) {
            throw new BadRequestException(`Cannot delete: ${postedCount} stock movement(s) were already posted from this invoice. Undo the review first if it was confirmed by mistake.`);
        }

        await this.prisma.$transaction(async (tx) => {
            if (header.submission_id) {
                const action = await tx.ownerAction.findFirst({ where: { source_submission_id: header.submission_id, category: "INVOICE_REVIEW" } });
                if (action) {
                    await tx.activityLog.deleteMany({ where: { owner_action_id: action.owner_action_id } });
                    await tx.ownerAction.delete({ where: { owner_action_id: action.owner_action_id } });
                }
            }
            await tx.invoiceLine.deleteMany({ where: { delivery_header_id: deliveryHeaderId } });
            await tx.deliveryFile.deleteMany({ where: { delivery_header_id: deliveryHeaderId } });
            await tx.deliveryHeader.delete({ where: { delivery_header_id: deliveryHeaderId } });
        });
    }
}
