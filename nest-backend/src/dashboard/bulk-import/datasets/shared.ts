import { stocktakeCategoryIds } from "../../../common/stocktake-items.util.js";
import type { Db } from "../bulk-import.types.js";

export const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export const DAY_HEADERS: Record<(typeof WEEKDAYS)[number], { header: string; aliases: string[] }> = {
    MONDAY: { header: "Mon", aliases: ["monday"] },
    TUESDAY: { header: "Tue", aliases: ["tuesday", "tues"] },
    WEDNESDAY: { header: "Wed", aliases: ["wednesday"] },
    THURSDAY: { header: "Thu", aliases: ["thursday", "thur", "thurs"] },
    FRIDAY: { header: "Fri", aliases: ["friday"] },
    SATURDAY: { header: "Sat", aliases: ["saturday"] },
    SUNDAY: { header: "Sun", aliases: ["sunday"] },
};

/** "Mayonaisse, Sriracha" / "MAYONAISSE  SRIRACHA" -> "mayonaisse sriracha": case, punctuation and spacing never decide a match. */
export const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const text = (v: unknown) => String(v ?? "").trim();
export const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type KioskRow = { kiosk_id: string; name: string };

export async function loadKiosks(db: Db): Promise<KioskRow[]> {
    const kiosks: KioskRow[] = await db.kiosk.findMany({ where: { active: true }, select: { kiosk_id: true, name: true } });
    return kiosks.sort((a, b) => a.kiosk_id.localeCompare(b.kiosk_id));
}

/** Finds an active kiosk by id ("K01") or name, ignoring case; null if none or more than one. */
export function findKiosk(kiosks: KioskRow[], value: unknown): KioskRow | null {
    const v = norm(value);
    if (!v) return null;
    const byId = kiosks.filter((k) => norm(k.kiosk_id) === v);
    if (byId.length === 1) return byId[0]!;
    const byName = kiosks.filter((k) => norm(k.name) === v);
    return byName.length === 1 ? byName[0]! : null;
}

export type StockTakeItem = { stock_item_id: string; name: string; count_unit: string; current_unit_cost: unknown; stock_category_id: string; categoryLabel: string; categoryOrder: number };

/** The active Weekly Stocktake items, in Stock Take order (section, then name) — the one list every section shares. */
export async function loadStockTakeList(db: Db): Promise<StockTakeItem[]> {
    const categories: { value: string; label: string; sort_order: number }[] = await db.enumOption.findMany({ where: { enum_type: "stock_category" }, orderBy: { sort_order: "asc" } });
    const ok = stocktakeCategoryIds(categories);
    const label = new Map(categories.map((c) => [c.value, c.label]));
    const order = new Map(categories.map((c, i) => [c.value, i]));
    const items = await db.stockItem.findMany({ where: { active: true, stock_category_id: { in: [...ok] } } });
    return (items as Omit<StockTakeItem, "categoryLabel" | "categoryOrder">[])
        .map((i) => ({ ...i, categoryLabel: label.get(i.stock_category_id) ?? i.stock_category_id, categoryOrder: order.get(i.stock_category_id) ?? 9999 }))
        .sort((a, b) => a.categoryOrder - b.categoryOrder || a.name.localeCompare(b.name) || a.stock_item_id.localeCompare(b.stock_item_id));
}

export type ItemIndex = { byId: Map<string, StockTakeItem>; byName: Map<string, StockTakeItem[]> };

export function indexItems(items: StockTakeItem[]): ItemIndex {
    const byName = new Map<string, StockTakeItem[]>();
    for (const i of items) byName.set(norm(i.name), [...(byName.get(norm(i.name)) ?? []), i]);
    return { byId: new Map(items.map((i) => [i.stock_item_id, i])), byName };
}

/** An item by its code, else by name (then unit, then category to tell same-name items apart). Never guesses between several. */
export function findItem(idx: ItemIndex, raw: { code?: unknown; name?: unknown; unit?: unknown; category?: unknown }): { item: StockTakeItem } | { error: string; unmatched?: boolean } {
    const code = text(raw.code);
    if (code) {
        const hit = idx.byId.get(code);
        return hit ? { item: hit } : { error: `Item code "${code}" is not on the Stock Take list.`, unmatched: true };
    }
    const name = text(raw.name);
    if (!name) return { error: "Missing value: the item code or item name is empty." };
    let candidates = idx.byName.get(norm(name)) ?? [];
    if (!candidates.length) return { error: `"${name}" is not on the Stock Take list.`, unmatched: true };
    const unit = text(raw.unit).toLowerCase();
    if (candidates.length > 1 && unit) {
        const f = candidates.filter((c) => c.count_unit.toLowerCase() === unit);
        if (f.length) candidates = f;
    }
    const cat = norm(raw.category);
    if (candidates.length > 1 && cat) {
        const f = candidates.filter((c) => norm(c.categoryLabel) === cat);
        if (f.length) candidates = f;
    }
    if (candidates.length > 1) return { error: `"${name}" could be more than one item (${candidates.map((c) => `${c.categoryLabel} · ${c.count_unit}`).join(" or ")}). Fill in the Item code column to say which.` };
    return { item: candidates[0]! };
}
