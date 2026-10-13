import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { PurchasingScanService } from "./purchasing-scan.service.js";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

const KIOSK_NAMES: Record<string, string> = { K01: "Limerick", K02: "Oranmore" };

/** A tiny in-memory database, just the tables the scan touches. */
function build(opts: { mailFails?: boolean; pendingStocktakes?: number; twoKiosks?: boolean } = {}) {
    const stockItems = [
        { stock_item_id: "S1", name: "KARAAGE", count_unit: "kg", active: true, stock_category_id: "SC04" },
        { stock_item_id: "S2", name: "CLING FILM", count_unit: "roll", active: true, stock_category_id: "SC05" },
        { stock_item_id: "S3", name: "MILK", count_unit: "L", active: true, stock_category_id: "SC04" },
        { stock_item_id: "S4", name: "NORI", count_unit: "pack", active: true, stock_category_id: "SC04" }, // counted at zero: no movement
        { stock_item_id: "FW1", name: "KARAAGE (waste)", count_unit: "100g", active: true, stock_category_id: "SC08" }, // Food Waste (per 100g): never ordered
    ];
    const par = (id: string, kiosk_id = "K01") => ({ stock_item_id: id, kiosk_id, target_par: 10, minimum_stock: null, safety_stock: null });
    const parRows = ["S1", "S2", "S3", "S4", "FW1"].map((id) => par(id));
    if (opts.twoKiosks) parRows.push(par("S1", "K02")); // the same Tazaki item also triggers at a second kiosk
    const suppliers = [
        { supplier_id: "SUP_T", name: "Tazaki", contact_email: "sales@tazaki.test", order_output_method: "ORDER_SHEET", order_sheet_template: null, active: true },
        { supplier_id: "SUP_V", name: "VSD", contact_email: null, order_output_method: "EMAIL_ORDER", order_sheet_template: null, active: true },
        { supplier_id: "SUP_M", name: "Supermarket", contact_email: null, order_output_method: "MANUAL", order_sheet_template: null, active: true },
    ];
    const maps = [
        { supplier_item_map_id: "M1", supplier_id: "SUP_T", stock_item_id: "S1", supplier_code: "Q0230A-IE", supplier_description: "Chicken Karaage 10x1kg", case_unit: "10x1kg", selling_unit: "", current_price: null, case_multiple: 10, order_multiple: null, active: true },
        { supplier_item_map_id: "M2", supplier_id: "SUP_V", stock_item_id: "S2", supplier_code: "V1", supplier_description: "Cling film", case_unit: "", selling_unit: "", current_price: null, case_multiple: 1, order_multiple: null, active: true },
        { supplier_item_map_id: "M3", supplier_id: "SUP_M", stock_item_id: "S3", supplier_code: "", supplier_description: "", case_unit: "", selling_unit: "", current_price: null, case_multiple: 1, order_multiple: null, active: true },
        { supplier_item_map_id: "M4", supplier_id: "SUP_T", stock_item_id: "S4", supplier_code: "N1", supplier_description: "Nori", case_unit: "", selling_unit: "", current_price: null, case_multiple: 1, order_multiple: null, active: true },
        { supplier_item_map_id: "M5", supplier_id: "SUP_T", stock_item_id: "FW1", supplier_code: "X", supplier_description: "waste item", case_unit: "", selling_unit: "", current_price: null, case_multiple: 1, order_multiple: null, active: true },
    ];
    const mv = (stock_item_id: string, qty: number, kiosk_id = "K01") => ({ stock_item_id, kiosk_id, movement_type: "DELIVERY_IN", direction: "IN", qty, movement_date: day("2026-09-20") });
    const movements = [mv("S1", 2), mv("S2", 1), mv("S3", 0.5), mv("FW1", 1)];
    if (opts.twoKiosks) movements.push(mv("S1", 3, "K02"));

    const kiosks = opts.twoKiosks ? [{ kiosk_id: "K01", active: true }, { kiosk_id: "K02", active: true }] : [{ kiosk_id: "K01", active: true }];

    const batches: Record<string, unknown>[] = [];
    const lines: Record<string, unknown>[] = [];
    const ownerActions: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const tx = {
        kiosk: { findUnique: async ({ where }: { where: { kiosk_id: string } }) => ({ kiosk_id: where.kiosk_id, name: KIOSK_NAMES[where.kiosk_id], supplier_store_name: null }) },
        ownerAction: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const row = { owner_action_id: `OA${ownerActions.length + 1}`, ...data };
                ownerActions.push(row);
                return row;
            },
        },
        purchasingBatch: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const row = { purchasing_batch_id: `B${batches.length + 1}`, ...data };
                batches.push(row);
                return row;
            },
        },
        purchasingBatchLine: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => void lines.push(...data) },
    };
    const prisma = {
        kiosk: { findMany: async () => kiosks.map((k) => ({ ...k, name: KIOSK_NAMES[k.kiosk_id], supplier_store_name: null })) },
        stockItem: {
            findMany: async (args: { where?: { active?: boolean; stock_category_id?: { in: string[] }; stock_item_id?: { in: string[] } } }) =>
                stockItems.filter((i) => (!args.where?.stock_category_id || args.where.stock_category_id.in.includes(i.stock_category_id)) && (!args.where?.stock_item_id || args.where.stock_item_id.in.includes(i.stock_item_id))),
        },
        enumOption: {
            findMany: async () => [
                { value: "SC04", label: "DRYSTORE - FOOD" },
                { value: "SC05", label: "DRYSTORE - PACKAGING" },
                { value: "SC08", label: "Food Waste (per 100g)" },
            ],
        },
        stockItemPar: { findMany: async () => parRows },
        supplierItemMap: { findMany: async (args: { where: { supplier_id?: { in: string[] } } }) => maps.filter((m) => !args.where.supplier_id || args.where.supplier_id.in.includes(m.supplier_id)) },
        supplier: { findMany: async () => suppliers },
        stockMovement: { findMany: async () => movements },
        stocktakeLine: { findMany: async () => [{ stock_item_id: "S4", stocktake_header: { kiosk_id: "K01", stocktake_date: day("2026-09-21") } }] },
        stocktakeHeader: { count: async () => opts.pendingStocktakes ?? 0 },
        ownerAction: { findMany: async () => [] },
        purchasingBatch: {
            findMany: async () => [],
            update: async ({ where, data }: { where: { purchasing_batch_id: string }; data: Record<string, unknown> }) => void updates.push({ id: where.purchasing_batch_id, ...data }),
        },
        user: { findMany: async () => [{ email: "owner@example.test" }, { email: "owner2@example.test" }] },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const settings = { getNumber: async (k: string) => (k === "STOCKTAKE_STALE_DAYS" ? 7 : 1), get: async () => null };
    const sent: { to: string; subject: string; html: string; attachments?: { filename: string; content: Buffer }[] }[] = [];
    const mailer = {
        sendMail: vi.fn(async (m: (typeof sent)[number]) => {
            if (opts.mailFails) throw new Error("Email is not configured");
            sent.push(m);
        }),
    };
    const svc = new PurchasingScanService(prisma as never, settings as never, mailer as never);
    return { svc, batches, lines, ownerActions, updates, sent, mailer };
}

