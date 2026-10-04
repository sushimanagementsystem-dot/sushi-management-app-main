import { describe, it, expect } from "vitest";
import { profitFigures } from "./profit-calc.js";

const base = { sales: 1000, cogs: 300, fixedCosts: 100, miscCosts: 15, labourCost: 250 };

describe("profitFigures", () => {
    it("Total costs = COGS + Fixed + Misc; Royalty = 30% of Sales; Gross Profit = Sales - Total costs; Total Labour = Labour x 1.25; EBITDA = Gross Profit - Royalty - Total Labour", () => {
        // totalCosts = 300 + 100 + 15 = 415; royalty = 1000 x 0.3 = 300; grossProfit = 1000 - 415 = 585;
        // totalLabour = 250 x 1.25 = 312.5; ebitda = 585 - 300 - 312.5 = -27.5
        expect(profitFigures(base)).toEqual({ totalCosts: 415, royalty: 300, totalLabour: 312.5, grossProfit: 585, ebitda: -27.5 });
    });
    it("costs not entered yet count as nothing", () => {
        expect(profitFigures({ ...base, fixedCosts: null, miscCosts: null })).toEqual({ totalCosts: 300, royalty: 300, totalLabour: 312.5, grossProfit: 700, ebitda: 87.5 });
    });
    it("no closing stocktake yet this week -> no total costs, no gross profit, no EBITDA", () => {
        expect(profitFigures({ ...base, cogs: null })).toEqual({ totalCosts: null, royalty: 300, totalLabour: 312.5, grossProfit: null, ebitda: null });
    });
    it("no sales -> no royalty, no gross profit, no EBITDA", () => {
        expect(profitFigures({ ...base, sales: null })).toEqual({ totalCosts: 415, royalty: null, totalLabour: 312.5, grossProfit: null, ebitda: null });
    });
    it("no labour -> gross profit and royalty still shown, Total Labour and EBITDA blank", () => {
        expect(profitFigures({ ...base, labourCost: null })).toEqual({ totalCosts: 415, royalty: 300, totalLabour: null, grossProfit: 585, ebitda: null });
    });
    it("a loss is negative, and rounds to cents", () => {
        expect(profitFigures({ ...base, sales: 100.005, labourCost: 0.1 }).grossProfit).toBe(-314.99);
    });
});
