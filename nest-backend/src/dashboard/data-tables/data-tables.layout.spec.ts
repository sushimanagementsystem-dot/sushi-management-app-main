import { describe, it, expect } from "vitest";
import { orderFields, orderRows, type LayoutLookups } from "./data-tables.layout.js";
import type { FieldSchemaRow } from "./data-tables.types.js";

const f = (column_name: string, extra: Partial<FieldSchemaRow> = {}) => ({ table_name: "production_par", column_name, label: column_name, type: "number", ...extra }) as FieldSchemaRow;

const LK: LayoutLookups = {
    kioskOrder: new Map([["K01", 0], ["K02", 1], ["K03", 2]]),
    products: new Map([
        ["P1", { name: "Nigiri", categoryOrder: 1 }],
        ["P2", { name: "Crisps", categoryOrder: 0 }],
        ["P3", { name: "Bento", categoryOrder: 1 }],
    ]),
    stockItems: new Map([["S1", { name: "B", categoryOrder: 0 }], ["S2", { name: "A", categoryOrder: 1 }], ["S3", { name: "A", categoryOrder: 0 }]]),
    defrostItemNames: new Map([["D1", "Zebra"], ["D2", "Apple"]]),
};

describe("orderFields", () => {
    it("puts the weekday columns Monday to Sunday, after the key columns", () => {
        const fields = [f("kiosk_id", { type: "reference", primary_key: true }), f("FRIDAY"), f("SUNDAY"), f("product_id", { type: "reference", primary_key: true }), f("MONDAY"), f("THURSDAY"), f("TUESDAY"), f("SATURDAY"), f("WEDNESDAY")];
        expect(orderFields(fields).map((x) => x.column_name)).toEqual(["kiosk_id", "product_id", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);
    });
    it("leaves tables without weekday columns untouched", () => {
        const fields = [f("b"), f("a")];
        expect(orderFields(fields)).toBe(fields);
    });
});

describe("orderRows", () => {
    const par = (kiosk_id: string, product_id: string) => ({ kiosk_id, product_id });
    it("production_par: kiosk, then product category order, then product name — so one kiosk is the same list as the full view, filtered", () => {
        const rows = [par("K02", "P1"), par("K01", "P3"), par("K02", "P2"), par("K01", "P1"), par("K01", "P2")];
        const all = orderRows("production_par", rows, LK).map((r) => `${r.kiosk_id}${r.product_id}`);
        expect(all).toEqual(["K01P2", "K01P3", "K01P1", "K02P2", "K02P1"]);
        const k01Only = orderRows("production_par", rows.filter((r) => r.kiosk_id === "K01"), LK).map((r) => `${r.kiosk_id}${r.product_id}`);
        expect(k01Only).toEqual(all.filter((x) => x.startsWith("K01")));
    });
    it("stock_item: Stock Take section, then name", () => {
        const rows = [{ stock_item_id: "S2", name: "A" }, { stock_item_id: "S1", name: "B" }, { stock_item_id: "S3", name: "A" }];
        expect(orderRows("stock_item", rows, LK).map((r) => r.stock_item_id)).toEqual(["S3", "S1", "S2"]);
    });
    it("user: active first, then name", () => {
        const rows = [{ name: "Zed", active: true }, { name: "Amy", active: false }, { name: "Bob", active: true }];
        expect(orderRows("user", rows, LK).map((r) => r.name)).toEqual(["Bob", "Zed", "Amy"]);
    });
    it("does not touch other tables and does not mutate its input", () => {
        const rows = [{ x: 2 }, { x: 1 }];
        expect(orderRows("brand", rows, LK)).toBe(rows);
        const pars = [par("K02", "P1"), par("K01", "P1")];
        orderRows("production_par", pars, LK);
        expect(pars[0]!.kiosk_id).toBe("K02");
    });
});
