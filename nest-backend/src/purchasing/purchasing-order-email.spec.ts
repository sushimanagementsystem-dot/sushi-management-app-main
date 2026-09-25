import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildOrderEmail, type OrderItemInfo, type OrderLine } from "./purchasing-order-email.js";

const items = new Map<string, OrderItemInfo>([
    ["S1", { name: "CHICKEN KARAAGE", countUnit: "kg", supplierCode: "Q0230A-IE", supplierDescription: "Springsnow Chicken Karaage 10x1kg", caseUnit: "10x1kg" }],
    ["S2", { name: "RICE <VINEGAR>", countUnit: "L", supplierCode: "", supplierDescription: "", caseUnit: "" }],
]);
const lines: OrderLine[] = [
    { stockItemId: "S2", recommendedPacks: 1, recommendedQty: 12, packSize: 12, flags: ["STALE"] },
    { stockItemId: "S1", recommendedPacks: 2, recommendedQty: 20, packSize: 10, flags: [] },
];

describe("buildOrderEmail", () => {
    it("a sheet supplier gets the Excel order sheet attached, with the supplier's own code and description, sorted by item", () => {
        const mail = buildOrderEmail({ name: "Tazaki", contactEmail: "sales@tazaki.test", orderOutputMethod: "ORDER_SHEET" }, lines, items, "2026-09-25", 7);
        expect(mail.subject).toBe("Order to review: Tazaki (2026-09-25)");
        expect(mail.html).toContain("Send to: <b>sales@tazaki.test</b>");
        expect(mail.attachments).toHaveLength(1);
        expect(mail.attachments[0]!.filename).toBe("Order sheet - Tazaki - 2026-09-25.xlsx");
        const wb = XLSX.read(mail.attachments[0]!.content, { type: "buffer" });
        const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Order"]!, { header: 1 });
        expect(grid[0]).toEqual(["Supplier code", "Item", "Pack", "Packs to order", "Total quantity", "Notes"]);
        expect(grid[1]).toEqual(["", "RICE <VINEGAR>", "12 L", 1, "12 L", "stock count is more than 7 days old"]);
        expect(grid[2]).toEqual(["Q0230A-IE", "Springsnow Chicken Karaage 10x1kg", "10x1kg", 2, "20 kg", ""]);
    });
    it("an email-message supplier gets the list in the body and no attachment; text is escaped; a missing supplier email is said out loud", () => {
        const mail = buildOrderEmail({ name: "VSD", contactEmail: null, orderOutputMethod: "EMAIL_ORDER" }, lines, items, "2026-09-25", 7);
        expect(mail.attachments).toEqual([]);
        expect(mail.html).toContain("RICE &lt;VINEGAR&gt;");
        expect(mail.html).not.toContain("<VINEGAR>");
        expect(mail.html).toContain("No supplier email is saved");
    });
});
