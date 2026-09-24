import { describe, it, expect } from "vitest";
import { profitFigures } from "./profit-calc.js";

const base = { sales: 1000, cogs: 300, wasteCost: 20, damageCost: 5, staffFoodCost: 10, fixedCosts: 100, miscCosts: 15, labourCost: 250 };

describe("profitFigures", () => {
    it("Gross Profit = Sales - (COGS + Waste + Damage + Staff Food + Fixed + Misc); EBITDA = Gross Profit - Labour", () => {
        expect(profitFigures(base)).toEqual({ totalCosts: 450, grossProfit: 550, ebitda: 300 });
    });
    it("costs not entered yet count as nothing", () => {
        expect(profitFigures({ ...base, fixedCosts: null, miscCosts: null })).toEqual({ totalCosts: 335, grossProfit: 665, ebitda: 415 });
    });
    it("no sales -> no gross profit and no EBITDA", () => {
        expect(profitFigures({ ...base, sales: null })).toEqual({ totalCosts: 450, grossProfit: null, ebitda: null });
    });
    it("no labour -> gross profit still shown, EBITDA blank", () => {
        expect(profitFigures({ ...base, labourCost: null })).toEqual({ totalCosts: 450, grossProfit: 550, ebitda: null });
    });
    it("a loss is negative, and rounds to cents", () => {
        expect(profitFigures({ ...base, sales: 100.005, labourCost: 0.1 }).grossProfit).toBe(-349.99);
    });
});
