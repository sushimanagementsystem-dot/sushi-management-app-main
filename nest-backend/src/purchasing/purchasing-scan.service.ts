import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../reference-data/settings.service.js";
import { MailerService } from "../mailer/mailer.service.js";
import { applyPackRounding, castlebayPacksOverride, computeItemTrigger, loadConfirmedCounts, stockCountDate } from "../common/purchasing-trigger.util.js";
import { buildOrderEmail, type OrderItemInfo } from "./purchasing-order-email.js";
import { loadStocktakeItems } from "../common/stocktake-items.util.js";
import { addDays, startOfTodayUtc, toDateStr } from "../common/date.util.js";
import type { Kiosk, StockItemPar, StockMovement, Supplier, SupplierItemMap } from "@prisma/client";

type RecommendationLine = {
    stockItemId: string;
    supplierId: string;
    totalShortfall: number;
    packSize: number;
    orderMultiple: number;
    recommendedPacks: number;
    recommendedQty: number;
    flags: string[];
};

type DiagnosticLine = { stockItemId: string; flags: string[] };

/**
 * Weekly stock purchasing recommendations — port of
 * backend/dashboard/Purchasing.js. Reads current stock levels (from
 * stock_movement ledger balance, same as KpiService's Stock Usage View),
 * compares against each kiosk's stock_item_par, and groups triggered
 * shortfalls by supplier into one owner_action + purchasing_batch (+lines)
 * per supplier — surfaced in the Action Inbox under the
 * PURCHASING_RECOMMENDATION category (see ActionInboxService).
 *
 * The drafted order is EMAILED TO THE OWNER (never to the supplier) through the
 * same SMTP the production email uses, so the owner only reviews and forwards:
 *  - ORDER_SHEET suppliers (Tazaki, Asia Market, Castlebay): an Excel order
 *    sheet, filled from the par levels, attached;
 *  - every other non-MANUAL method (EMAIL_ORDER, and the old GMAIL_DRAFT /
 *    ONLINE_ORDER_LIST): just a message listing what to order;
 *  - MANUAL suppliers are never ordered automatically.
 * This replaces the old Gmail-draft step, which needed a Gmail API scope the
 * SMTP mailer does not have. If email is not set up, the batch is still
 * created in the Action Inbox and the failure is recorded on it.
 */
@Injectable()
export class PurchasingScanService {
    private readonly logger = new Logger(PurchasingScanService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly settings: SettingsService,
        private readonly mailer: MailerService,
    ) {}

    @Cron(CronExpression.EVERY_WEEK)
    async scheduledScan(): Promise<void> {
        await this.runWeeklyScan();
    }

    /** Skips suppliers with a still-open PURCHASING_RECOMMENDATION batch
     * created within PURCHASING_DUPLICATE_WINDOW_DAYS (spec 20.11). MANUAL
     * suppliers never reach here — buildRecommendations already excludes them. */
    /**
     * "When the stocktake is completed, the orders get drafted": called after the owner confirms a stocktake. The scan
     * sums every kiosk's shortfall, so it waits until no other active kiosk still has a completed stocktake waiting
     * for review; the last confirmation of the round triggers it, once, with every kiosk's count in.
     */
    async runAfterStocktakeConfirmed(): Promise<{ ran: boolean; created?: number; skipped?: number; emailed?: number }> {
        const waiting = await this.prisma.stocktakeHeader.count({ where: { reconciliation_status: "PENDING", completion_status: "COMPLETE", kiosk: { active: true } } });
        if (waiting > 0) return { ran: false };
        const result = await this.runWeeklyScan();
        return { ran: true, ...result };
    }

