import { describe, it, expect } from "vitest";
import { invoiceConfirmMessage, invoiceConfirmProblems } from "./invoice-confirm-problems.js";

const line = (over: Record<string, unknown> = {}) => ({ description_raw: "Aonori 100g", stock_item_id: "S1", qty: 2, unit_cost: 4.4, ...over });

describe("invoiceConfirmProblems", () => {
    it("has nothing to say about a complete line", () => {
        expect(invoiceConfirmProblems([line()])).toEqual([]);
        expect(invoiceConfirmProblems([line({ unit_cost: 0 })])).toEqual([]); // a free item is allowed
    });

    it("names the line and says in plain words what to do", () => {
        expect(invoiceConfirmProblems([line({ stock_item_id: null })])).toEqual(['• "Aonori 100g": pick the matching stock item']);
    });

    it("lists every problem on every line at once", () => {
        const problems = invoiceConfirmProblems([line({ stock_item_id: "" , description_raw: "A" }), line({ description_raw: "B", qty: 0, unit_cost: null }), line({ description_raw: "C" })]);
        expect(problems).toEqual(['• "A": pick the matching stock item', '• "B": enter a quantity above 0, enter the unit cost']);
    });

    it("builds a readable message", () => {
        const msg = invoiceConfirmMessage(['• "A": pick the matching stock item']);
        expect(msg).toBe('1 line needs attention before this invoice can be confirmed:\n• "A": pick the matching stock item\n\nClick Edit lines, choose the stock item (and fill any missing quantity or cost) for each one, press Save, then press Confirm again.');
        expect(invoiceConfirmMessage(["• a", "• b"]).startsWith("2 lines need attention")).toBe(true);
    });
});
