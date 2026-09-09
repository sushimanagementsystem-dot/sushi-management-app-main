import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk } from "@prisma/client";

/** The four things the client wants to see completed for a kiosk on a given
 * day. The first three are staff-submitted forms (same `submission` table
 * check the Submissions Monitor already does); Production isn't a form at
 * all — a production plan is generated automatically once a kiosk's fridge
 * count is processed, so "no plan for today" is itself a useful signal
 * (either fridge count was never submitted, or something went wrong turning
 * it into a plan). */
export const TASKS = [
    { key: "FRIDGE_COUNT", label: "Fridge Count" },
    { key: "MORNING_WASTE", label: "Waste" },
    { key: "STAFF_FOOD", label: "Staff Food" },
    { key: "PRODUCTION", label: "Production" },
] as const;
export type TaskKey = (typeof TASKS)[number]["key"];

const MOVEMENT_TYPE_BY_TASK: Record<"MORNING_WASTE" | "STAFF_FOOD", string> = {
    MORNING_WASTE: "EXPIRED_WASTE",
    STAFF_FOOD: "STAFF_FOOD",
};

/**
 * Kiosk Task Status — the side-by-side "who hasn't done what today" view:
 * rows are tasks, columns are kiosks, cells are done/not-done. This is a
 * transposed, single-day snapshot of the same underlying signals the
 * Submissions Monitor tracks day-by-day for one kiosk at a time — here
 * every active kiosk is compared at once for one chosen day, which is what
 * "instantly see which kiosk hasn't completed what" needs.
 */
@Injectable()
export class KioskTaskStatusService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    async bootstrap(date: Date | undefined) {
        const kiosks = (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
        const kioskIds = kiosks.map((k) => k.kiosk_id);
        const day = date ?? startOfTodayUtc();
        // business_date is stored with whatever time-of-day the submission
        // actually happened at (not normalized to midnight), so "this day"
        // has to be a [day, next day) range, never an exact-equality match.
        const nextDay = addDays(day, 1);

        const [submissions, plans] = await Promise.all([
            this.prisma.submission.findMany({
                where: {
                    kiosk_id: { in: kioskIds },
                    form_type: { in: ["FRIDGE_COUNT", "MORNING_WASTE", "STAFF_FOOD"] },
                    business_date: { gte: day, lt: nextDay },
                },
                select: { kiosk_id: true, form_type: true },
            }),
            this.prisma.productionPlan.findMany({
                where: { kiosk_id: { in: kioskIds }, business_date: { gte: day, lt: nextDay } },
                select: { kiosk_id: true },
                distinct: ["kiosk_id"],
            }),
        ]);

        const submittedSet = new Set(submissions.map((s) => `${s.kiosk_id}|${s.form_type}`));
        const producedSet = new Set(plans.map((p) => p.kiosk_id));

        const status: Record<string, Record<TaskKey, boolean>> = {};
        for (const kId of kioskIds) {
            status[kId] = {
                FRIDGE_COUNT: submittedSet.has(`${kId}|FRIDGE_COUNT`),
                MORNING_WASTE: submittedSet.has(`${kId}|MORNING_WASTE`),
                STAFF_FOOD: submittedSet.has(`${kId}|STAFF_FOOD`),
                PRODUCTION: producedSet.has(kId),
            };
        }

        return {
            date: toDateStr(day),
            kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
            tasks: TASKS,
            status,
        };
    }

    /** The "underlying actual submitted data" cross-check — raw rows behind
     * one cell, so a ✅ can be verified rather than just trusted. */
    async detail(kioskId: string, date: Date, taskKey: TaskKey) {
        const nextDay = addDays(date, 1);

        if (taskKey === "FRIDGE_COUNT") {
            const rows = await this.prisma.fridgeCount.findMany({
                where: { kiosk_id: kioskId, business_date: { gte: date, lt: nextDay } },
                include: { product: { select: { name: true } } },
                orderBy: { product: { name: "asc" } },
            });
            return { taskKey, rows: rows.map((r) => ({ name: r.product.name, qty: Number(r.counted_qty) })) };
        }

        if (taskKey === "MORNING_WASTE" || taskKey === "STAFF_FOOD") {
            const rows = await this.prisma.productMovement.findMany({
                where: { kiosk_id: kioskId, movement_type: MOVEMENT_TYPE_BY_TASK[taskKey], movement_date: { gte: date, lt: nextDay } },
                include: { product: { select: { name: true } } },
                orderBy: { product: { name: "asc" } },
            });
            return {
                taskKey,
                rows: rows.map((r) => ({ name: r.product.name, qty: Number(r.qty), cost: r.cost !== null ? Number(r.cost) : null })),
            };
        }

        // PRODUCTION
        const rows = await this.prisma.productionPlan.findMany({
            where: { kiosk_id: kioskId, business_date: { gte: date, lt: nextDay } },
            include: { product: { select: { name: true } } },
            orderBy: { product: { name: "asc" } },
        });
        return { taskKey, rows: rows.map((r) => ({ name: r.product.name, qty: Number(r.planned_qty) })) };
    }
}
