import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";
import type { Prisma, StockItem } from "@prisma/client";

export type BatchResult = { id: string; ok: true } | { id: string; ok: false; error: string };

@Injectable()
export class StockTransferReviewService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly ownerActionState: OwnerActionStateService,
    ) {}

    /** Edit source/destination kiosk, qty, or note on a stock_transfer
     * while still PENDING. */
    async update(transferId: string, changes: Record<string, unknown>) {
        const existing = await this.prisma.stockTransfer.findUnique({ where: { transfer_id: transferId } });
        if (!existing) throw new NotFoundException("Transfer not found.");
        if (existing.status !== "PENDING") throw new BadRequestException("Only pending transfers can be edited.");

        const editable = ["source_kiosk_id", "destination_kiosk_id", "qty", "note"] as const;
        const patch: Record<string, unknown> = {};
        for (const f of editable) if (f in changes) patch[f] = changes[f];

        const updated = await this.prisma.stockTransfer.update({ where: { transfer_id: transferId }, data: patch });
        return { row: updated };
    }

    /**
     * Approves every PENDING line of a submission in one call. Blocks a
     * line unless both kiosks are already assigned, so every APPROVED row
     * is guaranteed complete by the time apply runs.
     */
    async approve(transferIds: string[], actorId: string): Promise<BatchResult[]> {
        return this.decideMany(transferIds, actorId, "APPROVED", (t) => {
            if (!t.source_kiosk_id || !t.destination_kiosk_id) return "Assign both source and destination kiosks before approving.";
            return null;
        });
    }

    async decline(transferIds: string[], actorId: string): Promise<BatchResult[]> {
        return this.decideMany(transferIds, actorId, "REJECTED", () => null);
    }

    private async decideMany(transferIds: string[], actorId: string, newStatus: "APPROVED" | "REJECTED", validate: (t: { source_kiosk_id: string | null; destination_kiosk_id: string | null }) => string | null): Promise<BatchResult[]> {
        const results: BatchResult[] = [];
        let submissionId: string | null = null;

        await this.prisma.$transaction(async (tx) => {
            for (const id of transferIds) {
                const existing = await tx.stockTransfer.findUnique({ where: { transfer_id: id } });
                if (!existing) {
                    results.push({ id, ok: false, error: "Transfer not found." });
                    continue;
                }
                if (existing.status !== "PENDING") {
                    results.push({ id, ok: false, error: `Only pending transfers can be ${newStatus === "APPROVED" ? "approved" : "declined"}.` });
                    continue;
                }
                const validationError = validate(existing);
                if (validationError) {
                    results.push({ id, ok: false, error: validationError });
                    continue;
                }
                await tx.stockTransfer.update({ where: { transfer_id: id }, data: { status: newStatus } });
                submissionId = existing.submission_id;
                results.push({ id, ok: true });
            }
            if (submissionId) await this.resolveTransferApprovalIfDone(tx, submissionId, actorId);
        });

        return results;
    }

    /**
     * Applies one or more APPROVED transfers: posts the balanced OUT
     * (source) + IN (destination) stock_movement pair for each, sharing
     * transfer_id/reference_id, then flips status to APPLIED.
     */
    async apply(transferIds: string[], appliedBy: string): Promise<BatchResult[]> {
        // Fetched once, outside the transaction — matches the old backend's
        // getRows(TABLES.STOCK_ITEM) done before the loop, and keeps this
        // transaction's own work down to what it actually needs to hold
        // locks for. A per-transfer findUnique inside the transaction here
        // previously pushed a 2-transfer apply past Prisma's 5s interactive
        // transaction timeout under any connection contention.
        const itemById = new Map((await this.tableCache.getAll<StockItem>("stock_item")).map((i) => [i.stock_item_id, i]));
        const results: BatchResult[] = [];
        let submissionId: string | null = null;

        await this.prisma.$transaction(async (tx) => {
            for (const id of transferIds) {
                const t = await tx.stockTransfer.findUnique({ where: { transfer_id: id } });
                if (!t) {
                    results.push({ id, ok: false, error: "Not found." });
                    continue;
                }
                if (t.status !== "APPROVED") {
                    results.push({ id, ok: false, error: "Not approved." });
                    continue;
                }
                if (!t.source_kiosk_id || !t.destination_kiosk_id) {
                    results.push({ id, ok: false, error: "Missing kiosk assignment." });
                    continue;
                }
                submissionId = t.submission_id;
                const item = itemById.get(t.stock_item_id);
                const unitCost = item?.current_unit_cost ?? null;
                const qty = Number(t.qty);
                const cost = unitCost === null ? null : Math.round(qty * Number(unitCost) * 100) / 100;
                const movementDate = new Date();

                await tx.stockMovement.create({
                    data: {
                        kiosk_id: t.source_kiosk_id,
                        stock_item_id: t.stock_item_id,
                        movement_type: "TRANSFER_OUT",
                        direction: "OUT",
                        movement_date: movementDate,
                        qty,
                        unit_cost: unitCost,
                        cost,
                        transfer_id: t.transfer_id,
                        reference_id: t.transfer_id,
                    },
                });
                await tx.stockMovement.create({
                    data: {
                        kiosk_id: t.destination_kiosk_id,
                        stock_item_id: t.stock_item_id,
                        movement_type: "TRANSFER_IN",
                        direction: "IN",
                        movement_date: movementDate,
                        qty,
                        unit_cost: unitCost,
                        cost,
                        transfer_id: t.transfer_id,
                        reference_id: t.transfer_id,
                    },
                });
                await tx.stockTransfer.update({ where: { transfer_id: id }, data: { status: "APPLIED" } });
                results.push({ id, ok: true });
            }

            if (submissionId) {
                const action = await this.ownerActionState.findOwnerAction(tx, submissionId, "TRANSFER_APPLY");
                if (action) {
                    await this.ownerActionState.logActivity(tx, action.owner_action_id, appliedBy, "stock_transfer.status", "APPROVED", "APPLIED");
                    const siblings = await tx.stockTransfer.findMany({ where: { submission_id: submissionId } });
                    const allDone = siblings.every((t) => t.status === "APPLIED" || t.status === "REJECTED");
                    await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: allDone, note: "all approved transfers applied" });
                }
            }
        });

        return results;
    }

    /** Called after every approve/decline. Fires the TRANSFER_APPROVAL
     * action's IN_PROGRESS/RESOLVED transition and, once every line is
     * decided, creates the TRANSFER_APPLY follow-up action if anything
     * was approved. */
    private async resolveTransferApprovalIfDone(tx: Prisma.TransactionClient, submissionId: string, actorId: string): Promise<void> {
        const action = await this.ownerActionState.findOwnerAction(tx, submissionId, "TRANSFER_APPROVAL");
        if (!action) return;
        await this.ownerActionState.logActivity(tx, action.owner_action_id, actorId, "stock_transfer.status", "PENDING", "decided");

        const siblings = await tx.stockTransfer.findMany({ where: { submission_id: submissionId } });
        const stillPending = siblings.some((t) => t.status === "PENDING");
        await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: !stillPending, note: "all transfers decided" });
        if (stillPending) return;

        const approvedCount = siblings.filter((t) => t.status === "APPROVED").length;
        if (approvedCount > 0) {
            await tx.ownerAction.create({
                data: {
                    source_submission_id: submissionId,
                    kiosk_id: action.kiosk_id,
                    category: "TRANSFER_APPLY",
                    title: `Apply ${approvedCount} approved transfer(s)`,
                    status: "OPEN",
                    priority: "NORMAL",
                },
            });
        }
    }
}
