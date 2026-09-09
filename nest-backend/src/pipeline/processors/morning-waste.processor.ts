import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { addDays, toDateStr } from "../../common/date.util.js";

type WasteLine = { product_id: string; qty: number };
type MorningWastePayload = { no_waste?: boolean; lines?: WasteLine[] };

/**
 * Morning Waste — port of backend/forms/FormMorningWaste.js. "No waste" is
 * a valid completed submission, distinct from no submission at all.
 * Expired finished products only; never posts stock, never emails.
 */
@Injectable()
export class MorningWasteProcessor implements SubmissionProcessor<MorningWastePayload> {
    readonly formType = "MORNING_WASTE";
    readonly tables = [{ model: "product_movement" }];

    constructor(private readonly settings: SettingsService) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as MorningWastePayload;
        const lines = p.lines ?? [];
        if (p.no_waste && lines.length) return { valid: false, message: "No-waste submission must not contain waste lines." };
        if (!p.no_waste && !lines.length) return { valid: false, message: "Add at least one waste line, or use No Waste Today." };
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i]!;
            if (!ln.product_id || !Number.isInteger(ln.qty) || ln.qty < 1) {
                return { valid: false, message: `Line ${i + 1}: quantity must be a whole number of at least 1.` };
            }
        }
        return { valid: true };
    }

    buildKey(ctx: KeyContext<MorningWastePayload>): string {
        return `MORNING_WASTE|${ctx.kiosk.kiosk_id}|${toDateStr(ctx.businessDate)}`;
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<MorningWastePayload>): Promise<string> {
        const p = ctx.payload;
        if (p.no_waste) return "PROCESSED";

        const lines = p.lines ?? [];
        const defaultDays = (await this.settings.getNumber("WASTE_ATTRIBUTION_DAYS_DEFAULT")) ?? 2;

        for (const line of lines) {
            const product = await tx.product.findUnique({ where: { product_id: line.product_id } });
            if (!product) throw new Error(`Unknown product "${line.product_id}".`);

            const unitCost = product.current_unit_cost;
            const shelfDays = product.shelf_life_days;
            const attributed =
                shelfDays !== null
                    ? addDays(ctx.businessDate, -shelfDays)
                    : product.production_role === "RETAIL"
                      ? null
                      : addDays(ctx.businessDate, -defaultDays);

            await tx.productMovement.create({
                data: {
                    submission_id: ctx.submission.submission_id,
                    kiosk_id: ctx.kiosk.kiosk_id,
                    product_id: product.product_id,
                    movement_type: "EXPIRED_WASTE",
                    direction: "OUT",
                    movement_date: ctx.businessDate,
                    qty: line.qty,
                    unit_cost: unitCost,
                    cost: unitCost === null ? null : Math.round(line.qty * Number(unitCost) * 100) / 100,
                    attributed_production_date: attributed,
                    status: unitCost === null ? "UNCOSTED" : "COSTED",
                },
            });
        }
        return "PROCESSED";
    }
}
