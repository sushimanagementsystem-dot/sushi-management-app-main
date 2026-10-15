import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildOrderEmail, type OrderItemInfo, type OrderLine } from "./purchasing-order-email.js";

const items = new Map<string, OrderItemInfo>([
    ["S1", { name: "CHICKEN KARAAGE", countUnit: "kg", supplierCode: "Q0230A-IE", supplierDescription: "Springsnow Chicken Karaage 10x1kg", caseUnit: "10x1kg", sellingUnit: "1Kg", price: 35 }],
    ["S2", { name: "RICE <VINEGAR>", countUnit: "L", supplierCode: "", supplierDescription: "", caseUnit: "", sellingUnit: "", price: null }],
]);
const lines: OrderLine[] = [
    { stockItemId: "S2", recommendedPacks: 1, recommendedQty: 12, packSize: 12, flags: ["STALE"] },
    { stockItemId: "S1", recommendedPacks: 2, recommendedQty: 20, packSize: 10, flags: [] },
];

/** Finds the row whose first column equals `code`/`name` in a sheet_to_json grid, for asserting against the real,
 * ~1000-row supplier template files rather than a short hand-built fixture. */
function findRow(grid: unknown[][], colIndex: number, needle: string): unknown[] {
    const row = grid.find((r) => String(r[colIndex] ?? "").trim().toLowerCase() === needle.toLowerCase());
    if (!row) throw new Error(`Row not found for "${needle}"`);
    return row;
}

