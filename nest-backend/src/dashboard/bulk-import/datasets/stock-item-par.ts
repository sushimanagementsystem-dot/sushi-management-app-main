import type { BulkDataset, ChangeSet, Db, Target } from "../bulk-import.types.js";
import { findItem, findKiosk, indexItems, loadKiosks, loadStockTakeList, num, type ItemIndex, type KioskRow, type StockTakeItem } from "./shared.js";

type ParRow = { target_par: unknown; minimum_stock: unknown; safety_stock: unknown };
type Ctx = { kiosks: KioskRow[]; items: StockTakeItem[]; index: ItemIndex; pars: Map<string, ParRow> };

/**
 * Par levels per kiosk and Stock Take item: target par (what to refill up to), minimum stock (the order trigger) and
 * safety stock. These drive the automatic supplier orders. A par row that does not exist yet is created.
 */
export const stockItemParDataset: BulkDataset<Ctx> = {
    id: "stock_item_par",
    label: "Stock Item par levels",
    fileName: "stock-item-par-levels.xlsx",
    sheetName: "Par Levels",
    description: "Target, minimum and safety stock for every Stock Take item at every kiosk.",
    showOn: ["stock_item"],
    invalidates: ["stock_item_par"],
    detect: ["kiosk", "target_par"],
    columns: [
        { key: "kiosk", header: "Kiosk", aliases: ["kiosk id", "kiosk code"], kind: "key", required: true, width: 8 },
        { key: "kioskName", header: "Kiosk name", kind: "info", width: 22 },
        { key: "category", header: "Category", kind: "info", width: 26 },
        { key: "name", header: "Item", aliases: ["item name", "stock item", "stock item name"], kind: "key", width: 40 },
        { key: "unit", header: "Unit", aliases: ["count unit"], kind: "info", width: 8 },
        { key: "target_par", header: "Target par", aliases: ["target", "par"], kind: "value", format: "number", min: 0, width: 12 },
        { key: "minimum_stock", header: "Minimum stock", aliases: ["minimum", "min"], kind: "value", format: "number", min: 0, width: 14 },
        { key: "safety_stock", header: "Safety stock", aliases: ["safety"], kind: "value", format: "number", min: 0, width: 12 },
        { key: "code", header: "Item code", aliases: ["code", "item id", "stock item id", "stock_item_id"], kind: "key", width: 11 },
    ],
    instructions: [
        "One row per kiosk and Stock Take item. Fill Target par (stock to refill up to), Minimum stock (order when stock falls to this or below) and Safety stock (extra buffer).",
        "If Minimum stock is left blank, the order is triggered at Target par. Safety stock is added on top of the target when ordering.",
        "Use the same unit as the Unit column. Blank cells keep the current value.",
    ],
    async load(db: Db) {
        const [kiosks, items, rows] = await Promise.all([loadKiosks(db), loadStockTakeList(db), db.stockItemPar.findMany()]);
        const pars = new Map<string, ParRow>();
        for (const r of rows as (ParRow & { kiosk_id: string; stock_item_id: string })[]) pars.set(`${r.kiosk_id}|${r.stock_item_id}`, r);
        return { kiosks, items, index: indexItems(items), pars };
    },
    targets: (ctx): Target[] =>
        ctx.kiosks.flatMap((k) =>
            ctx.items.map((i) => {
                const p = ctx.pars.get(`${k.kiosk_id}|${i.stock_item_id}`);
                return {
                    ref: `${k.kiosk_id}|${i.stock_item_id}`,
                    label: { kiosk: k.kiosk_id, kioskName: k.name, category: i.categoryLabel, name: i.name, unit: i.count_unit, code: i.stock_item_id },
                    current: { target_par: num(p?.target_par), minimum_stock: num(p?.minimum_stock), safety_stock: num(p?.safety_stock) },
                    exists: !!p,
                };
            }),
        ),
    resolve(raw, ctx) {
        const kiosk = findKiosk(ctx.kiosks, raw.kiosk);
        if (!kiosk) return { error: `Kiosk "${String(raw.kiosk).trim()}" is not an active kiosk.`, unmatched: true };
        const found = findItem(ctx.index, { code: raw.code, name: raw.name, unit: raw.unit, category: raw.category });
        if (!("item" in found)) return found;
        return { ref: `${kiosk.kiosk_id}|${found.item.stock_item_id}` };
    },
    check(m) {
        const min = m.minimum_stock as number | null;
        const target = m.target_par as number | null;
        return min !== null && target !== null && min > target ? `Minimum stock (${min}) is above Target par (${target}).` : null;
    },
    async apply(db: Db, changes: ChangeSet[]) {
        const item = changes.map((c) => c.ref.split("|")[1]!);
        const kiosk = changes.map((c) => c.ref.split("|")[0]!);
        const target = changes.map((c) => c.merged.target_par as number | null);
        const minimum = changes.map((c) => c.merged.minimum_stock as number | null);
        const safety = changes.map((c) => c.merged.safety_stock as number | null);
        await db.$executeRaw`
            INSERT INTO "stock_item_par" ("stock_item_id", "kiosk_id", "target_par", "minimum_stock", "safety_stock")
            SELECT * FROM unnest(${item}::text[], ${kiosk}::text[], ${target}::numeric[], ${minimum}::numeric[], ${safety}::numeric[])
            ON CONFLICT ("stock_item_id", "kiosk_id") DO UPDATE
               SET "target_par" = EXCLUDED."target_par", "minimum_stock" = EXCLUDED."minimum_stock", "safety_stock" = EXCLUDED."safety_stock"`;
    },
};
