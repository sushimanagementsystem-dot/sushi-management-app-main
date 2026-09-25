import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildTemplate, parseNumber, runBulk } from "./bulk-import.engine.js";
import type { BulkDataset, Target } from "./bulk-import.types.js";

type Ctx = { rows: { id: string; name: string; qty: number | null; price: number | null }[] };

const dataset: BulkDataset<Ctx> = {
    id: "demo",
    label: "Demo",
    fileName: "demo.xlsx",
    sheetName: "Demo",
    description: "",
    showOn: [],
    invalidates: [],
    detect: ["name", "qty"],
    instructions: ["Fill the Qty column."],
    columns: [
        { key: "name", header: "Item", aliases: ["product"], kind: "key", required: true },
        { key: "qty", header: "Qty", kind: "value", format: "integer", min: 0 },
        { key: "price", header: "Price", kind: "value", format: "money", min: 0 },
        { key: "id", header: "Code", kind: "key" },
    ],
    load: async () => ({ rows: [] }),
    targets: (ctx): Target[] => ctx.rows.map((r) => ({ ref: r.id, label: { name: r.name, id: r.id }, current: { qty: r.qty, price: r.price }, exists: true })),
    resolve(raw, ctx) {
        const hit = ctx.rows.find((r) => r.id === String(raw.id).trim()) ?? ctx.rows.find((r) => r.name.toLowerCase() === String(raw.name).trim().toLowerCase());
        return hit ? { ref: hit.id } : { error: `"${String(raw.name).trim()}" not found.`, unmatched: true };
    },
    check: (m) => (m.qty !== null && m.price !== null && (m.qty as number) > 100 && (m.price as number) === 0 ? "A price is needed above 100." : null),
    apply: async () => undefined,
};

const ctx: Ctx = { rows: [{ id: "A", name: "Avocado", qty: 5, price: 1.5 }, { id: "B", name: "Basil", qty: null, price: null }, { id: "C", name: "Chives", qty: 2, price: 2 }] };
const sheet = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
const run = (rows: unknown[][]) => runBulk(dataset, ctx, sheet([["Item", "Qty", "Price", "Code"], ...rows]));

describe("bulk import engine", () => {
    it("classifies every row: changed, unchanged, unmatched, invalid (bad number / missing value / failed check), duplicate", () => {
        const { preview } = run([
            ["Avocado", 9, "", "A"], // changed
            ["Chives", 2, 2, "C"], // unchanged
            ["Nutmeg", 1, "", ""], // unmatched
            ["Basil", "lots", "", "B"], // not a number
            ["", 4, "", "B"], // missing item name
            ["Avocado", 7, "", "A"], // duplicate of the first
        ]);
        const byStatus = preview.rows.map((r) => [r.rowNo, r.status]);
        expect(byStatus).toEqual([[2, "changed"], [3, "unchanged"], [4, "unmatched"], [5, "invalid"], [6, "invalid"], [7, "duplicate"]]);
        expect(preview.rows[3]!.message).toContain('"Qty": "lots" is not a number');
        expect(preview.rows[4]!.message).toContain('Missing value: "Item" is empty');
        expect(preview.rows[5]!.message).toContain("row 2");
        expect(preview.canApply).toBe(false); // any problem blocks the whole apply
        expect(preview.summary).toMatchObject({ changed: 1, unchanged: 1, unmatched: 1, invalid: 2, duplicate: 1, notInFile: 0 });
    });

    it("can apply only when every row is clean and something changes; blank cells leave values alone", () => {
        const { preview, changes } = run([["Avocado", 9, "", "A"], ["Basil", 3, 4, "B"], ["Chives", "", "", "C"]]);
        expect(preview.canApply).toBe(true);
        expect(preview.rows.map((r) => r.status)).toEqual(["changed", "changed", "unchanged"]);
        expect(preview.rows[2]!.message).toBe("No values filled in for this row.");
        expect(changes.map((c) => [c.ref, c.values, c.merged])).toEqual([
            ["A", { qty: 9 }, { qty: 9, price: 1.5 }],
            ["B", { qty: 3, price: 4 }, { qty: 3, price: 4 }],
        ]);
        expect(preview.rows[0]!.changes).toEqual([{ key: "qty", header: "Qty", from: 5, to: 9 }]);
    });

    it("nothing to change is not applyable, and the token changes with the data", () => {
        expect(run([["Chives", 2, 2, "C"]]).preview.canApply).toBe(false);
        const a = run([["Avocado", 9, "", "A"]]).preview.token;
        const b = run([["Avocado", 8, "", "A"]]).preview.token;
        expect(a).not.toBe(b);
        expect(run([["Avocado", 9, "", "A"]]).preview.token).toBe(a);
    });

    it("finds the header row under title rows, accepts header aliases and reports a file with the wrong columns", () => {
        const ok = runBulk(dataset, ctx, sheet([["Stock levels 2026"], [], ["Product", "Qty"], ["Avocado", 6]]));
        expect(ok.preview.rows[0]).toMatchObject({ status: "changed", rowNo: 4 });
        expect(runBulk(dataset, ctx, sheet([["Foo", "Bar"], [1, 2]])).preview.fileErrors[0]).toContain("Couldn't find the columns");
        expect(runBulk(dataset, ctx, sheet([["Item", "Price"], ["Avocado", 1]])).preview.fileErrors[0]).toContain("Couldn't find the columns");
        expect(runBulk(dataset, ctx, Buffer.from("not a spreadsheet at all \u0000\u0001")).preview.canApply).toBe(false);
    });

    it("checks the row as it would be after the change (cross-field rule)", () => {
        const { preview } = run([["Chives", 200, 0, "C"]]);
        expect(preview.rows[0]).toMatchObject({ status: "invalid", message: "A price is needed above 100." });
    });

    it("rejects negative and fractional values for whole-number columns", () => {
        const { preview } = run([["Avocado", -1, "", "A"], ["Basil", 1.5, "", "B"]]);
        expect(preview.rows.map((r) => r.message)).toEqual(['"Qty": -1 is below the minimum of 0.', '"Qty": 1.5 must be a whole number.']);
    });

    it("the template lists every record with its current values and reads back as a file with no changes", () => {
        const buf = buildTemplate(dataset, ctx);
        const wb = XLSX.read(buf, { type: "buffer" });
        expect(wb.SheetNames).toEqual(["Demo", "How to use"]);
        const back = runBulk(dataset, ctx, buf);
        expect(back.preview.rows).toHaveLength(3);
        expect(back.preview.summary).toMatchObject({ changed: 0, invalid: 0, unmatched: 0, duplicate: 0 });
    });

    it("reads numbers the way people type them", () => {
        expect(parseNumber("€4,50")).toBe(4.5);
        expect(parseNumber("1,250.5")).toBe(1250.5);
        expect(parseNumber("lots")).toBeNull();
    });
});
