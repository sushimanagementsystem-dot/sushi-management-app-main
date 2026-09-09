import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { ProductionEngineService } from "../../production-engine/production-engine.service.js";
import { ProductionEmailService } from "../../production-engine/production-email.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { toDateStr } from "../../common/date.util.js";
import type { ProductionPlan } from "../../production-engine/production-engine.types.js";

type FridgeCountPayload = { counts: Record<string, number>; plainRiceCarryoverGrams?: number };

/**
 * Morning Fridge Count — port of backend/forms/FormFridgeCount.js. Writes
 * fridge_count rows, computes the production plan (see
 * ProductionEngineService), writes production_plan rows, then emails the
 * plan to the kiosk's production_email (see ProductionEmailService — port
 * of EngineEmail.js/EngineEmailRender.js's sendProductionEmail_).
 *
 * The email send runs in afterCommit(), after the transaction below has
 * already committed — same reasoning as the old system's own try/catch
 * around sendProductionEmail_: the data write must never depend on, or be
 * rolled back by, a mail-send failure. A failed send is recorded to
 * processing_error_log and downgrades the status to
 * PROCESSED_WITH_WARNING, never ERROR.
 */
@Injectable()
export class FridgeCountProcessor implements SubmissionProcessor<FridgeCountPayload> {
    readonly formType = "FRIDGE_COUNT";
    readonly tables = [{ model: "fridge_count" }, { model: "production_plan" }];

    constructor(
        private readonly engine: ProductionEngineService,
        private readonly productionEmail: ProductionEmailService,
        private readonly prisma: PrismaService,
    ) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<FridgeCountPayload>;
        const counts = p.counts ?? {};
        const ids = Object.keys(counts);
        if (!ids.length) return { valid: false, message: "No counts submitted." };
        for (const id of ids) {
            const q = counts[id];
            if (!Number.isInteger(q) || (q ?? -1) < 0) return { valid: false, message: `"${id}": count must be a whole number, 0 or more.` };
        }
        if (p.plainRiceCarryoverGrams !== undefined) {
            const g = Number(p.plainRiceCarryoverGrams);
            if (!Number.isFinite(g) || g < 0) return { valid: false, message: "Plain rice carryover must be a number, 0 or more." };
        }
        return { valid: true };
    }

    buildKey(ctx: KeyContext<FridgeCountPayload>): string {
        return `FRIDGE_COUNT|${ctx.kiosk.kiosk_id}|${toDateStr(ctx.businessDate)}`;
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<FridgeCountPayload>): Promise<string> {
        const counts = ctx.payload.counts;
        const carryoverGrams = Number(ctx.payload.plainRiceCarryoverGrams) || 0;

        // createMany, not one create() per product in a loop — a real
        // kiosk's product list is large enough (100+ products) that
        // sequential round trips inside this one transaction blow past
        // Prisma's 5s interactive-transaction timeout (confirmed live for
        // the structurally identical bug in weekly-stocktake.processor.ts:
        // 119 sequential creates failed at ~5.4s). Fridge Count is
        // submitted daily, so this was the highest-traffic instance of
        // the bug.
        const fridgeCountRows = Object.entries(counts).map(([productId, qty]) => ({
            submission_id: ctx.submission.submission_id,
            kiosk_id: ctx.kiosk.kiosk_id,
            business_date: ctx.businessDate,
            product_id: productId,
            counted_qty: qty,
        }));
        if (fridgeCountRows.length) await tx.fridgeCount.createMany({ data: fridgeCountRows });

        const plan = await this.engine.computeProductionPlan(tx, ctx.kiosk, ctx.businessDate, counts, carryoverGrams);

        const productionPlanRows = plan.lines
            .filter((line) => line.make > 0)
            .map((line) => ({
                kiosk_id: ctx.kiosk.kiosk_id,
                business_date: ctx.businessDate,
                product_id: line.product_id,
                planned_qty: line.make,
                submission_id: ctx.submission.submission_id,
            }));
        if (productionPlanRows.length) await tx.productionPlan.createMany({ data: productionPlanRows });

        // Stashed for afterCommit() — the allocator inside computeProductionPlan
        // is stateful (reads recent production_plan history), so this same
        // plan object must be threaded through to the email rather than
        // recomputed after commit, which could diverge from what was just
        // persisted above.
        ctx.extra.plan = plan;
        return "PROCESSED";
    }

    async afterCommit(ctx: ProcessingContext<FridgeCountPayload>): Promise<{ status?: string } | void> {
        const plan = ctx.extra.plan as ProductionPlan;
        try {
            await this.productionEmail.sendProductionPlanEmail(ctx.kiosk, ctx.businessDate, plan, ctx.submission.submitted_by_email ?? "");
        } catch (err) {
            const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
            // Data write already succeeded before this ran — stays
            // PROCESSED_WITH_WARNING, never ERROR — but still needs to
            // land somewhere visible. Without this, a mail failure
            // (blank/bad kiosk email, credentials, quota) leaves zero
            // trace anywhere a human would see it.
            await this.prisma.processingErrorLog.create({
                data: {
                    kiosk_id: ctx.kiosk.kiosk_id,
                    form_type: this.formType,
                    submission_id: ctx.submission.submission_id,
                    stage: "send production email",
                    error_message: message,
                    records_written_before_error: true,
                    recommended_action: "Fix the cause (e.g. missing kiosk production_email, or the mail Sender Email/App Password on the Site Configuration page), then resend manually.",
                },
            });
            return { status: "PROCESSED_WITH_WARNING" };
        }
    }
}
