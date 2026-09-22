/**
 * Product margin math — the one place Selling Price / Recipe Cost /
 * Packaging Cost get combined into a cost/profit figure, so every screen
 * that shows a margin computes it the same way instead of drifting into
 * slightly different formulas. Nothing here is persisted — the Product
 * table only stores the three raw inputs (see prisma/schema.prisma's
 * Product model); this derives the rest on read, always from current data.
 */
export function productMargin({ sellingPrice, recipeCost, packagingCost }) {
    const price = toNumber(sellingPrice);
    const recipe = toNumber(recipeCost);
    const packaging = toNumber(packagingCost);
    if (price === null || (recipe === null && packaging === null)) return null;

    const cost = (recipe || 0) + (packaging || 0);
    const profit = price - cost;
    const pct = price > 0 ? (profit / price) * 100 : null;
    return { cost, profit, pct };
}

function toNumber(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
