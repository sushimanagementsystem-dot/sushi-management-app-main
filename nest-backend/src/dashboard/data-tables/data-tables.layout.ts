import type { FieldSchemaRow } from "./data-tables.types.js";

export const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const dayIndex = (name: string) => WEEKDAYS.indexOf(name as (typeof WEEKDAYS)[number]);

/**
 * How a table is laid out on screen. The grid shows rows and columns exactly in the order the API returns them, and the
 * database returns them in whatever order they happen to be stored in — which is how Friday and Sunday ended up before
 * Monday, and kiosks and products got mixed. One place decides the order, so every view of a table (all kiosks, or one
 * kiosk picked from the filter) is the same list, just shorter.
 */

/** Columns: the key/reference columns first (their own order kept), then Monday..Sunday, then everything else. Only for tables that have weekday columns. */
export function orderFields(fields: FieldSchemaRow[]): FieldSchemaRow[] {
    if (!fields.some((f) => dayIndex(f.column_name) >= 0)) return fields;
    const isKey = (f: FieldSchemaRow) => !!f.primary_key || f.type === "reference";
    const days = fields.filter((f) => dayIndex(f.column_name) >= 0).sort((a, b) => dayIndex(a.column_name) - dayIndex(b.column_name));
    const keys = fields.filter((f) => isKey(f) && dayIndex(f.column_name) < 0);
    const rest = fields.filter((f) => !isKey(f) && dayIndex(f.column_name) < 0);
    return [...keys, ...days, ...rest];
}

export type LayoutLookups = {
    /** kiosk_id -> position (kiosk_id order, K01, K02, ...) */
    kioskOrder: Map<string, number>;
    /** product_id -> { name, category position } */
    products: Map<string, { name: string; categoryOrder: number }>;
    /** stock_item_id -> { name, category position } (position within the stock_category enum, i.e. the Stock Take sections) */
    stockItems: Map<string, { name: string; categoryOrder: number }>;
    defrostItemNames: Map<string, string>;
};

const text = (v: unknown) => String(v ?? "").toLowerCase();
const cmp = (a: number, b: number) => a - b;
const FAR = 9999;

type Row = Record<string, unknown>;

/**
 * Rows, in a fixed order that does not depend on how many kiosks are showing:
 *  - Production Par / Defrost Par: kiosk, then product category (the Product Category list's own order), then product name;
 *  - Product: category, then name;   Stock Item: Stock Take section, then name;
 *  - Staff: active people first, then by name (so old, switched-off accounts sink to the bottom).
 * Any other table is returned as it is.
 */
export function orderRows(tableName: string, rows: Row[], lk: LayoutLookups): Row[] {
    const sorted = [...rows];
    const kiosk = (r: Row) => lk.kioskOrder.get(String(r.kiosk_id)) ?? FAR;
    const product = (r: Row) => lk.products.get(String(r.product_id));
    switch (tableName) {
        case "production_par":
            return sorted.sort(
                (a, b) =>
                    cmp(kiosk(a), kiosk(b)) ||
                    cmp(product(a)?.categoryOrder ?? FAR, product(b)?.categoryOrder ?? FAR) ||
                    text(product(a)?.name).localeCompare(text(product(b)?.name)) ||
                    text(a.product_id).localeCompare(text(b.product_id)),
            );
        case "defrost_par":
            return sorted.sort((a, b) => cmp(kiosk(a), kiosk(b)) || text(lk.defrostItemNames.get(String(a.defrost_item_id))).localeCompare(text(lk.defrostItemNames.get(String(b.defrost_item_id)))));
        case "product":
            return sorted.sort(
                (a, b) =>
                    cmp(lk.products.get(String(a.product_id))?.categoryOrder ?? FAR, lk.products.get(String(b.product_id))?.categoryOrder ?? FAR) ||
                    text(a.name).localeCompare(text(b.name)) ||
                    text(a.brand_id).localeCompare(text(b.brand_id)),
            );
        case "stock_item":
            return sorted.sort(
                (a, b) =>
                    cmp(lk.stockItems.get(String(a.stock_item_id))?.categoryOrder ?? FAR, lk.stockItems.get(String(b.stock_item_id))?.categoryOrder ?? FAR) ||
                    text(a.name).localeCompare(text(b.name)) ||
                    text(a.stock_item_id).localeCompare(text(b.stock_item_id)),
            );
        case "user":
            return sorted.sort((a, b) => cmp(a.active === false ? 1 : 0, b.active === false ? 1 : 0) || text(a.name).localeCompare(text(b.name)));
        default:
            return rows;
    }
}
