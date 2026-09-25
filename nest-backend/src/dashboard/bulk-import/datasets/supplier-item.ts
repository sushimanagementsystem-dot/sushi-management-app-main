import { randomUUID } from "node:crypto";
import type { BulkDataset, ChangeSet, Db, Target } from "../bulk-import.types.js";
import { findItem, indexItems, loadStockTakeList, norm, num, text, type ItemIndex, type StockTakeItem } from "./shared.js";

type Supplier = { supplier_id: string; name: string };
type Map_ = { supplier_item_map_id: string; supplier_id: string; supplier_code: string | null; supplier_description: string | null; stock_item_id: string; case_unit: string | null; case_multiple: number | null; order_multiple: unknown; current_price: unknown; active: boolean };
type Ctx = { suppliers: Supplier[]; items: StockTakeItem[]; index: ItemIndex; maps: Map_[]; byId: Map<string, Map_>; itemName: Map<string, string> };

const findSupplier = (suppliers: Supplier[], v: unknown): Supplier | null => {
    const n = norm(v);
    if (!n) return null;
    return suppliers.find((s) => norm(s.supplier_id) === n) ?? suppliers.find((s) => norm(s.name) === n) ?? null;
};

const currentOf = (m: Map_ | null) => ({
    supplierCode: m?.supplier_code ?? null,
    description: m?.supplier_description ?? null,
    packSize: m?.case_multiple ?? null,
    orderMultiple: num(m?.order_multiple),
    price: num(m?.current_price),
    active: m ? m.active : null,
});

/**
 * Supplier Items: which Stock Take items each supplier sells, under their own code, in what pack size, at what price.
 * This is what turns a shortfall into a supplier order. A row is matched by its Row ID, or (blank Row ID) by supplier +
 * item: an existing mapping is updated, and only a supplier + item that has no mapping yet is created. Two mappings
 * for the same supplier and item are never created; when there is already more than one, the Row ID must say which.
 */