describe("buildOrderEmail", () => {
    it("a generic sheet supplier gets the fallback Excel order sheet attached, kiosk name in subject/filename, sorted by item", async () => {
        const mail = await buildOrderEmail(
            { name: "Some Supplier", contactEmail: "sales@example.test", orderOutputMethod: "ORDER_SHEET", orderSheetTemplate: null },
            lines,
            items,
            "2026-09-25",
            7,
            "Loughrea",
            "Loughrea",
            "2026-09-28",
        );
        expect(mail.subject).toBe("Order to review: Some Supplier — Loughrea (2026-09-25)");
        expect(mail.html).toContain("Send to: <b>sales@example.test</b>");
        expect(mail.attachments).toHaveLength(1);
        expect(mail.attachments[0]!.filename).toBe("Order sheet - Some Supplier - Loughrea - 2026-09-25.xlsx");
        const wb = XLSX.read(mail.attachments[0]!.content, { type: "buffer" });
        const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Order"]!, { header: 1 });
        expect(grid[0]).toEqual(["Supplier code", "Item", "Pack", "Packs to order", "Total quantity", "Notes"]);
        expect(grid[1]).toEqual(["", "RICE <VINEGAR>", "12 L", 1, "12 L", "stock count is more than 7 days old"]);
        expect(grid[2]).toEqual(["Q0230A-IE", "Springsnow Chicken Karaage 10x1kg", "10x1kg", 2, "20 kg", ""]);
    });

    it("an email-message supplier gets the list in the body and no attachment; text is escaped; a missing supplier email is said out loud", async () => {
        const mail = await buildOrderEmail(
            { name: "VSD", contactEmail: null, orderOutputMethod: "EMAIL_ORDER", orderSheetTemplate: null },
            lines,
            items,
            "2026-09-25",
            7,
            "Oranmore",
            "Oranmore",
            "2026-09-28",
        );
        expect(mail.subject).toBe("Order to review: VSD — Oranmore (2026-09-25)");
        expect(mail.attachments).toEqual([]);
        expect(mail.html).toContain("RICE &lt;VINEGAR&gt;");
        expect(mail.html).not.toContain("<VINEGAR>");
        expect(mail.html).toContain("No supplier email is saved");
    });

    it("Tazaki's own real order sheet: quantity is filled in SELLING units (not cases) on the matched row, every other row/column/colour untouched, unmatched items called out in the email", async () => {
        const mail = await buildOrderEmail(
            { name: "Tazaki", contactEmail: "irelandsales@tazakifoods.com", orderOutputMethod: "ORDER_SHEET", orderSheetTemplate: "TAZAKI" },
            lines,
            items,
            "2026-09-25",
            7,
            "Loughrea",
            "Loughrea",
            "2026-09-28",
        );
        const wb = XLSX.read(mail.attachments[0]!.content, { type: "buffer" });
        // Tazaki's own sheet tab is date-stamped (e.g. "Copy of Order Sheet 24.07.2026") and changes on every
        // re-download — read positionally, exactly like the production code does.
        const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: "" }).map((r) => r.slice(0, 7));
        expect(grid[0]).toEqual(["Tazaki Foods Order Sheet", "", "Tazaki Foods Order Email ", "", "irelandsales@tazakifoods.com", "", ""]);
        expect(grid[1]).toEqual(["Item Code", "Item Description", "Selling UoM", "Case UoM", "Price", "Quantity", "Subtotal"]);

        // Chicken Karaage: recommendedQty (20, selling units) goes in, NOT recommendedPacks (2, cases) — real
        // template price (86) and every other column stay exactly as Tazaki supplied them, untouched.
        const karaage = findRow(grid, 0, "Q0230A-IE");
        expect(karaage).toEqual(["Q0230A-IE", "Springsnow Chicken Karaage 10x1kg", "10x1kg", "10x1kg", 86, 20, 0]);

        // RICE <VINEGAR> has no code/description that exists in Tazaki's real catalogue — never guessed onto a
        // row, surfaced in the email instead so the owner adds it manually.
        expect(mail.html).toContain("Could not be matched onto Tazaki");
        expect(mail.html).toContain("RICE &lt;VINEGAR&gt;");

        // A row we never touched keeps its original blank quantity and real price untouched.
        const untouched = findRow(grid, 0, "Q4400-IE");
        expect(untouched[4]).toBe(35);
        expect(untouched[5]).toBe("");
    });

    it("Asia Market's own real order template: quantity is cases (their Price is explicitly per case), matched by product code", async () => {
        const asiaItems = new Map<string, OrderItemInfo>([["S1", { name: "GYOZA, CHICKEN", countUnit: "BAG", supplierCode: "CHICKD01", supplierDescription: "Ajinomoto E001W Gyoza-Japanese Style CHICKEN& Vegetable Dumplings (10x600g)", caseUnit: "CASE", sellingUnit: "CASE", price: 41.95 }]]);
        const asiaLines: OrderLine[] = [{ stockItemId: "S1", recommendedPacks: 3, recommendedQty: 30, packSize: 10, flags: [] }];
        const mail = await buildOrderEmail(
            { name: "Asia Market", contactEmail: "mandyh@asiamarket.ie", orderOutputMethod: "ORDER_SHEET", orderSheetTemplate: "ASIA_MARKET" },
            asiaLines,
            asiaItems,
            "2026-09-25",
            7,
            "Oranmore",
            "Oranmore",
            "2026-09-28",
        );
        const wb = XLSX.read(mail.attachments[0]!.content, { type: "buffer" });
        const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Sheet1"]!, { header: 1 });
        expect(grid[0]).toEqual(["Product", "Product code", "Price per case", "QTY ordered", "€"]);
        const row = findRow(grid, 1, "CHICKD01");
        expect(row).toEqual(["Ajinomoto E001W Gyoza-Japanese Style CHICKEN& Vegetable Dumplings (10x600g)", "CHICKD01", 41.95, 3, 0]);
        expect(mail.html).not.toContain("Could not be matched");
    });

    it("Castlebay's own real order form: Name of Store / Delivery Week Beginning use the supplier-registered store name; quantity is cases; the per-kg Salmon row is never guessed", async () => {
        const castlebayItems = new Map<string, OrderItemInfo>([
            ["S1", { name: "SALMON", countUnit: "BOX", supplierCode: "", supplierDescription: "Frz Salmon Fillets E Trim", caseUnit: "14-17kg", sellingUnit: "per kg", price: 320 }],
            ["S2", { name: "KRAFT BOWLS", countUnit: "Box", supplierCode: "", supplierDescription: "Kraft 750 ML bowls", caseUnit: "300", sellingUnit: "per case", price: 39.97 }],
        ]);
        const castlebayLines: OrderLine[] = [
            { stockItemId: "S1", recommendedPacks: 4, recommendedQty: 4, packSize: 1, flags: [] },
            { stockItemId: "S2", recommendedPacks: 2, recommendedQty: 2, packSize: 1, flags: [] },
        ];
        const mail = await buildOrderEmail(
            { name: "Castlebay", contactEmail: null, orderOutputMethod: "ORDER_SHEET", orderSheetTemplate: "CASTLEBAY" },
            castlebayLines,
            castlebayItems,
            "2026-09-25",
            7,
            "Loughrea",
            "SuperValu Loughrea",
            "2026-09-28",
        );
        expect(mail.subject).toBe("Order to review: Castlebay — Loughrea (2026-09-25)");
        const wb = XLSX.read(mail.attachments[0]!.content, { type: "buffer" });
        const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Order Sheet"]!, { header: 1, defval: "" }).map((r) => r.slice(0, 5));
        expect(grid[0]).toEqual(["CastleBay Trading Order Sheet", "", "", "", ""]);

        const storeRow = grid.find((r) => String(r[0]).trim() === "Name of Store");
        expect(storeRow).toEqual(["Name of Store", "SuperValu Loughrea", "", "", ""]);
        const weekRow = grid.find((r) => String(r[0]).trim() === "Delivery Week Beginning");
        expect(weekRow![1]).toBe("2026-09-28");

        const bowls = findRow(grid, 0, "Kraft 750 ML bowls");
        expect(bowls).toEqual(["Kraft 750 ML bowls", 300, "per case", 39.97, 2]);

        // Salmon is billed per kg (variable weight) — never guessed in cases vs kg, surfaced for manual entry.
        const salmon = findRow(grid, 0, "Frz Salmon Fillets E Trim");
        expect(salmon[4]).toBe(""); // Quantity Required left blank
        expect(mail.html).toContain("billed per kg");
    });
});
