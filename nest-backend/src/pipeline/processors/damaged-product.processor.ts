import { Injectable } from "@nestjs/common";
import type { Kiosk, Prisma, Product } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { UploadService } from "../../upload/upload.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { addDays, toDateStr } from "../../common/date.util.js";

type DamagedProductPayload = {
    client_key: string;
    product_id: string;
    qty: number;
    damage_cause?: string;
    photo?: { base64: string; mimeType: string; name: string };
    photo_reference?: string;
};

/**
 * Damaged Product Log — port of backend/forms/FormDamagedProduct.js. Posts
 * unconditionally to product_movement (movement_type DAMAGE); a rolling
 * 7-day-window threshold check conditionally raises one owner_action.
 * "Produced" uses production_plan.planned_qty as a known approximation
 * (the old system's own documented caveat — Confirm Production was
 * dropped, see the original file's header comment).
 */
@Injectable()
export class DamagedProductProcessor implements SubmissionProcessor<DamagedProductPayload> {
    readonly formType = "DAMAGED_PRODUCT";
    readonly tables = [{ model: "product_movement" }];

    constructor(
        private readonly upload: UploadService,
        private readonly settings: SettingsService,
    ) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<DamagedProductPayload>;
        if (!p.client_key) return { valid: false, message: "Missing form key — reload the page and try again." };
        if (!p.product_id) return { valid: false, message: "Select the product." };
        if (!Number.isInteger(p.qty) || (p.qty ?? 0) < 1) return { valid: false, message: "Quantity must be a whole number of at least 1." };
        if (!p.photo?.base64) return { valid: false, message: "A photo is required." };
        return { valid: true };
    }

    buildKey(ctx: KeyContext<DamagedProductPayload>): string {
        return `DAMAGED_PRODUCT|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
    }

    async prepareIntake(payload: unknown, kiosk: Kiosk): Promise<DamagedProductPayload> {
        const p = payload as DamagedProductPayload;
        const uploaded = await this.upload.save(p.photo!, kiosk.kiosk_id, "DAMAGED_PRODUCT");
        return { ...p, photo_reference: uploaded.url, photo: undefined };
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<DamagedProductPayload>): Promise<string> {
        const p = ctx.payload;
        const product = await tx.product.findUnique({ where: { product_id: p.product_id } });

        const unitCost = product?.current_unit_cost ?? null;
        await tx.productMovement.create({
            data: {
                submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                product_id: product?.product_id ?? p.product_id,
                movement_type: "DAMAGE",
                direction: "OUT",
                movement_date: ctx.businessDate,
                qty: p.qty,
                unit_cost: unitCost,
                cost: unitCost === null ? null : Math.round(p.qty * Number(unitCost) * 100) / 100,
                damage_cause: p.damage_cause ?? null,
                photo_reference: p.photo_reference ?? null,
                status: unitCost === null ? "UNCOSTED" : "COSTED",
            },
        });

        if (product) {
            await this.checkDamageThresholds(tx, ctx, product, p.qty);
            return "PROCESSED";
        }
        return "PROCESSED_WITH_WARNING";
    }

    private async checkDamageThresholds(tx: Prisma.TransactionClient, ctx: ProcessingContext<DamagedProductPayload>, product: Product, qty: number) {
        const weekStart = addDays(ctx.businessDate, -6);
        const kioskId = ctx.kiosk.kiosk_id;

        const [kioskWeekDamage, kioskWeekPlanned, productWeekDamage, submitterWeekCount] = await Promise.all([
            tx.productMovement.aggregate({
                _sum: { qty: true },
                where: { kiosk_id: kioskId, movement_type: "DAMAGE", movement_date: { gte: weekStart, lte: ctx.businessDate } },
            }),
            tx.productionPlan.aggregate({
                _sum: { planned_qty: true },
                where: { kiosk_id: kioskId, business_date: { gte: weekStart, lte: ctx.businessDate } },
            }),
            tx.productMovement.aggregate({
                _sum: { qty: true },
                where: { kiosk_id: kioskId, product_id: product.product_id, movement_type: "DAMAGE", movement_date: { gte: weekStart, lte: ctx.businessDate } },
            }),
            tx.submission.count({
                where: {
                    kiosk_id: kioskId,
                    form_type: "DAMAGED_PRODUCT",
                    user_id: ctx.submission.user_id,
                    business_date: { gte: weekStart, lte: ctx.businessDate },
                },
            }),
        ]);

        const weekDamage = Number(kioskWeekDamage._sum.qty ?? 0);
        const weekPlanned = Number(kioskWeekPlanned._sum.planned_qty ?? 0);
        const kioskRate = weekPlanned > 0 ? (weekDamage / weekPlanned) * 100 : 0;
        const prodWeekDamage = Number(productWeekDamage._sum.qty ?? 0);

        const [rateThreshold, productThreshold, submitterThreshold] = await Promise.all([
            this.settings.getNumber("DAMAGE_REVIEW_UNITS_PER_100"),
            this.settings.getNumber("DAMAGE_REVIEW_PRODUCT_WEEK_UNITS"),
            this.settings.getNumber("DAMAGE_REVIEW_SUBMITTER_WEEK"),
        ]);

        const fired: string[] = [];
        if (kioskRate > (rateThreshold ?? 3)) fired.push(`kiosk-week damage rate ${kioskRate.toFixed(1)}% of planned production`);
        if (prodWeekDamage >= (productThreshold ?? 5)) fired.push(`${product.name}: ${prodWeekDamage} damaged this week`);
        if (submitterWeekCount >= (submitterThreshold ?? 5)) fired.push(`${submitterWeekCount} damage submissions by the same submitter this week`);
        if (!fired.length) return;

        await tx.ownerAction.create({
            data: {
                source_submission_id: ctx.submission.submission_id,
                kiosk_id: kioskId,
                category: "DAMAGE_REVIEW",
                title: `Damage review — ${kioskId} — ${product.name}`,
                status: "OPEN",
                priority: "NORMAL",
                owner_note: fired.join("; "),
            },
        });
    }
}
