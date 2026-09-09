import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk } from "@prisma/client";

/** Every form_type a kiosk can submit — the client wants all of them
 * visible in this view, not just the daily ones. Order matches the kiosk
 * home menu's own grouping (see KioskHomeContent.js's MENU_GROUPS):
 * daily tasks first, then as-needed, then scheduled. */
export const ALL_FORM_TYPES = [
    "MORNING_WASTE",
    "FRIDGE_COUNT",
    "STAFF_FOOD",
    "FOOD_WASTE",
    "DAMAGED_PRODUCT",
    "DELIVERY_INVOICE",
    "HELP_ISSUE",
    "MOVE_STOCK",
    "WEEKLY_STOCKTAKE",
    "MONTHLY_AUDIT",
    "AUDIT_CORRECTION",
] as const;
export type FormType = (typeof ALL_FORM_TYPES)[number];

/** The subset with a genuine daily expectation — only these get flagged
 * as "missing" on a given day. The rest ("as needed" forms like Damaged
 * Product or Help/Issue, and scheduled ones like Weekly Stocktake/Monthly
 * Audit) have no fixed daily cadence, so a blank day for those isn't a
 * compliance problem and shouldn't read as one. */
export const DAILY_FORM_TYPES = ["MORNING_WASTE", "FRIDGE_COUNT", "STAFF_FOOD"] as const;

/**
 * All Kiosk Submissions view — one grid showing, for every active kiosk
 * and every form type it can submit, which days that form was actually
 * submitted. Reads straight off `submission` (form_type + kiosk_id +
 * business_date), the same row every form's `submit` action already
 * writes on every attempt — including "No waste today" / a fridge count
 * with zero out-of-range items, so "no row" genuinely means "never
 * submitted," not "submitted nothing."
 */
@Injectable()
export class SubmissionsMonitorService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    async bootstrap(startDate: Date | undefined, endDate: Date | undefined) {
        const kiosks = (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
        const kioskIds = kiosks.map((k) => k.kiosk_id);

        const end = endDate ?? startOfTodayUtc();
        const start = startDate ?? addDays(end, -13); // default: last 14 days

        const rows = await this.prisma.submission.findMany({
            where: { kiosk_id: { in: kioskIds }, form_type: { in: [...ALL_FORM_TYPES] }, business_date: { gte: start, lte: end } },
            select: { kiosk_id: true, form_type: true, business_date: true },
        });

        // "kioskId|formType|dateStr" -> true, for O(1) lookup while building the grid.
        const submitted = new Set(rows.filter((r) => r.business_date).map((r) => `${r.kiosk_id}|${r.form_type}|${toDateStr(r.business_date!)}`));

        const days: { date: string; kiosks: Record<string, Record<FormType, boolean>> }[] = [];
        for (let d = end; d >= start; d = addDays(d, -1)) {
            const dateStr = toDateStr(d);
            const kioskStatus: Record<string, Record<FormType, boolean>> = {};
            for (const kId of kioskIds) {
                const perTask = {} as Record<FormType, boolean>;
                for (const t of ALL_FORM_TYPES) perTask[t] = submitted.has(`${kId}|${t}|${dateStr}`);
                kioskStatus[kId] = perTask;
            }
            days.push({ date: dateStr, kiosks: kioskStatus });
        }

        return {
            startDate: toDateStr(start),
            endDate: toDateStr(end),
            kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
            tasks: ALL_FORM_TYPES,
            dailyTasks: DAILY_FORM_TYPES,
            days,
        };
    }
}
