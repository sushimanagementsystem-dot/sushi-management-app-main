import { stocktakeCategoryIds } from "../../common/stocktake-items.util.js";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { toDateStr } from "../../common/date.util.js";

type StocktakePayload = { counts: Record<string, number> };

/**
 * Weekly Stocktake — port of backend/forms/FormStocktake.js. A complete
 * snapshot: every active countable item must have a number. A resubmit is
 * blocked entirely once the owner has started reconciling (see
 * clearExtra) — reconciliation movements may already be posted, and
 * clearing the header/lines behind them would orphan those movements.
 */
@Injectable()
export class WeeklyStocktakeProcessor implements SubmissionProcessor<StocktakePayload> {
    readonly formType = "WEEKLY_STOCKTAKE";
    readonly tables = [{ model: "stocktake_header" }, { model: "owner_action", viaSourceSubmission: true }];

    constructor(
        private readonly settings: SettingsService,
        private readonly enumOptions: EnumOptionService,
    ) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<StocktakePayload>;
        const counts = p.counts ?? {};
        const ids = Object.keys(counts);
        if (!ids.length) return { valid: false, message: "No counts submitted." };
        for (const id of ids) {
            const q = Number(counts[id]);
            if (!Number.isFinite(q) || q < 0) return { valid: false, message: `"${id}": count must be a number, 0 or more.` };
        }
        return { valid: true };
    }

    buildKey(ctx: KeyContext<StocktakePayload>): string {
        return `WEEKLY_STOCKTAKE|${ctx.kiosk.kiosk_id}|${toDateStr(ctx.businessDate)}`;
    }

    async clearExtra(tx: Prisma.TransactionClient, oldSubmissionIds: string[]): Promise<void> {
        const oldHeaders = await tx.stocktakeHeader.findMany({ where: { submission_id: { in: oldSubmissionIds } } });
        const blocked = oldHeaders.find((h) => h.reconciliation_status && h.reconciliation_status !== "PENDING");
        if (blocked) {
            throw new Error("This stocktake has already been reviewed by the owner — it can no longer be resubmitted.");
        }
        const oldHeaderIds = oldHeaders.map((h) => h.stocktake_header_id);
        if (oldHeaderIds.length) {
            await tx.stocktakeLine.deleteMany({ where: { stocktake_header_id: { in: oldHeaderIds } } });
        }
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<StocktakePayload>): Promise<string> {
        const counts = ctx.payload.counts;

        const categories = await this.enumOptions.getOptions("stock_category");
        const nonWasteCatIds = stocktakeCategoryIds(categories);
        const items = await tx.stockItem.findMany({ where: { active: true, stock_category_id: { in: [...nonWasteCatIds] } } });
        const itemById = new Map(items.map((i) => [i.stock_item_id, i]));

        const expected = items.length;
        const received = items.filter((it) => counts[it.stock_item_id] !== undefined).length;
        const complete = received >= expected;

        const prevHeader = await tx.stocktakeHeader.findFirst({
            where: { kiosk_id: ctx.kiosk.kiosk_id, completion_status: "COMPLETE", stocktake_date: { lt: ctx.businessDate } },
            orderBy: { stocktake_date: "desc" },
        });
        const prevCounts = new Map<string, number>();
        if (prevHeader) {
            const prevLines = await tx.stocktakeLine.findMany({ where: { stocktake_header_id: prevHeader.stocktake_header_id } });
            for (const line of prevLines) prevCounts.set(line.stock_item_id, Number(line.counted_qty));
        }

        const header = await tx.stocktakeHeader.create({
            data: {
                submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                stocktake_date: ctx.businessDate,
                expected_item_count: expected,
                received_item_count: received,
                completion_status: complete ? "COMPLETE" : "INCOMPLETE",
                reconciliation_status: "PENDING",
            },
        });

        // One createMany, not one create() per item in a loop — a real
        // kiosk's countable-item list (110+ items here) sent sequential
        // round trips well past Prisma's 5s interactive-transaction
        // timeout, so every submission from a kiosk with a realistic
        // stock list failed outright. Confirmed live: 119 items blew the
        // timeout at ~5.4s in.
        const lineRows = Object.entries(counts)
            .filter(([itemId]) => itemById.has(itemId))
            .map(([itemId, qty]) => ({
                stocktake_header_id: header.stocktake_header_id,
                stock_item_id: itemId,
                counted_qty: qty,
                count_unit: itemById.get(itemId)!.count_unit,
            }));
        if (lineRows.length) await tx.stocktakeLine.createMany({ data: lineRows });

        if (!complete) return "INCOMPLETE";

        const flagged: string[] = [];
        if (prevHeader) {
            const pct = (await this.settings.getNumber("STOCKTAKE_VARIANCE_PCT")) ?? 50;
            const minUnits = (await this.settings.getNumber("STOCKTAKE_VARIANCE_MIN_UNITS")) ?? 5;
            for (const item of items) {
                const prev = prevCounts.get(item.stock_item_id);
                if (prev === undefined || prev === 0) continue;
                const cur = Number(counts[item.stock_item_id]);
                const move = Math.abs(cur - prev);
                if (move >= minUnits && (move / prev) * 100 > pct) {
                    flagged.push(`${item.name}: ${prev} -> ${cur} ${item.count_unit}`);
                }
            }
        }

        const dateStr = toDateStr(ctx.businessDate);
        await tx.ownerAction.create({
            data: {
                source_submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                category: "STOCKTAKE_REVIEW",
                title: flagged.length
                    ? `Stocktake variance — ${ctx.kiosk.kiosk_id} ${dateStr} (${flagged.length} item(s))`
                    : `Stocktake review — ${ctx.kiosk.kiosk_id} ${dateStr}`,
                status: "OPEN",
                priority: flagged.length ? "URGENT" : "NORMAL",
                owner_note: flagged.join("; "),
            },
        });
        return "PROCESSED";
    }
}
