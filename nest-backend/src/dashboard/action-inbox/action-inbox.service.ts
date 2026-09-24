import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { OwnerActionStateService, RESOLVED_STATUSES } from "./owner-action-state.service.js";
import { computeItemTrigger } from "../../common/purchasing-trigger.util.js";
import type { Kiosk, OwnerAction, Prisma, StockItem, User } from "@prisma/client";

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, NORMAL: 1, LOW: 2 };

export type BootstrapActionInboxFilters = {
    status?: string;
    category?: string;
    priority?: string;
    kioskId?: string;
    includeClosed?: boolean;
    page?: number;
    pageSize?: number;
};

/**
 * Owner-facing queue/triage logic for `owner_action` — port of
 * backend/dashboard/ActionInbox.js's generic (non-category-specific)
 * paths. Category approval flows live in their own services (see
 * StocktakeReviewService, StockTransferReviewService,
 * InvoiceReviewService, AuditReviewService) — this one handles the list,
 * the detail modal's per-category joins, and generic triage edits.
 */
@Injectable()
export class ActionInboxService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly ownerActionState: OwnerActionStateService,
    ) {}

    /**
     * Everything the inbox LIST needs in one call. Deliberately does NOT
     * embed category-specific linked data or activity_log history — those
     * are real joins across other tables and would make this call slower
     * forever as history piles up; getActionDetail fetches that, scoped
     * to one action, only when a card is actually opened.
     *
     * Filtering happens in the `where` clause (DB-side, not fetch-then-
     * filter) and the response is paginated — only the current page's rows
     * cross the wire. `counts` is intentionally computed from the whole
     * table via a separate groupBy, independent of the active filters —
     * it's the portfolio-wide overview badges, not a "matches your filter"
     * count, so it can't be derived from the (now filtered) `rows` list.
     */
    async bootstrap(filters: BootstrapActionInboxFilters = {}) {
        const page = Math.max(1, Math.floor(filters.page ?? 1));
        const pageSize = Math.min(200, Math.max(1, Math.floor(filters.pageSize ?? 25)));

        const where: Prisma.OwnerActionWhereInput = {};
        if (filters.status) where.status = filters.status;
        else if (!filters.includeClosed) where.status = { notIn: RESOLVED_STATUSES };
        if (filters.category) where.category = filters.category;
        if (filters.priority) where.priority = filters.priority;
        if (filters.kioskId) where.kiosk_id = filters.kioskId;

        // Urgent count is scoped to OPEN items only (never includes
        // resolved/closed ones, regardless of includeClosed) — it's meant
        // to answer "how many things need my attention right now," not a
        // historical tally, so it can't reuse the byStatus/byCategory
        // groupBys above (those are intentionally whole-table).
        const [filteredRows, statusGroups, categoryGroups, urgentOpenCount, allKiosks, allUsers, allStockItems] = await Promise.all([
            this.prisma.ownerAction.findMany({ where }),
            this.prisma.ownerAction.groupBy({ by: ["status"], _count: { _all: true } }),
            this.prisma.ownerAction.groupBy({ by: ["category"], _count: { _all: true } }),
            this.prisma.ownerAction.count({ where: { priority: "URGENT", status: { notIn: RESOLVED_STATUSES } } }),
            this.tableCache.getAll<Kiosk>("kiosk"),
            this.tableCache.getAll<User>("user"),
            this.tableCache.getAll<StockItem>("stock_item"),
        ]);

        const counts = { byStatus: {} as Record<string, number>, byCategory: {} as Record<string, number>, urgentOpen: urgentOpenCount };
        for (const g of statusGroups) counts.byStatus[g.status] = g._count._all;
        for (const g of categoryGroups) counts.byCategory[g.category] = g._count._all;

        // Priority tier first (URGENT above NORMAL above LOW — the whole
        // point of a triage inbox), newest-created first within a tier —
        // this was ascending (oldest first) before, which buried today's
        // new items under whatever had been sitting open the longest.
        const sorted = [...filteredRows].sort(
            (a: OwnerAction, b: OwnerAction) =>
                (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || b.created_at.getTime() - a.created_at.getTime(),
        );
        const totalRows = sorted.length;
        const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
        const kioskNameById = new Map(allKiosks.map((k) => [k.kiosk_id, k.name]));

        return {
            rows: pageRows.map((r) => ({ ...r, kioskName: (r.kiosk_id && kioskNameById.get(r.kiosk_id)) || r.kiosk_id })),
            totalRows,
            page,
            pageSize,
            counts,
            kiosks: allKiosks.filter((k) => k.active).map((k) => ({ id: k.kiosk_id, name: k.name })),
            users: allUsers.map((u) => ({ id: u.user_id, name: u.name })),
            stockItems: allStockItems.filter((s) => s.active).map((s) => ({ id: s.stock_item_id, name: s.name, unit: s.count_unit })),
        };
    }

    /**
     * Everything one card's detail modal needs — the action's own fields,
     * activity_log history, and category-specific linked data, fetched
     * fresh on every open. Self-sufficient (never relies on the caller
     * already having the row from a `bootstrap` list call) since with
     * server-side pagination a deep-linked or just-changed action may not
     * be on whatever page the list last loaded.
     */
    async getActionDetail(ownerActionId: string) {
        const [action, activity, allKiosks] = await Promise.all([
            this.prisma.ownerAction.findUnique({ where: { owner_action_id: ownerActionId } }),
            this.prisma.activityLog.findMany({ where: { owner_action_id: ownerActionId }, orderBy: { changed_at: "asc" } }),
            this.tableCache.getAll<Kiosk>("kiosk"),
        ]);
        if (!action) throw new NotFoundException("Action not found.");

        const kioskNameById = new Map(allKiosks.map((k) => [k.kiosk_id, k.name]));
        const out: Record<string, unknown> = {
            ...action,
            kioskName: (action.kiosk_id && kioskNameById.get(action.kiosk_id)) || action.kiosk_id,
            activity,
        };
        const submissionId = action.source_submission_id;

        switch (action.category) {
            case "HELP_ISSUE":
                out.request = submissionId ? await this.prisma.request.findFirst({ where: { submission_id: submissionId } }) : null;
                break;

            case "STOCKTAKE_REVIEW": {
                const header = submissionId ? await this.prisma.stocktakeHeader.findFirst({ where: { submission_id: submissionId } }) : null;
                out.stocktakeHeader = header ?? null;
                if (header) {
                    const lines = await this.prisma.stocktakeLine.findMany({ where: { stocktake_header_id: header.stocktake_header_id } });
                    const items = await this.tableCache.getAll<StockItem>("stock_item");
                    const itemById = new Map(items.map((i) => [i.stock_item_id, i]));
                    out.stocktakeLines = lines.map((l) => ({ ...l, stockItemName: itemById.get(l.stock_item_id)?.name ?? l.stock_item_id }));
                } else {
                    out.stocktakeLines = [];
                }
                break;
            }

            case "TRANSFER_APPROVAL":
            case "TRANSFER_APPLY": {
                const transfers = submissionId ? await this.prisma.stockTransfer.findMany({ where: { submission_id: submissionId } }) : [];
                const items = await this.tableCache.getAll<StockItem>("stock_item");
                const itemById = new Map(items.map((i) => [i.stock_item_id, i]));
                out.transfers = transfers.map((t) => ({ ...t, stockItemName: itemById.get(t.stock_item_id)?.name ?? t.stock_item_id }));
                break;
            }

            case "INVOICE_REVIEW": {
                const header = submissionId ? await this.prisma.deliveryHeader.findFirst({ where: { submission_id: submissionId } }) : null;
                out.deliveryHeader = header ?? null;
                if (header) {
                    const [supplier, files, lines] = await Promise.all([
                        this.prisma.supplier.findUnique({ where: { supplier_id: header.supplier_id } }),
                        this.prisma.deliveryFile.findMany({ where: { delivery_header_id: header.delivery_header_id } }),
                        this.prisma.invoiceLine.findMany({ where: { delivery_header_id: header.delivery_header_id } }),
                    ]);
                    const items = await this.tableCache.getAll<StockItem>("stock_item");
                    const itemById = new Map(items.map((i) => [i.stock_item_id, i]));
                    out.supplierName = supplier?.name ?? "";
                    out.deliveryFiles = files;
                    out.invoiceLines = lines.map((l) => ({ ...l, stockItemName: l.stock_item_id ? (itemById.get(l.stock_item_id)?.name ?? "") : "" }));
                } else {
                    out.supplierName = "";
                    out.deliveryFiles = [];
                    out.invoiceLines = [];
                }
                break;
            }

            case "AUDIT_REVIEW": {
                const response = submissionId ? await this.prisma.auditResponse.findFirst({ where: { submission_id: submissionId } }) : null;
                out.auditResponse = response ?? null;
                if (response) {
                    const answers = await this.prisma.auditAnswer.findMany({ where: { audit_response_id: response.audit_response_id } });
                    // One findMany for every question + one for every
                    // section, not one findUnique of each per answer — a
                    // real audit has enough questions (59 in this dataset)
                    // that the old per-answer round trips were a real N+1,
                    // the same class of thing that made stocktake/fridge-
                    // count slow before those were fixed the same way.
                    const [questions, correctiveActions] = await Promise.all([
                        this.prisma.auditQuestion.findMany({ where: { audit_question_id: { in: answers.map((a) => a.audit_question_id) } } }),
                        this.prisma.correctiveAction.findMany({ where: { audit_response_id: response.audit_response_id } }),
                    ]);
                    const sectionIds = [...new Set(questions.map((q) => q.audit_section_id).filter((id): id is string => !!id))];
                    const sections = sectionIds.length
                        ? await this.prisma.auditSection.findMany({ where: { audit_section_id: { in: sectionIds } } })
                        : [];
                    const questionById = new Map(questions.map((q) => [q.audit_question_id, q]));
                    const sectionById = new Map(sections.map((s) => [s.audit_section_id, s]));

                    out.auditAnswers = answers.map((a) => {
                        const q = questionById.get(a.audit_question_id);
                        const section = q?.audit_section_id ? sectionById.get(q.audit_section_id) : null;
                        return {
                            ...a,
                            questionText: q?.question_text ?? "",
                            sectionName: section?.name ?? "",
                            passAnswer: q?.pass_answer ?? "",
                            critical: q?.critical === true,
                            evidenceRequired: q?.evidence_required === true,
                            weight: q?.weight ?? null,
                        };
                    });

                    // The "applicable corrections" the final result needs —
                    // one corrective_action per owner-confirmed failure,
                    // already created by AuditReviewService.reviewAnswer as
                    // each answer gets decided. Attaching them here means
                    // the final-result view never needs a second call.
                    out.correctiveActions = correctiveActions.map((ca) => ({
                        ...ca,
                        questionText: questionById.get(ca.audit_question_id)?.question_text ?? "",
                    }));
                } else {
                    out.auditAnswers = [];
                    out.correctiveActions = [];
                }
                break;
            }

            case "AUDIT_CORRECTION_REVIEW": {
                const ac = submissionId ? await this.prisma.auditCorrection.findFirst({ where: { submission_id: submissionId } }) : null;
                if (ac) {
                    const ca = await this.prisma.correctiveAction.findUnique({ where: { corrective_action_id: ac.corrective_action_id } });
                    const question = ca ? await this.prisma.auditQuestion.findUnique({ where: { audit_question_id: ca.audit_question_id } }) : null;
                    out.auditCorrection = { ...ac, correctiveAction: ca ?? null, questionText: question?.question_text ?? "" };
                } else {
                    out.auditCorrection = null;
                }
                break;
            }

            case "DAMAGE_REVIEW": {
                const m = submissionId ? await this.prisma.productMovement.findFirst({ where: { submission_id: submissionId, movement_type: "DAMAGE" } }) : null;
                if (m) {
                    const product = await this.prisma.product.findUnique({ where: { product_id: m.product_id } });
                    out.damageMovement = { ...m, productName: product?.name ?? m.product_id };
                } else {
                    out.damageMovement = null;
                }
                break;
            }

            case "PURCHASING_RECOMMENDATION": {
                const batch = await this.prisma.purchasingBatch.findFirst({ where: { owner_action_id: action.owner_action_id } });
                out.purchasingBatch = batch ?? null;
                out.purchasingSupplierName = "";
                out.purchasingLines = [];
                if (!batch) break;

                const supplier = batch.supplier_id ? await this.prisma.supplier.findUnique({ where: { supplier_id: batch.supplier_id } }) : null;
                out.purchasingSupplierName = supplier?.name ?? "";

                // Per-kiosk breakdown isn't stored (see PurchasingScanService) —
                // it's re-derived live from current stock_item_par +
                // stock_movement data every time this action is opened, using
                // the exact same computeItemTrigger the weekly scan itself uses.
                //
                // kiosks fetched first (cached, cheap) so the movement query
                // below can filter to active kiosks — an unfiltered
                // stockMovement.findMany() here used to pull every movement
                // row ever recorded, across every kiosk including inactive
                // ones, on every single open of this action.
                const kiosks = await this.tableCache.getAll<Kiosk>("kiosk");
                const activeKiosks = kiosks.filter((k) => k.active);
                const activeKioskIds = activeKiosks.map((k) => k.kiosk_id);

                const [batchLines, allParRows, allMovements, items] = await Promise.all([
                    this.prisma.purchasingBatchLine.findMany({ where: { purchasing_batch_id: batch.purchasing_batch_id } }),
                    this.prisma.stockItemPar.findMany(),
                    this.prisma.stockMovement.findMany({ where: { kiosk_id: { in: activeKioskIds } } }),
                    this.tableCache.getAll<StockItem>("stock_item"),
                ]);
                const itemById = new Map(items.map((i) => [i.stock_item_id, i]));
                const movementsByKiosk = new Map<string, typeof allMovements>();
                for (const m of allMovements) {
                    if (!movementsByKiosk.has(m.kiosk_id)) movementsByKiosk.set(m.kiosk_id, []);
                    movementsByKiosk.get(m.kiosk_id)!.push(m);
                }
                const parByItemKiosk = new Map<string, (typeof allParRows)[number]>();
                for (const p of allParRows) parByItemKiosk.set(`${p.stock_item_id}|${p.kiosk_id}`, p);

                out.purchasingLines = batchLines.map((line) => {
                    const item = itemById.get(line.stock_item_id);
                    const kioskBreakdown = activeKiosks.map((k) => {
                        const parRow = parByItemKiosk.get(`${line.stock_item_id}|${k.kiosk_id}`) ?? null;
                        const trigger = computeItemTrigger(line.stock_item_id, parRow, movementsByKiosk.get(k.kiosk_id) ?? []);
                        return {
                            kioskId: k.kiosk_id,
                            kioskName: k.name,
                            currentStock: trigger.currentStock,
                            shortfall: trigger.shortfall,
                            triggered: trigger.triggered,
                            flag: trigger.flag,
                        };
                    });
                    return {
                        ...line,
                        stockItemName: item?.name ?? line.stock_item_id,
                        unit: item?.count_unit ?? "",
                        flagList: line.flags ? line.flags.split(",").filter((f) => f) : [],
                        kioskBreakdown,
                    };
                });
                break;
            }

            default:
                break;
        }

        return out;
    }

    /**
     * Generic triage edit — status/priority/assigned_to/owner_note/due_date.
     * Writes one real activity_log row per changed field, sets/clears
     * resolved_at when status enters/leaves a resolved-type status.
     */
    async updateOwnerAction(ownerActionId: string, changes: Record<string, unknown>, changedBy: string) {
        const existing = await this.prisma.ownerAction.findUnique({ where: { owner_action_id: ownerActionId } });
        if (!existing) throw new NotFoundException("Action not found.");

        const editable = ["status", "priority", "assigned_to", "owner_note", "due_date"] as const;
        const patch: Record<string, unknown> = {};
        const logEntries: { field: string; old: unknown; new: unknown }[] = [];

        for (const f of editable) {
            if (!(f in changes)) continue;
            const oldVal = existing[f as keyof typeof existing];
            const newVal = changes[f];
            if (String(oldVal ?? "") === String(newVal ?? "")) continue;
            patch[f] = newVal;
            logEntries.push({ field: f, old: oldVal, new: newVal });
        }
        if (!logEntries.length) return { row: existing };

        if ("status" in patch) {
            patch.resolved_at = RESOLVED_STATUSES.includes(patch.status as string) ? new Date() : null;
        }

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.ownerAction.update({ where: { owner_action_id: ownerActionId }, data: patch });
            for (const l of logEntries) {
                await this.ownerActionState.logActivity(tx, ownerActionId, changedBy, l.field, l.old, l.new, (changes.logNote as string) || undefined);
            }
            return { row: updated };
        });
    }

    /**
     * Editable fields on a `request` row (owner-side triage — staff-entered
     * fields are immutable historical record). Logs against the
     * owner_action that surfaced this request (activity_log is scoped to
     * owner_action, not request, by design).
     */
    async updateRequest(requestId: string, changes: Record<string, unknown>, ownerActionId: string | undefined, changedBy: string) {
        const existing = await this.prisma.request.findUnique({ where: { request_id: requestId } });
        if (!existing) throw new BadRequestException("Request not found.");

        const editable = ["owner_status", "owner_priority", "assigned_to", "due_date", "owner_note", "resolution_note"] as const;
        const patch: Record<string, unknown> = {};
        const logEntries: { field: string; old: unknown; new: unknown }[] = [];

        for (const f of editable) {
            if (!(f in changes)) continue;
            const oldVal = existing[f as keyof typeof existing];
            const newVal = changes[f];
            if (String(oldVal ?? "") === String(newVal ?? "")) continue;
            patch[f] = newVal;
            logEntries.push({ field: f, old: oldVal, new: newVal });
        }
        if (!logEntries.length) return { row: existing };

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.request.update({ where: { request_id: requestId }, data: patch });
            if (ownerActionId) {
                for (const l of logEntries) {
                    await this.ownerActionState.logActivity(tx, ownerActionId, changedBy, `request.${l.field}`, l.old, l.new);
                }
            }
            return { row: updated };
        });
    }
}
