import type { BulkDataset, ChangeSet, Db, Target } from "../bulk-import.types.js";
import { findItem, indexItems, loadStockTakeList, num, type ItemIndex, type StockTakeItem } from "./shared.js";

type Ctx = { items: StockTakeItem[]; index: ItemIndex };

/**
 * Stock Item prices: one price per Stock Take item (shared by both brands). Matches the client's own price sheet by
 * item code, or by name with unit / category to tell same-name items apart. Never creates an item.
 */
export const stockItemPriceDataset: BulkDataset<Ctx> = {
    id: "stock_item_price",
    label: "Stock Item prices",
    fileName: "stock-item-prices.xlsx",
    sheetName: "Stock Item Prices",
    description: "One price per Stock Take item, used for both brands.",
    showOn: ["stock_item"],
    invalidates: ["stock_item"],
    detect: ["name", "price"],
    columns: [
        { key: "category", header: "Category", kind: "info", width: 26 },
        { key: "name", header: "Item", aliases: ["name", "item name", "stock item", "stock item name", "ingredient", "ingredient name", "description", "product"], kind: "key", width: 40 },
        { key: "unit", header: "Unit", aliases: ["uom", "count unit", "unit of measure"], kind: "info", width: 8 },
        { key: "price", header: "Price", aliases: ["cost", "unit cost", "unit price", "cost price", "price per unit", "current unit cost", "price eur", "cost eur"], kind: "value", format: "money", min: 0, width: 10 },
        { key: "code", header: "Item code", aliases: ["code", "id", "item id", "stock item id", "stock_item_id"], kind: "key", width: 11 },
    ],
    instructions: [
        "Type each item's price in the Price column. Every Stock Take item is listed with its current price.",
        "You can also paste prices from your own sheet: rows are matched by Item code, or by the item name (with Unit or Category where two items share a name).",
        "Leave a price blank to keep the current price. Items that are not on the Stock Take list are reported and never created.",
    ],
    async load(db: Db) {
        const items = await loadStockTakeList(db);
        return { items, index: indexItems(items) };
    },
    targets: (ctx): Target[] =>
        ctx.items.map((i) => ({
            ref: i.stock_item_id,
            label: { category: i.categoryLabel, name: i.name, unit: i.count_unit, code: i.stock_item_id },
            current: { price: num(i.current_unit_cost) },
            exists: true,
        })),
    resolve(raw, ctx) {
        const found = findItem(ctx.index, { code: raw.code, name: raw.name, unit: raw.unit, category: raw.category });
        return "item" in found ? { ref: found.item.stock_item_id } : found;
    },
    async apply(db: Db, changes: ChangeSet[]) {
        const ids = changes.map((c) => c.ref);
        const costs = changes.map((c) => c.merged.price as number);
        await db.$executeRaw`
            UPDATE "stock_item" AS s SET "current_unit_cost" = v.cost
            FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${costs}::numeric[]) AS cost) AS v
            WHERE s."stock_item_id" = v.id`;
    },
};
