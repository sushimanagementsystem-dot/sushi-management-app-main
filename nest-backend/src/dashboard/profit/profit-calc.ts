export type WeekInputs = {
    sales: number | null;
    cogs: number;
    wasteCost: number;
    damageCost: number;
    staffFoodCost: number;
    /** null = not entered yet (counts as nothing until it is). */
    fixedCosts: number | null;
    miscCosts: number | null;
    /** null = no labour report for this kiosk-week (or hours with no rate) — EBITDA stays blank rather than pretend labour was free. */
    labourCost: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The Profit table's arithmetic, in the order the columns read:
 *   Total costs  = COGS + Waste + Damage + Staff Food + Fixed Costs + Misc Costs
 *   Gross Profit = Sales - Total costs
 *   EBITDA       = Gross Profit - Labour
 * Gross Profit needs the week's sales; EBITDA additionally needs the week's labour.
 */
export function profitFigures(i: WeekInputs): { totalCosts: number; grossProfit: number | null; ebitda: number | null } {
    const totalCosts = round2(i.cogs + i.wasteCost + i.damageCost + i.staffFoodCost + (i.fixedCosts ?? 0) + (i.miscCosts ?? 0));
    const grossProfit = i.sales === null ? null : round2(i.sales - totalCosts);
    const ebitda = grossProfit === null || i.labourCost === null ? null : round2(grossProfit - i.labourCost);
    return { totalCosts, grossProfit, ebitda };
}