    async runWeeklyScan(): Promise<{ ok: true; created: number; skipped: number; emailed: number; emailFailed: number }> {
        const rec = await this.buildRecommendations();

        const suppliers = await this.prisma.supplier.findMany();
        const suppliersById = new Map(suppliers.map((s) => [s.supplier_id, s]));

        const windowDays = (await this.settings.getNumber("PURCHASING_DUPLICATE_WINDOW_DAYS")) ?? 1;
        const cutoff = addDays(startOfTodayUtc(), -windowDays);
        const openStatuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_OWNER"];
        const recentActions = await this.prisma.ownerAction.findMany({
            where: { category: "PURCHASING_RECOMMENDATION", status: { in: openStatuses }, created_at: { gte: cutoff } },
            select: { owner_action_id: true },
        });
        const recentActionIds = new Set(recentActions.map((a) => a.owner_action_id));
        const recentBatches = await this.prisma.purchasingBatch.findMany({
            where: { owner_action_id: { in: [...recentActionIds] } },
            select: { supplier_id: true },
        });
        const recentSupplierIds = new Set(recentBatches.map((b) => b.supplier_id || "__diagnostic__"));

        let created = 0;
        let skipped = 0;
        let emailed = 0;
        let emailFailed = 0;
        const itemInfo = await this.orderItemInfo(rec.supplierBatches);
        const staleDays = (await this.settings.getNumber("STOCKTAKE_STALE_DAYS")) ?? 7;

        for (const [supplierId, lines] of Object.entries(rec.supplierBatches)) {
            if (recentSupplierIds.has(supplierId)) {
                skipped++;
                continue;
            }
            const supplier = suppliersById.get(supplierId);
            if (!supplier) continue;
            const batchId = await this.createPurchasingBatch(supplierId, supplier, lines, false);
            created++;
            if (await this.emailOrder(batchId, supplier, lines, itemInfo.get(supplierId) ?? new Map(), staleDays)) emailed++;
            else emailFailed++;
        }

        if (rec.diagnosticLines.length) {
            if (recentSupplierIds.has("__diagnostic__")) {
                skipped++;
            } else {
                await this.createPurchasingBatch(null, null, rec.diagnosticLines, true);
                created++;
            }
        }

        this.logger.log(`Purchasing scan: ${created} batch(es) created, ${skipped} skipped (duplicate window), ${emailed} order(s) emailed, ${emailFailed} not emailed`);
        return { ok: true, created, skipped, emailed, emailFailed };
    }

    private async createPurchasingBatch(
        supplierId: string | null,
        supplier: Supplier | null,
        lines: (RecommendationLine | DiagnosticLine)[],
        isDiagnostic: boolean,
    ): Promise<string> {
        return this.prisma.$transaction(async (tx) => {
            const ownerAction = await tx.ownerAction.create({
                data: {
                    category: "PURCHASING_RECOMMENDATION",
                    title: isDiagnostic ? "Purchasing — setup needed" : `Purchasing recommendation — ${supplier!.name}`,
                    status: "OPEN",
                    priority: "NORMAL",
                },
            });
            const batch = await tx.purchasingBatch.create({
                data: {
                    owner_action_id: ownerAction.owner_action_id,
                    supplier_id: supplierId,
                    order_output_method: supplier?.order_output_method ?? null,
                },
            });
            const lineRows = lines.map((line) => ({
                purchasing_batch_id: batch.purchasing_batch_id,
                stock_item_id: line.stockItemId,
                total_shortfall: "totalShortfall" in line ? line.totalShortfall : null,
                pack_size: "packSize" in line ? line.packSize : null,
                order_multiple: "orderMultiple" in line ? line.orderMultiple : null,
                recommended_packs: "recommendedPacks" in line ? line.recommendedPacks : null,
                recommended_qty: "recommendedQty" in line ? line.recommendedQty : null,
                flags: line.flags.join(","),
            }));
            if (lineRows.length) await tx.purchasingBatchLine.createMany({ data: lineRows });
            return batch.purchasing_batch_id;
        });
    }