export const supplierItemDataset: BulkDataset<Ctx> = {
    id: "supplier_item_map",
    label: "Supplier Items",
    fileName: "supplier-items.xlsx",
    sheetName: "Supplier Items",
    description: "Each supplier's codes, pack sizes and prices for the Stock Take items. Add rows at the bottom for new items.",
    showOn: ["supplier"],
    invalidates: ["supplier_item_map"],
    detect: ["supplier", "supplierCode"],
    columns: [
        { key: "id", header: "Row ID", aliases: ["id", "map id", "supplier item id"], kind: "key", width: 38 },
        { key: "supplier", header: "Supplier", aliases: ["supplier name", "supplier id"], kind: "key", required: true, width: 16 },
        { key: "name", header: "Item", aliases: ["item name", "stock item", "stock item name"], kind: "key", width: 40 },
        { key: "code", header: "Item code", aliases: ["stock item code", "stock item id", "item id", "stock_item_id"], kind: "key", width: 11 },
        { key: "packUnit", header: "Pack", kind: "info", width: 12 },
        { key: "supplierCode", header: "Supplier code", aliases: ["supplier item code", "product code", "sku"], kind: "value", format: "text", width: 16 },
        { key: "description", header: "Supplier description", aliases: ["description", "supplier item"], kind: "value", format: "text", width: 40 },
        { key: "packSize", header: "Pack size", aliases: ["case multiple", "pack multiple", "units per pack"], kind: "value", format: "integer", min: 1, width: 10 },
        { key: "orderMultiple", header: "Order multiple", kind: "value", format: "number", min: 1, width: 14 },
        { key: "price", header: "Price", aliases: ["current price", "case price", "pack price"], kind: "value", format: "money", min: 0, width: 10 },
        { key: "active", header: "Active", kind: "value", format: "boolean", width: 8 },
    ],
    instructions: [
        "Existing supplier items are listed with their Row ID. Edit Supplier code, Supplier description, Pack size, Order multiple, Price or Active.",
        "To add an item a supplier sells, add a row at the bottom with Supplier and the Item code (see the 'Item codes' sheet) and fill in the values, leaving Row ID blank.",
        "Pack size is how many count units are in one pack the supplier sells: orders are rounded up to whole packs.",
        "A supplier + item that already exists is updated, never duplicated.",
    ],
    async load(db: Db) {
        const [suppliers, items, maps] = await Promise.all([db.supplier.findMany({ where: { active: true } }), loadStockTakeList(db), db.supplierItemMap.findMany()]);
        const all = await db.stockItem.findMany({ select: { stock_item_id: true, name: true } });
        return {
            suppliers: (suppliers as Supplier[]).sort((a, b) => a.name.localeCompare(b.name)),
            items,
            index: indexItems(items),
            maps: maps as Map_[],
            byId: new Map((maps as Map_[]).map((m) => [m.supplier_item_map_id, m])),
            itemName: new Map((all as { stock_item_id: string; name: string }[]).map((i) => [i.stock_item_id, i.name])),
        };
    },
    targets(ctx): Target[] {
        const supplierName = new Map(ctx.suppliers.map((s) => [s.supplier_id, s.name]));
        return ctx.maps
            .filter((m) => supplierName.has(m.supplier_id))
            .sort((a, b) => supplierName.get(a.supplier_id)!.localeCompare(supplierName.get(b.supplier_id)!) || String(a.supplier_description ?? "").localeCompare(String(b.supplier_description ?? "")))
            .map((m) => ({
                ref: m.supplier_item_map_id,
                label: { id: m.supplier_item_map_id, supplier: supplierName.get(m.supplier_id)!, name: ctx.itemName.get(m.stock_item_id) ?? m.stock_item_id, code: m.stock_item_id, packUnit: m.case_unit ?? "" },
                current: currentOf(m),
                exists: true,
            }));
    },
    resolve(raw, ctx) {
        const supplier = findSupplier(ctx.suppliers, raw.supplier);
        if (!supplier) return { error: `Supplier "${text(raw.supplier)}" is not an active supplier.`, unmatched: true };

        const id = text(raw.id);
        if (id) {
            const row = ctx.byId.get(id);
            if (!row) return { error: `Row ID "${id}" does not exist.`, unmatched: true };
            if (row.supplier_id !== supplier.supplier_id) return { error: `Row ID "${id}" belongs to a different supplier than ${supplier.name}.` };
            return { ref: id };
        }

        const found = findItem(ctx.index, { code: raw.code, name: raw.name });
        if (!("item" in found)) return found;
        const existing = ctx.maps.filter((m) => m.supplier_id === supplier.supplier_id && m.stock_item_id === found.item.stock_item_id);
        if (existing.length === 1) return { ref: existing[0]!.supplier_item_map_id };
        if (existing.length > 1) return { error: `${supplier.name} already has ${existing.length} rows for "${found.item.name}". Fill in the Row ID to say which one.` };
        const ref = `new|${supplier.supplier_id}|${found.item.stock_item_id}`;
        return { ref, create: { ref, label: { id: "", supplier: supplier.name, name: found.item.name, code: found.item.stock_item_id, packUnit: "" }, current: currentOf(null), exists: false } };
    },
    referenceSheets: (ctx) => [
        { name: "Item codes", rows: [["Item code", "Item", "Category", "Unit"], ...ctx.items.map((i) => [i.stock_item_id, i.name, i.categoryLabel, i.count_unit])] },
        { name: "Suppliers", rows: [["Supplier"], ...ctx.suppliers.map((s) => [s.name])] },
    ],
    async apply(db: Db, changes: ChangeSet[]) {
        const updates = changes.filter((c) => c.exists);
        if (updates.length) {
            const rows = updates.map((c) => c.merged);
            const ids = updates.map((c) => c.ref);
            const updated: number = await db.$executeRaw`
                UPDATE "supplier_item_map" AS m SET "supplier_code" = v.sc, "supplier_description" = v.sd, "case_multiple" = v.cm, "order_multiple" = v.om, "current_price" = v.pr, "active" = v.ac
                FROM (SELECT * FROM unnest(${ids}::text[], ${rows.map((r) => r.supplierCode ?? null)}::text[], ${rows.map((r) => r.description ?? null)}::text[], ${rows.map((r) => r.packSize ?? null)}::int[],
                      ${rows.map((r) => r.orderMultiple ?? null)}::numeric[], ${rows.map((r) => r.price ?? null)}::numeric[], ${rows.map((r) => r.active ?? true)}::boolean[])
                      AS t(id, sc, sd, cm, om, pr, ac)) AS v
                WHERE m."supplier_item_map_id" = v.id`;
            if (updated !== updates.length) throw new Error(`Expected to update ${updates.length} supplier items but updated ${updated}; nothing was saved.`);
        }
        const creates = changes.filter((c) => !c.exists);
        if (creates.length) {
            await db.supplierItemMap.createMany({
                data: creates.map((c) => {
                    const [, supplierId, stockItemId] = c.ref.split("|");
                    return {
                        supplier_item_map_id: randomUUID(),
                        supplier_id: supplierId,
                        stock_item_id: stockItemId,
                        supplier_code: (c.merged.supplierCode as string | null) ?? null,
                        supplier_description: (c.merged.description as string | null) ?? null,
                        case_multiple: (c.merged.packSize as number | null) ?? null,
                        order_multiple: (c.merged.orderMultiple as number | null) ?? null,
                        current_price: (c.merged.price as number | null) ?? null,
                        active: (c.merged.active as boolean | null) ?? true,
                    };
                }),
            });
        }
    },
};
