import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
    KeyContext,
    ProcessingContext,
    SubmissionProcessor,
    ValidationResult,
} from "../submission-processor.interface.js";

type StaffFoodPayload = { product_id: string };

/**
 * Staff Food — port of backend/forms/FormStaffFood.js. Quantity is always
 * 1 (owner rule: staff cannot take more than one product), so it's not
 * even a field on the form. "Staff" is the signed-in identity, never a
 * client-picked value.
 */
@Injectable()
export class StaffFoodProcessor implements SubmissionProcessor<StaffFoodPayload> {
    readonly formType = "STAFF_FOOD";
    readonly tables = [{ model: "staff_food" }, { model: "product_movement" }];

    validate(payload: unknown): ValidationResult {
        const p = payload as Partial<StaffFoodPayload> | null;
        if (!p?.product_id) return { valid: false, message: "Select a product." };
        return { valid: true };
    }

    // One product per staff member per shift: same key every time this
    // user submits today at this kiosk, so a resubmit edits, not duplicates.
    buildKey(ctx: KeyContext<StaffFoodPayload>): string {
        const dateStr = ctx.businessDate.toISOString().slice(0, 10);
        return `STAFF_FOOD|${ctx.kiosk.kiosk_id}|${dateStr}|${ctx.userId ?? "unknown"}`;
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<StaffFoodPayload>): Promise<string> {
        const payload = ctx.payload as StaffFoodPayload;

        const staff = ctx.submission.user_id
            ? await tx.user.findFirst({ where: { user_id: ctx.submission.user_id, active: true } })
            : null;
        const product = await tx.product.findUnique({ where: { product_id: payload.product_id } });

        const qty = 1;
        await tx.staffFood.create({
            data: {
                submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                food_date: ctx.businessDate,
                user_id: staff?.user_id,
                product_id: product?.product_id ?? payload.product_id,
                qty,
            },
        });

        if (product) {
            const unitCost = product.current_unit_cost;
            await tx.productMovement.create({
                data: {
                    submission_id: ctx.submission.submission_id,
                    kiosk_id: ctx.kiosk.kiosk_id,
                    product_id: product.product_id,
                    movement_type: "STAFF_FOOD",
                    direction: "OUT",
                    movement_date: ctx.businessDate,
                    qty,
                    unit_cost: unitCost,
                    cost: unitCost === null ? null : Math.round(qty * Number(unitCost) * 100) / 100,
                    status: unitCost === null ? "UNCOSTED" : "COSTED",
                },
            });
        }

        return staff && product ? "PROCESSED" : "PROCESSED_WITH_WARNING";
    }
}
