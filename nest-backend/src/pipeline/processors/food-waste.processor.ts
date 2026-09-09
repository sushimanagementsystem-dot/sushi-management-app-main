import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";

type FoodWasteLine = { stock_item_id: string; grams: number; description?: string };
type FoodWastePayload = { client_key: string; lines: FoodWasteLine[] };

/**
 * Food Waste — port of backend/forms/FormFoodWaste.js. The only workflow
 * posting to stock_movement (raw stock), not products. Cost = grams/100 x
 * cost_per_100g; blank = UNCOSTED, never guessed.
 *
 * KNOWN GAP: the old form allows a synthetic "OTHER" line with no real
 * stock_item (free-text description instead, via reference_id) — this
 * schema's stock_movement.stock_item_id is a required FK, so that case
 * can't be written as-is. Needs a schema decision (nullable FK, or a
 * sentinel "OTHER" stock_item row) before this is a full port; until then
 * an "OTHER" line throws rather than silently dropping or corrupting data.
 */
@Injectable()
export class FoodWasteProcessor implements SubmissionProcessor<FoodWastePayload> {
    readonly formType = "FOOD_WASTE";
    readonly tables = [{ model: "stock_movement" }];

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<FoodWastePayload>;
        if (!p.client_key) return { valid: false, message: "Missing form key — reload the page and try again." };
        const lines = p.lines ?? [];
        if (!lines.length) return { valid: false, message: "Add at least one item." };
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i]!;
            if (!ln.stock_item_id || !Number.isFinite(ln.grams) || ln.grams <= 0) {
                return { valid: false, message: `Line ${i + 1}: weight must be a number greater than 0.` };
            }
            if (ln.stock_item_id === "OTHER" && !String(ln.description ?? "").trim()) {
                return { valid: false, message: `Line ${i + 1}: "Other" needs a description.` };
            }
        }
        return { valid: true };
    }

    buildKey(ctx: KeyContext<FoodWastePayload>): string {
        return `FOOD_WASTE|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<FoodWastePayload>): Promise<string> {
        for (const line of ctx.payload.lines) {
            if (line.stock_item_id === "OTHER") {
                throw new Error('Food Waste "Other" line item is not yet supported by this backend — see FoodWasteProcessor for the schema decision needed.');
            }
            const item = await tx.stockItem.findUnique({ where: { stock_item_id: line.stock_item_id } });
            if (!item) throw new Error(`Unknown stock item "${line.stock_item_id}".`);

            const rate = item.cost_per_100g;
            const cost = rate === null ? null : Math.round((line.grams / 100) * Number(rate) * 100) / 100;

            await tx.stockMovement.create({
                data: {
                    submission_id: ctx.submission.submission_id,
                    kiosk_id: ctx.kiosk.kiosk_id,
                    stock_item_id: item.stock_item_id,
                    movement_type: "FOOD_WASTE",
                    direction: "OUT",
                    movement_date: ctx.businessDate,
                    qty: line.grams,
                    unit_cost: rate,
                    cost,
                },
            });
        }
        return "PROCESSED";
    }
}
