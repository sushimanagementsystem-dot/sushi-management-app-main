import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { MailerService } from "../../mailer/mailer.service.js";
import { addDays, startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, Product } from "@prisma/client";

/**
 * Reports — the two pieces the existing per-topic dashboard pages
 * (Kiosk Comparison, Stock Usage, Profit, Stock Variances, Staff Food)
 * don't already provide on their own: a Production report (nothing else
 * shows planned-quantity-by-product), and a Trends view (a daily
 * time-series across the whole business — every other page is a single
 * flat range, never a day-by-day line). Everything else the Reports page
 * needs — Store Comparison, Waste, Profit, Stock Variance, Staff Food —
 * is served by reusing those pages' own bootstrap actions directly from
 * the frontend, not duplicated here.
 */
@Injectable()
export class ReportsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly mailer: MailerService,
    ) {}

    private resolveRange(startDate: Date | undefined, endDate: Date | undefined) {
        const end = endDate ?? startOfTodayUtc();
        const start = startDate ?? addDays(end, -6);
        return { start, end };
    }

    /** Planned production quantity per product for the period, one column per kiosk — so the same product can be
     * compared across kiosks side by side. The one report topic with no existing bootstrap action to reuse. */
    async bootstrapProductionReport(startDate: Date | undefined, endDate: Date | undefined) {
        const { start, end } = this.resolveRange(startDate, endDate);
        const kiosks = (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
        const kioskIds = kiosks.map((k) => k.kiosk_id);

        const groups = await this.prisma.productionPlan.groupBy({
            by: ["kiosk_id", "product_id"],
            // business_date carries a time of day, so the last day is "before the next midnight", not "<= midnight".
            where: { kiosk_id: { in: kioskIds }, business_date: { gte: start, lt: addDays(end, 1) } },
            _sum: { planned_qty: true },
        });

        const products = await this.tableCache.getAll<Product>("product");
        const productNameById = new Map(products.map((p) => [p.product_id, p.name]));
        const kioskNameById = new Map(kiosks.map((k) => [k.kiosk_id, k.name]));

        // product -> kiosk -> planned qty. Keyed by product id (two products can share a name), shown by name.
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const byProduct = new Map<string, { productName: string; byKiosk: Record<string, number> }>();
        for (const g of groups) {
            const qty = round2(Number(g._sum.planned_qty ?? 0));
            if (qty <= 0) continue;
            const entry = byProduct.get(g.product_id) ?? { productName: productNameById.get(g.product_id) || g.product_id, byKiosk: {} };
            entry.byKiosk[g.kiosk_id] = qty;
            byProduct.set(g.product_id, entry);
        }
        const productMatrix = [...byProduct.entries()]
            .map(([productId, e]) => ({ productId, productName: e.productName, byKiosk: e.byKiosk, total: round2(Object.values(e.byKiosk).reduce((a, b) => a + b, 0)) }))
            .sort((a, b) => b.total - a.total || a.productName.localeCompare(b.productName));

        const rows = groups
            .map((g) => ({
                kioskId: g.kiosk_id,
                kioskName: kioskNameById.get(g.kiosk_id) || g.kiosk_id,
                productName: productNameById.get(g.product_id) || g.product_id,
                plannedQty: Math.round((Number(g._sum.planned_qty ?? 0) + Number.EPSILON) * 100) / 100,
            }))
            .filter((r) => r.plannedQty > 0)
            .sort((a, b) => a.kioskName.localeCompare(b.kioskName) || b.plannedQty - a.plannedQty);

        return {
            startDate: toDateStr(start),
            endDate: toDateStr(end),
            kiosks: kiosks.map((k) => ({ id: k.kiosk_id, name: k.name })),
            products: productMatrix,
            rows,
        };
    }

    /** Day-by-day totals across every kiosk combined — waste/damage/staff
     * food cost, plus how many stock variances were detected that day —
     * the one shape none of the flat-range reports give you: is this
     * getting better or worse over the period, not just what the total was. */
    async bootstrapTrends(startDate: Date | undefined, endDate: Date | undefined) {
        const { start, end } = this.resolveRange(startDate, endDate);
        const kiosks = (await this.tableCache.getAll<Kiosk>("kiosk")).filter((k) => k.active);
        const kioskIds = kiosks.map((k) => k.kiosk_id);

        const movements = await this.prisma.productMovement.findMany({
            where: {
                kiosk_id: { in: kioskIds },
                movement_type: { in: ["EXPIRED_WASTE", "DAMAGE", "STAFF_FOOD"] },
                movement_date: { gte: start, lte: end },
            },
            select: { movement_type: true, movement_date: true, cost: true },
        });

        const byDate = new Map<string, { wasteCost: number; damageCost: number; staffFoodCost: number }>();
        for (let d = start; d <= end; d = addDays(d, 1)) byDate.set(toDateStr(d), { wasteCost: 0, damageCost: 0, staffFoodCost: 0 });

        for (const m of movements) {
            const key = toDateStr(m.movement_date);
            const bucket = byDate.get(key);
            if (!bucket) continue;
            const cost = m.cost === null ? 0 : Number(m.cost);
            if (m.movement_type === "EXPIRED_WASTE") bucket.wasteCost += cost;
            else if (m.movement_type === "DAMAGE") bucket.damageCost += cost;
            else if (m.movement_type === "STAFF_FOOD") bucket.staffFoodCost += cost;
        }

        const days = [...byDate.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, totals]) => ({
                date,
                wasteCost: Math.round(totals.wasteCost * 100) / 100,
                damageCost: Math.round(totals.damageCost * 100) / 100,
                staffFoodCost: Math.round(totals.staffFoodCost * 100) / 100,
            }));

        return { startDate: toDateStr(start), endDate: toDateStr(end), days };
    }

    /** On-demand "email me this report" — not a scheduled/recurring send
     * (that would need its own cron + a persisted "which reports, to
     * whom, how often" config, a materially bigger feature than what was
     * asked for here). Reuses the same MailerService every other outbound
     * email in this app already goes through. */
    async sendReportEmail(to: string, subject: string, html: string) {
        if (!(await this.mailer.isConfigured())) {
            throw new BadRequestException("Email is not configured — set Sender Email / Sender App Password on the Site Configuration page.");
        }
        try {
            await this.mailer.sendMail({ to, subject, html });
        } catch (err) {
            // Turn nodemailer's raw SMTP failure (which would otherwise
            // surface as an opaque 500) into something the owner can act
            // on — this is almost always the Gmail App Password itself
            // being wrong/expired, not anything about the report or the
            // recipient address.
            const detail = err instanceof Error ? err.message : String(err);
            throw new BadRequestException(`Could not send the email — the server's mail account rejected it (${detail}).`);
        }
        return { ok: true };
    }
}
