export type WeekInputs = {
    sales: number | null;
    /** Opening stocktake value + approved deliveries − closing stocktake value, for the period this week's
     * stocktake closed. Already includes waste, damage and staff food — all three are things that left the
     * shelf between the two counts, exactly what this figure measures — so they're shown separately on the
     * page as a breakdown of what's inside COGS, never added to it again (see ProfitService). null = no
     * closing stocktake yet this week, so there's nothing to show.
     */
    cogs: number | null;
    /** null = not entered yet (counts as nothing until it is). */
    fixedCosts: number | null;
    miscCosts: number | null;
    /** null = no labour report for this kiosk-week (or hours with no rate) — EBITDA stays blank rather than pretend labour was free. */
    labourCost: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The Profit table's arithmetic, in the order the columns read:
 *   Total costs  = COGS + Fixed Costs + Misc Costs
 *   Royalty      = 30% of Sales (the franchisor's fee — always this rate, not editable)
 *   Gross Profit = Sales - Total costs
 *   Total Labour = Labour x 1.25 (gross labour plus employer's taxes, holiday pay and pension - a flat 25% on top)
 *   EBITDA       = Gross Profit - Royalty - Total Labour
 * Gross Profit needs the week's sales; EBITDA additionally needs Total Labour.
 */
export function profitFigures(i: WeekInputs): { totalCosts: number | null; royalty: number | null; totalLabour: number | null; grossProfit: number | null; ebitda: number | null } {
    const totalCosts = i.cogs === null ? null : round2(i.cogs + (i.fixedCosts ?? 0) + (i.miscCosts ?? 0));
    const royalty = i.sales === null ? null : round2(i.sales * 0.3);
    const grossProfit = i.sales === null || totalCosts === null ? null : round2(i.sales - totalCosts);
    const totalLabour = i.labourCost === null ? null : round2(i.labourCost * 1.25);
    const ebitda = grossProfit === null || totalLabour === null || royalty === null ? null : round2(grossProfit - royalty - totalLabour);
    return { totalCosts, royalty, totalLabour, grossProfit, ebitda };
}
