import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { addDays, startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, Product, StockItem, User } from "@prisma/client";

/** One staff member taking one item ("qty" is always 1 by the form's own
 * rule — see StaffFoodProcessor — so it's shown, not summed). */
export type StaffFoodDetailLine = { who: string; product: string };
/** One Food Waste line: an amount of a raw stock item thrown out, plus its
 * cost if the item has a cost_per_100g rate set (null = UNCOSTED, never guessed). */
export type FoodWasteDetailLine = { item: string; grams: number; cost: number | null };

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
 *
 * Staff Food / Food Waste additionally carry their exact submitted lines
 * (see `detail` below) — an owner clicking either icon on the frontend
 * sees who took what, or which stock items were wasted and how much,
 * instead of just a checkmark. Kept inline on this same bootstrap (not a
 * separate lazy-loaded endpoint): the payload is already scoped to every
 * kiosk over only 14 days, so both tables together add a small, bounded
 * amount of data, not a second round trip for every icon clicked.
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

        const [rows, staffFoodRows, foodWasteRows, products, stockItems, users] = await Promise.all([
            this.prisma.submission.findMany({
                where: { kiosk_id: { in: kioskIds }, form_type: { in: [...ALL_FORM_TYPES] }, business_date: { gte: start, lte: end } },
                select: { kiosk_id: true, form_type: true, business_date: true },
            }),
            this.prisma.staffFood.findMany({
                where: { kiosk_id: { in: kioskIds }, food_date: { gte: start, lte: end } },
                select: { kiosk_id: true, food_date: true, user_id: true, product_id: true },
            }),
            this.prisma.stockMovement.findMany({
                where: { kiosk_id: { in: kioskIds }, movement_type: "FOOD_WASTE", movement_date: { gte: start, lte: end } },
                select: { kiosk_id: true, movement_date: true, stock_item_id: true, qty: true, cost: true },
            }),
            this.tableCache.getAll<Product>("product"),
            this.tableCache.getAll<StockItem>("stock_item"),
            this.tableCache.getAll<User>("user"),
        ]);

        // "kioskId|formType|dateStr" -> true, for O(1) lookup while building the grid.
        const submitted = new Set(rows.filter((r) => r.business_date).map((r) => `${r.kiosk_id}|${r.form_type}|${toDateStr(r.business_date!)}`));

        const productName = new Map(products.map((p) => [p.product_id, p.name]));
        const stockItemName = new Map(stockItems.map((s) => [s.stock_item_id, s.name]));
        const userName = new Map(users.map((u) => [u.user_id, u.name]));

        // "kioskId|dateStr" -> lines, built once so the day loop below is a
        // plain lookup, not a re-filter of the whole range per cell.
        const staffFoodByKey = new Map<string, StaffFoodDetailLine[]>();
        for (const r of staffFoodRows) {
            const key = `${r.kiosk_id}|${toDateStr(r.food_date)}`;
            const line: StaffFoodDetailLine = { who: (r.user_id && userName.get(r.user_id)) || "Unknown staff", product: productName.get(r.product_id) || r.product_id };
            (staffFoodByKey.get(key) ?? staffFoodByKey.set(key, []).get(key)!).push(line);
        }
        const foodWasteByKey = new Map<string, FoodWasteDetailLine[]>();
        for (const r of foodWasteRows) {
            const key = `${r.kiosk_id}|${toDateStr(r.movement_date)}`;
            const line: FoodWasteDetailLine = { item: stockItemName.get(r.stock_item_id) || r.stock_item_id, grams: Number(r.qty), cost: r.cost === null ? null : Number(r.cost) };
            (foodWasteByKey.get(key) ?? foodWasteByKey.set(key, []).get(key)!).push(line);
        }

        const days: { date: string; kiosks: Record<string, Record<FormType, boolean>>; detail: Record<string, { STAFF_FOOD?: StaffFoodDetailLine[]; FOOD_WASTE?: FoodWasteDetailLine[] }> }[] = [];
        for (let d = end; d >= start; d = addDays(d, -1)) {
            const dateStr = toDateStr(d);
            const kioskStatus: Record<string, Record<FormType, boolean>> = {};
            const detail: Record<string, { STAFF_FOOD?: StaffFoodDetailLine[]; FOOD_WASTE?: FoodWasteDetailLine[] }> = {};
            for (const kId of kioskIds) {
                const perTask = {} as Record<FormType, boolean>;
                for (const t of ALL_FORM_TYPES) perTask[t] = submitted.has(`${kId}|${t}|${dateStr}`);
                kioskStatus[kId] = perTask;

                const key = `${kId}|${dateStr}`;
                const staffFood = staffFoodByKey.get(key);
                const foodWaste = foodWasteByKey.get(key);
                if (staffFood || foodWaste) detail[kId] = { STAFF_FOOD: staffFood, FOOD_WASTE: foodWaste };
            }
            days.push({ date: dateStr, kiosks: kioskStatus, detail });
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
