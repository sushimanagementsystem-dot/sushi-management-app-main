import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";
import { invoiceConfirmMessage, invoiceConfirmProblems } from "./invoice-confirm-problems.js";

/** Prisma's default interactive-transaction limit is 5 s. Every statement here is a round trip to a remote database
 * (~0.25 s each), so a 13-line invoice done line by line overran it and Confirm failed with "Something went wrong".
 * The statements are now batched; this is the safety margin on top. */
const TX_TIMEOUT_MS = 30_000;

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

        const problems = invoiceConfirmProblems(lines);
        if (problems.length) throw new BadRequestException(invoiceConfirmMessage(problems));

        // Everything that can be worked out is worked out here, so the transaction below is a handful of statements
        // (one createMany, one updateMany, plus one update per line that had no total) instead of two per line.
        const approvedAt = new Date();
        const priced = lines.map((l) => {
            const qty = Number(l.qty);
            const unitCost = Number(l.unit_cost);
            const lineTotal = l.line_total !== null ? Number(l.line_total) : Math.round(qty * unitCost * 100) / 100;
            return { line: l, qty, unitCost, lineTotal };
        });

        await this.prisma.$transaction(async (tx) => {
            await tx.invoiceLine.updateMany({
                where: { delivery_header_id: deliveryHeaderId, status: "DRAFT", invoice_line_id: { in: lines.map((l) => l.invoice_line_id) } },
                data: { status: "APPROVED", approved_at: approvedAt, approved_by: confirmedBy },
            });
            for (const p of priced.filter((p) => p.line.line_total === null)) {
                await tx.invoiceLine.update({ where: { invoice_line_id: p.line.invoice_line_id }, data: { line_total: p.lineTotal } });
            }
            await tx.stockMovement.createMany({
                data: priced.map((p) => ({
                    kiosk_id: header.kiosk_id,
                    stock_item_id: p.line.stock_item_id as string,
                    movement_type: "DELIVERY_IN",
                    direction: "IN",
                    movement_date: header.delivery_date,
                    qty: p.qty,
                    unit_cost: p.unitCost,
                    cost: p.lineTotal,
                    reference_id: p.line.invoice_line_id,
                })),
            });

            await tx.deliveryHeader.update({ where: { delivery_header_id: deliveryHeaderId }, data: { status: "REVIEWED" } });

            const action = await this.ownerActionState.findOwnerAction(tx, header.submission_id, "INVOICE_REVIEW");
            if (action) {
                await this.ownerActionState.logActivity(tx, action.owner_action_id, confirmedBy, "delivery_header.status", "IN_REVIEW", "REVIEWED (confirmed)");
                await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: true, note: "invoice confirmed" });
            }
        }, { timeout: TX_TIMEOUT_MS });
    }

    /**
     * Undoes a Confirm or a Decline: the invoice goes back to IN_REVIEW with all its lines DRAFT again, the DELIVERY_IN
     * stock movements the confirm posted are removed, and the Action Inbox card is reopened — exactly the state before the click.
     *
     * Works from any device, however long ago the invoice was confirmed — it acts on what is stored, not on a session.
     * Refused only when a stocktake has been confirmed since the delivery for one of the SAME stock items at this
     * kiosk: that stocktake's correcting adjustment was computed with these movements in the ledger, so removing them
     * now would throw its count off. Anything else (later deliveries, transfers, waste) is untouched by an undo.
     */
    async undo(deliveryHeaderId: string, undoneBy: string): Promise<{ movementsRemoved: number }> {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Delivery not found.");
        if (header.status !== "REVIEWED") throw new BadRequestException("This invoice has not been confirmed or declined, so there is nothing to undo.");

        const lines = await this.prisma.invoiceLine.findMany({ where: { delivery_header_id: deliveryHeaderId, status: { in: ["APPROVED", "REJECTED"] } } });
        const approved = lines.filter((l) => l.status === "APPROVED");
        const approvedIds = approved.map((l) => l.invoice_line_id);

        if (approvedIds.length) {
            const laterCount = await this.prisma.stockMovement.count({
                where: {
                    kiosk_id: header.kiosk_id,
                    movement_type: "STOCKTAKE_ADJUSTMENT",
                    movement_date: { gte: header.delivery_date },
                    stock_item_id: { in: approved.map((l) => l.stock_item_id).filter((id): id is string => !!id) },
                },
            });
            if (laterCount > 0) {
                throw new BadRequestException(
                    "A stocktake that includes some of these items has been confirmed at this kiosk since this delivery, so the stock movements can't be removed without throwing that stocktake's count off. " +
                        "Leave it as it is, or add a correcting line on a new invoice instead.",
                );
            }
        }

        return this.prisma.$transaction(async (tx) => {
            const removed = approvedIds.length ? await tx.stockMovement.deleteMany({ where: { movement_type: "DELIVERY_IN", reference_id: { in: approvedIds } } }) : { count: 0 };
            await tx.invoiceLine.updateMany({ where: { delivery_header_id: deliveryHeaderId, status: { in: ["APPROVED", "REJECTED"] } }, data: { status: "DRAFT", approved_at: null, approved_by: null } });
            await tx.deliveryHeader.update({ where: { delivery_header_id: deliveryHeaderId }, data: { status: "IN_REVIEW" } });

            const action = await this.ownerActionState.findOwnerAction(tx, header.submission_id, "INVOICE_REVIEW");
            if (action) {
                await this.ownerActionState.logActivity(tx, action.owner_action_id, undoneBy, "delivery_header.status", "REVIEWED", "IN_REVIEW (undone)");
                if (action.status === "RESOLVED") {
                    await tx.ownerAction.update({ where: { owner_action_id: action.owner_action_id }, data: { status: "OPEN", resolved_at: null } });
                    await this.ownerActionState.logActivity(tx, action.owner_action_id, undoneBy, "status", action.status, "OPEN", "invoice review undone");
                }
            }
            return { movementsRemoved: removed.count };
        }, { timeout: TX_TIMEOUT_MS });
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
        }, { timeout: TX_TIMEOUT_MS });
    }
}