describe("PurchasingScanService: drafted orders are emailed to the owner", () => {
    it("emails an Excel order sheet for a sheet supplier and a plain message for an email supplier, skips MANUAL and Food Waste items, and orders an item counted at zero", async () => {
        const { svc, batches, lines, ownerActions, sent, updates } = build();
        const result = await svc.runWeeklyScan();

        expect(result).toMatchObject({ created: 2, emailed: 2, emailFailed: 0 });
        expect(batches.map((b) => b.supplier_id).sort()).toEqual(["SUP_T", "SUP_V"]); // never SUP_M (MANUAL)
        // Each batch is tied to the kiosk it's for, not left combined/kiosk-less.
        expect(ownerActions.every((a) => a.kiosk_id === "K01")).toBe(true);
        expect(ownerActions.map((a) => a.title)).toEqual(expect.arrayContaining([expect.stringContaining("Limerick")]));
        const ordered = lines.map((l) => l.stock_item_id).sort();
        expect(ordered).toEqual(["S1", "S2", "S4"]); // S3 is MANUAL; FW1 is not a Stock Take item
        // S4 was counted at zero (no ledger movement) and still gets ordered: 10 needed, packs of 1.
        expect(lines.find((l) => l.stock_item_id === "S4")).toMatchObject({ recommended_packs: 10 });

        expect(sent).toHaveLength(2);
        for (const m of sent) expect(m.to).toBe("owner@example.test, owner2@example.test"); // the owner, never the supplier
        const sheetMail = sent.find((m) => m.subject.includes("Tazaki"))!;
        expect(sheetMail.attachments).toHaveLength(1);
        const grid = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(sheetMail.attachments![0]!.content, { type: "buffer" }).Sheets["Order"]!, { header: 1 });
        expect(grid.slice(1).map((r) => [r[0], r[3]])).toEqual([["Q0230A-IE", 1], ["N1", 10]]); // filled from the par levels, sorted by item
        expect(sent.find((m) => m.subject.includes("VSD"))!.attachments).toEqual([]);
        expect(updates.filter((u) => u.emailed_at instanceof Date)).toHaveLength(2);
    });

    it("drafts a separate batch and email per kiosk, not one combined order, when the same supplier triggers at more than one kiosk", async () => {
        const { svc, batches, lines, ownerActions, sent } = build({ twoKiosks: true });
        const result = await svc.runWeeklyScan();

        // Tazaki now triggers at both K01 and K02 (S1), plus K01-only S4; VSD is still just K01 (S2) — 3 batches.
        expect(result).toMatchObject({ created: 3, emailed: 3, emailFailed: 0 });

        const tazakiActions = ownerActions.filter((a) => (a.title as string).includes("Tazaki"));
        expect(tazakiActions).toHaveLength(2);
        expect(tazakiActions.map((a) => a.kiosk_id).sort()).toEqual(["K01", "K02"]);
        expect(tazakiActions.map((a) => a.title).sort()).toEqual(["Purchasing recommendation — Tazaki (Limerick)", "Purchasing recommendation — Tazaki (Oranmore)"]);

        const tazakiBatchIds = batches.filter((b) => b.supplier_id === "SUP_T").map((b) => b.purchasing_batch_id);
        expect(tazakiBatchIds).toHaveLength(2);
        const itemsOf = (id: unknown) => lines.filter((l) => l.purchasing_batch_id === id).map((l) => l.stock_item_id).sort();
        // K01's batch has both S1 and S4; K02's batch has only S1 — no par was set for S4 at K02.
        expect(tazakiBatchIds.map(itemsOf)).toEqual(expect.arrayContaining([["S1", "S4"], ["S1"]]));

        const tazakiSubjects = sent.filter((m) => m.subject.includes("Tazaki")).map((m) => m.subject).sort();
        expect(tazakiSubjects).toEqual([expect.stringContaining("Limerick"), expect.stringContaining("Oranmore")]);
    });

    it("keeps the batch and records why when the email cannot be sent", async () => {
        const { svc, batches, updates } = build({ mailFails: true });
        const result = await svc.runWeeklyScan();
        expect(result).toMatchObject({ created: 2, emailed: 0, emailFailed: 2 });
        expect(batches).toHaveLength(2);
        expect(updates.every((u) => u.email_error === "Email is not configured")).toBe(true);
    });

    it("after a stocktake confirmation it waits while another kiosk's stocktake is still waiting for review, then runs once", async () => {
        const waiting = build({ pendingStocktakes: 1 });
        expect(await waiting.svc.runAfterStocktakeConfirmed()).toEqual({ ran: false });
        expect(waiting.mailer.sendMail).not.toHaveBeenCalled();

        const ready = build({ pendingStocktakes: 0 });
        expect(await ready.svc.runAfterStocktakeConfirmed()).toMatchObject({ ran: true, created: 2, emailed: 2 });
    });
});
