import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";
import { stockBalanceAsOf } from "../../common/stock-balance.util.js";

@Injectable()
export class StocktakeReviewService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly ownerActionState: OwnerActionStateService,
    ) {}

    /** Add/edit a stocktake_line while its header is still PENDING review.
     * count_unit always comes from stock_item, never owner-typed. */
    async saveLine(stocktakeHeaderId: string, isNew: boolean, line: Record<string, unknown>) {
        const header = await this.prisma.stocktakeHeader.findUnique({ where: { stocktake_header_id: stocktakeHeaderId } });
        if (!header) throw new NotFoundException("Stocktake not found.");
        if (header.reconciliation_status !== "PENDING") throw new BadRequestException("This stocktake has already been reviewed.");

        const item = await this.prisma.stockItem.findUnique({ where: { stock_item_id: line.stock_item_id as string } });
        if (!item) throw new BadRequestException("Unknown stock item.");
        const qty = Number(line.counted_qty);
        if (!Number.isFinite(qty) || qty < 0) throw new BadRequestException("Count must be a number, 0 or more.");

        const clean = {
            stocktake_line_id: isNew ? crypto.randomUUID() : (line.stocktake_line_id as string),
            stocktake_header_id: stocktakeHeaderId,
            stock_item_id: item.stock_item_id,
            counted_qty: qty,
            count_unit: item.count_unit,
        };
        if (isNew) {
            await this.prisma.stocktakeLine.create({ data: clean });
        } else {
            const result = await this.prisma.stocktakeLine.updateMany({ where: { stocktake_line_id: clean.stocktake_line_id }, data: clean });
            if (result.count === 0) throw new NotFoundException("Line not found.");
        }
        return { row: clean };
    }

    async deleteLine(stocktakeLineId: string): Promise<void> {
        const line = await this.prisma.stocktakeLine.findUnique({ where: { stocktake_line_id: stocktakeLineId } });
        if (!line) throw new NotFoundException("Line not found.");
        const header = await this.prisma.stocktakeHeader.findUnique({ where: { stocktake_header_id: line.stocktake_header_id } });
        if (!header || header.reconciliation_status !== "PENDING") throw new BadRequestException("This stocktake has already been reviewed.");
        await this.prisma.stocktakeLine.delete({ where: { stocktake_line_id: stocktakeLineId } });
    }

    /**
     * Confirms a stocktake: for each current line, compares counted_qty
     * against that stock item's full stock_movement ledger balance to
     * date — self-correcting regardless of history depth. Any non-zero
     * delta posts one STOCKTAKE_ADJUSTMENT movement.
     */
    async confirm(stocktakeHeaderId: string, confirmedBy: string): Promise<void> {
        const header = await this.prisma.stocktakeHeader.findUnique({ where: { stocktake_header_id: stocktakeHeaderId } });
        if (!header) throw new NotFoundException("Stocktake not found.");
        if (header.reconciliation_status !== "PENDING") throw new BadRequestException("Already reviewed.");

        const [lines, movements] = await Promise.all([
            this.prisma.stocktakeLine.findMany({ where: { stocktake_header_id: stocktakeHeaderId } }),
            this.prisma.stockMovement.findMany({ where: { kiosk_id: header.kiosk_id } }),
        ]);
        const items = await this.prisma.stockItem.findMany();
        const itemById = new Map(items.map((s) => [s.stock_item_id, s]));

        // Computed before the transaction, then written with one
        // createMany — a real kiosk's countable-item list is large enough
        // (110+ items) that one create() per adjusted line inside this
        // transaction blew past Prisma's 5s interactive-transaction
        // timeout (confirmed live: 119 lines failed at ~5.4s in, the same
        // root cause as weekly-stocktake.processor.ts's submit-side bug).
        const movementRows = lines
            .map((line) => {
                const balance = stockBalanceAsOf(movements, line.stock_item_id);
                const delta = Number(line.counted_qty) - balance;
                if (delta === 0) return null;
                const item = itemById.get(line.stock_item_id);
                const unitCost = item?.current_unit_cost ?? null;
                const qty = Math.abs(delta);
                return {
                    kiosk_id: header.kiosk_id,
                    stock_item_id: line.stock_item_id,
                    movement_type: "STOCKTAKE_ADJUSTMENT",
                    direction: delta > 0 ? "IN" : "OUT",
                    movement_date: header.stocktake_date,
                    qty,
                    unit_cost: unitCost,
                    cost: unitCost === null ? null : Math.round(qty * Number(unitCost) * 100) / 100,
                    reference_id: line.stocktake_line_id,
                };
            })
            .filter((row): row is NonNullable<typeof row> => row !== null);

        await this.prisma.$transaction(async (tx) => {
            if (movementRows.length) await tx.stockMovement.createMany({ data: movementRows });

            await tx.stocktakeHeader.update({ where: { stocktake_header_id: stocktakeHeaderId }, data: { reconciliation_status: "CONFIRMED" } });

            const action = await this.ownerActionState.findOwnerAction(tx, header.submission_id, "STOCKTAKE_REVIEW");
            if (action) {
                await this.ownerActionState.logActivity(tx, action.owner_action_id, confirmedBy, "reconciliation_status", "PENDING", "CONFIRMED");
                await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: true, note: "stocktake confirmed" });
            }
        });
    }

    async decline(stocktakeHeaderId: string, declinedBy: string): Promise<void> {
        const header = await this.prisma.stocktakeHeader.findUnique({ where: { stocktake_header_id: stocktakeHeaderId } });
        if (!header) throw new NotFoundException("Stocktake not found.");
        if (header.reconciliation_status !== "PENDING") throw new BadRequestException("Already reviewed.");

        await this.prisma.$transaction(async (tx) => {
            await tx.stocktakeHeader.update({ where: { stocktake_header_id: stocktakeHeaderId }, data: { reconciliation_status: "DECLINED" } });
            const action = await this.ownerActionState.findOwnerAction(tx, header.submission_id, "STOCKTAKE_REVIEW");
            if (action) {
                await this.ownerActionState.logActivity(tx, action.owner_action_id, declinedBy, "reconciliation_status", "PENDING", "DECLINED");
                await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: true, note: "stocktake declined" });
            }
        });
    }
}
