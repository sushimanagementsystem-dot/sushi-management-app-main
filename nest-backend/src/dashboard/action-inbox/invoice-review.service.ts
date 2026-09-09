import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";

@Injectable()
export class InvoiceReviewService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly ownerActionState: OwnerActionStateService,
    ) {}

    /**
     * Add/edit a DRAFT invoice_line while its header is still IN_REVIEW —
     * lines may already exist as AI_EXTRACTED (from InvoiceAI.js) or start
     * from nothing if extraction failed/found none. Editing an
     * AI_EXTRACTED line reclassifies it OWNER_CORRECTED; a genuinely new
     * line is MANUAL_ENTRY.
     */
    async saveLine(deliveryHeaderId: string, isNew: boolean, line: Record<string, unknown>) {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Delivery not found.");
        if (header.status !== "IN_REVIEW") throw new BadRequestException("This invoice has already been reviewed.");
        const description = String(line.description_raw ?? "").trim();
        if (!description) throw new BadRequestException("Description is required.");

        let source = "MANUAL_ENTRY";
        let invoiceLineId: string = crypto.randomUUID();
        if (!isNew) {
            invoiceLineId = line.invoice_line_id as string;
            const existing = await this.prisma.invoiceLine.findUnique({ where: { invoice_line_id: invoiceLineId } });
            if (!existing) throw new NotFoundException("Line not found.");
            if (existing.status !== "DRAFT") throw new BadRequestException("Only draft lines can be edited.");
            source = existing.source === "AI_EXTRACTED" ? "OWNER_CORRECTED" : existing.source;
        }

        const clean = {
            invoice_line_id: invoiceLineId,
            delivery_header_id: deliveryHeaderId,
            stock_item_id: (line.stock_item_id as string) || null,
            supplier_item_code: (line.supplier_item_code as string) || null,
            description_raw: description,
            qty: line.qty !== undefined && line.qty !== "" ? Number(line.qty) : 0,
            unit_cost: line.unit_cost !== undefined && line.unit_cost !== "" ? Number(line.unit_cost) : null,
            line_total: line.line_total !== undefined && line.line_total !== "" ? Number(line.line_total) : null,
            source,
            status: "DRAFT",
            approved_at: null,
            approved_by: null,
        };
        if (isNew) {
            await this.prisma.invoiceLine.create({ data: clean });
        } else {
            await this.prisma.invoiceLine.update({ where: { invoice_line_id: invoiceLineId }, data: clean });
        }
        return { row: clean };
    }

    async deleteLine(invoiceLineId: string): Promise<void> {
        const line = await this.prisma.invoiceLine.findUnique({ where: { invoice_line_id: invoiceLineId } });
        if (!line) throw new NotFoundException("Line not found.");
        if (line.status !== "DRAFT") throw new BadRequestException("Only draft lines can be deleted.");
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: line.delivery_header_id } });
        if (!header || header.status !== "IN_REVIEW") throw new BadRequestException("This invoice has already been reviewed.");
        await this.prisma.invoiceLine.delete({ where: { invoice_line_id: invoiceLineId } });
    }

    /**
     * Whole-invoice Confirm: validates every remaining DRAFT line has
     * stock_item_id/qty>0/unit_cost>=0, then approves all of them together
     * and posts one DELIVERY_IN stock_movement per line.
     */
    async confirm(deliveryHeaderId: string, confirmedBy: string): Promise<void> {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Delivery not found.");
        if (header.status !== "IN_REVIEW") throw new BadRequestException("Already reviewed.");

        const lines = await this.prisma.invoiceLine.findMany({ where: { delivery_header_id: deliveryHeaderId, status: "DRAFT" } });
        if (!lines.length) throw new BadRequestException("No lines to confirm — add at least one, or Decline instead.");

        for (const l of lines) {
            if (!l.stock_item_id) throw new BadRequestException(`"${l.description_raw}" needs a stock item picked.`);
            const qty = Number(l.qty);
            if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException(`"${l.description_raw}" needs a quantity greater than 0.`);
            const unitCost = l.unit_cost === null ? NaN : Number(l.unit_cost);
            if (!Number.isFinite(unitCost) || unitCost < 0) throw new BadRequestException(`"${l.description_raw}" needs a unit cost.`);
        }

        await this.prisma.$transaction(async (tx) => {
            for (const l of lines) {
                const qty = Number(l.qty);
                const unitCost = Number(l.unit_cost);
                const lineTotal = l.line_total !== null ? Number(l.line_total) : Math.round(qty * unitCost * 100) / 100;
                await tx.invoiceLine.update({
                    where: { invoice_line_id: l.invoice_line_id },
                    data: { line_total: lineTotal, status: "APPROVED", approved_at: new Date(), approved_by: confirmedBy },
                });
                await tx.stockMovement.create({
                    data: {
                        kiosk_id: header.kiosk_id,
                        stock_item_id: l.stock_item_id as string,
                        movement_type: "DELIVERY_IN",
                        direction: "IN",
                        movement_date: header.delivery_date,
                        qty,
                        unit_cost: unitCost,
                        cost: lineTotal,
                        reference_id: l.invoice_line_id,
                    },
                });
            }

            await tx.deliveryHeader.update({ where: { delivery_header_id: deliveryHeaderId }, data: { status: "REVIEWED" } });

            const action = await this.ownerActionState.findOwnerAction(tx, header.submission_id, "INVOICE_REVIEW");
            if (action) {
                await this.ownerActionState.logActivity(tx, action.owner_action_id, confirmedBy, "delivery_header.status", "IN_REVIEW", "REVIEWED (confirmed)");
                await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: true, note: "invoice confirmed" });
            }
        });
    }

    /** Whole-invoice Decline: every remaining DRAFT line is REJECTED, nothing posted. */
    async decline(deliveryHeaderId: string, declinedBy: string): Promise<void> {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Delivery not found.");
        if (header.status !== "IN_REVIEW") throw new BadRequestException("Already reviewed.");

        await this.prisma.$transaction(async (tx) => {
            await tx.invoiceLine.updateMany({ where: { delivery_header_id: deliveryHeaderId, status: "DRAFT" }, data: { status: "REJECTED" } });
            await tx.deliveryHeader.update({ where: { delivery_header_id: deliveryHeaderId }, data: { status: "REVIEWED" } });

            const action = await this.ownerActionState.findOwnerAction(tx, header.submission_id, "INVOICE_REVIEW");
            if (action) {
                await this.ownerActionState.logActivity(tx, action.owner_action_id, declinedBy, "delivery_header.status", "IN_REVIEW", "REVIEWED (declined)");
                await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: true, note: "invoice declined" });
            }
        });
    }
}