    /** The owner's address(es): every active ADMIN user (the owners, as set on the Staff table). */
    async orderRecipients(): Promise<string> {
        const admins = await this.prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { email: true } });
        return admins.map((a) => a.email).join(", ");
    }

    /** Supplier code / description / case unit for every ordered item, from that supplier's item map. */
    private async orderItemInfo(supplierBatches: Record<string, RecommendationLine[]>): Promise<Map<string, Map<string, OrderItemInfo>>> {
        const supplierIds = Object.keys(supplierBatches);
        if (!supplierIds.length) return new Map();
        const [items, maps] = await Promise.all([
            this.prisma.stockItem.findMany({ where: { stock_item_id: { in: Object.values(supplierBatches).flat().map((l) => l.stockItemId) } } }),
            this.prisma.supplierItemMap.findMany({ where: { supplier_id: { in: supplierIds }, active: true } }),
        ]);
        const itemById = new Map(items.map((i) => [i.stock_item_id, i]));
        const out = new Map<string, Map<string, OrderItemInfo>>();
        for (const m of maps) {
            const item = itemById.get(m.stock_item_id);
            if (!item) continue;
            const perSupplier = out.get(m.supplier_id) ?? new Map<string, OrderItemInfo>();
            perSupplier.set(m.stock_item_id, { name: item.name, countUnit: item.count_unit ?? "", supplierCode: m.supplier_code ?? "", supplierDescription: m.supplier_description ?? "", caseUnit: m.case_unit ?? "" });
            out.set(m.supplier_id, perSupplier);
        }
        return out;
    }

    /** Emails the drafted order to the owner and records the outcome on the batch. Never throws: a mail problem must not lose the batch. */
    private async emailOrder(batchId: string, supplier: Supplier, lines: RecommendationLine[], items: Map<string, OrderItemInfo>, staleDays: number): Promise<boolean> {
        try {
            const to = await this.orderRecipients();
            if (!to) throw new Error("No owner email to send to: there is no active user with the Admin role on the Staff table.");
            const mail = buildOrderEmail({ name: supplier.name, contactEmail: supplier.contact_email, orderOutputMethod: supplier.order_output_method ?? "" }, lines, items, toDateStr(new Date()), staleDays);
            await this.mailer.sendMail({ to, ...mail });
            await this.prisma.purchasingBatch.update({ where: { purchasing_batch_id: batchId }, data: { emailed_at: new Date(), emailed_to: to, email_error: null } });
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Purchasing: could not email the ${supplier.name} order: ${message}`);
            await this.prisma.purchasingBatch.update({ where: { purchasing_batch_id: batchId }, data: { email_error: message.slice(0, 500) } }).catch(() => undefined);
            return false;
        }
    }

    /**
     * Orchestrates trigger checks across every stock_item_par row (grouped
     * by stock_item_id, checked per its kiosk_id) plus every active
     * supplier_item_map'd stock item with zero stock_item_par rows at all
     * (real missing-setup case). Returns supplier-grouped consolidated
     * lines (spec 20.7) plus a diagnostic list for items with no resolvable
     * supplier or no par at all anywhere. Pure/read-only — no writes.
     */
    private async buildRecommendations(): Promise<{ supplierBatches: Record<string, RecommendationLine[]>; diagnosticLines: DiagnosticLine[] }> {
        const [kiosks, stockItems, parRows, supplierMaps, suppliers, allMovements] = await Promise.all([
            this.prisma.kiosk.findMany({ where: { active: true } }),
            loadStocktakeItems(this.prisma),
            this.prisma.stockItemPar.findMany(),
            this.prisma.supplierItemMap.findMany({ where: { active: true } }),
            this.prisma.supplier.findMany({ where: { active: true } }),
            this.prisma.stockMovement.findMany(),
        ]);
        const activeKioskIds = new Set(kiosks.map((k: Kiosk) => k.kiosk_id));

        const parByItem = new Map<string, Map<string, StockItemPar>>();
        for (const p of parRows) {
            if (!activeKioskIds.has(p.kiosk_id)) continue;
            if (!parByItem.has(p.stock_item_id)) parByItem.set(p.stock_item_id, new Map());
            parByItem.get(p.stock_item_id)!.set(p.kiosk_id, p);
        }

        const supplierMapsByItem = new Map<string, SupplierItemMap[]>();
        for (const m of supplierMaps) {
            if (!supplierMapsByItem.has(m.stock_item_id)) supplierMapsByItem.set(m.stock_item_id, []);
            supplierMapsByItem.get(m.stock_item_id)!.push(m);
        }
        const suppliersById = new Map(suppliers.map((s: Supplier) => [s.supplier_id, s]));

        const movementsByKiosk = new Map<string, StockMovement[]>();
        for (const m of allMovements) {
            if (!movementsByKiosk.has(m.kiosk_id)) movementsByKiosk.set(m.kiosk_id, []);
            movementsByKiosk.get(m.kiosk_id)!.push(m);
        }

        const staleDays = (await this.settings.getNumber("STOCKTAKE_STALE_DAYS")) ?? 7;
        const today = startOfTodayUtc();
        const confirmedCounts = await loadConfirmedCounts(this.prisma as never, [...activeKioskIds]);

        const lines: RecommendationLine[] = [];
        const diagnosticLines: DiagnosticLine[] = [];

        for (const item of stockItems) {
            const itemPars = parByItem.get(item.stock_item_id) ?? new Map<string, StockItemPar>();
            const kioskIdsWithPar = [...itemPars.keys()];
            const supplierResult = this.resolveSupplierForItem(item.stock_item_id, supplierMapsByItem, suppliersById);

            if (kioskIdsWithPar.length === 0) {
                if (supplierResult.ambiguous) {
                    diagnosticLines.push({ stockItemId: item.stock_item_id, flags: ["AMBIGUOUS_SUPPLIER"] });
                } else if (supplierResult.supplier && supplierResult.supplier.order_output_method !== "MANUAL") {
                    diagnosticLines.push({ stockItemId: item.stock_item_id, flags: ["SET_PAR"] });
                }
                continue;
            }

            const override = castlebayPacksOverride(supplierResult.supplier?.name);
            let totalShortfall = 0;
            let castlebayPacks = 0;
            let anyTriggered = false;
            let anyStale = false;
            let anyAwaitStocktake = false;

            for (const kioskId of kioskIdsWithPar) {
                const movements = movementsByKiosk.get(kioskId) ?? [];
                const confirmedOn = confirmedCounts.get(kioskId)?.get(item.stock_item_id) ?? null;
                const trigger = computeItemTrigger(item.stock_item_id, itemPars.get(kioskId) ?? null, movements, confirmedOn !== null);
                if (trigger.flag === "AWAIT_STOCKTAKE") anyAwaitStocktake = true;
                if (!trigger.triggered) continue;
                anyTriggered = true;
                if (override !== null) castlebayPacks += override;
                else totalShortfall += trigger.shortfall;
                const countDate = stockCountDate(item.stock_item_id, movements, confirmedOn);
                const daysSince = countDate ? Math.floor((today.getTime() - countDate.getTime()) / 86400000) : Infinity;
                if (daysSince > staleDays) anyStale = true;
            }

            if (!anyTriggered) {
                if (anyAwaitStocktake && supplierResult.supplier && supplierResult.supplier.order_output_method !== "MANUAL") {
                    diagnosticLines.push({ stockItemId: item.stock_item_id, flags: ["AWAIT_STOCKTAKE"] });
                }
                continue;
            }

            if (!supplierResult.supplier) {
                diagnosticLines.push({ stockItemId: item.stock_item_id, flags: [supplierResult.ambiguous ? "AMBIGUOUS_SUPPLIER" : "NO_SUPPLIER"] });
                continue;
            }
            if (supplierResult.supplier.order_output_method === "MANUAL") continue;

            const packSize = Number(supplierResult.mapping!.case_multiple) || 1;
            const orderMultiple = Number(supplierResult.mapping!.order_multiple) || 1;
            const flags: string[] = [];
            if (anyStale) flags.push("STALE");

            let recommendedPacks: number;
            if (override !== null) {
                recommendedPacks = castlebayPacks;
                flags.push("CASTLEBAY_OVERRIDE");
            } else {
                recommendedPacks = applyPackRounding(totalShortfall, packSize, orderMultiple);
            }

            lines.push({
                stockItemId: item.stock_item_id,
                supplierId: supplierResult.supplier.supplier_id,
                totalShortfall,
                packSize,
                orderMultiple,
                recommendedPacks,
                recommendedQty: recommendedPacks * packSize,
                flags,
            });
        }

        const supplierBatches: Record<string, RecommendationLine[]> = {};
        for (const line of lines) (supplierBatches[line.supplierId] ??= []).push(line);

        return { supplierBatches, diagnosticLines };
    }

    /** Zero active mappings -> no recommendation possible. More than one -> AMBIGUOUS_SUPPLIER, not guessed. */
    private resolveSupplierForItem(
        stockItemId: string,
        supplierMapsByItem: Map<string, SupplierItemMap[]>,
        suppliersById: Map<string, Supplier>,
    ): { supplier: Supplier | null; mapping: SupplierItemMap | null; ambiguous: boolean } {
        const maps = supplierMapsByItem.get(stockItemId) ?? [];
        if (maps.length === 0) return { supplier: null, mapping: null, ambiguous: false };
        if (maps.length > 1) return { supplier: null, mapping: null, ambiguous: true };
        const mapping = maps[0]!;
        return { supplier: suppliersById.get(mapping.supplier_id) ?? null, mapping, ambiguous: false };
    }
}
