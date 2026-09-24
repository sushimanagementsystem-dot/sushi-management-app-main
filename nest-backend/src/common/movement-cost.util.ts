/** product_id -> the product's current unit cost (null when it has none). */
export type ProductCosts = Map<string, number | null>;

export function productCostMap(products: { product_id: string; current_unit_cost: unknown }[]): ProductCosts {
    return new Map(products.map((p) => [p.product_id, p.current_unit_cost === null || p.current_unit_cost === undefined ? null : Number(p.current_unit_cost)]));
}

/**
 * What a product movement (waste, damage, staff food) cost. The cost stored on the row is used when there is one.
 * A row written before its product had a unit cost has none stored (status UNCOSTED); counted as 0 it silently drops
 * out of every total, so it is valued at the product's cost as it stands now. null only when neither exists (the
 * product still has no cost), which callers report as "not costed" instead of pretending it was free.
 */
export function movementCost(row: { cost: unknown; unit_cost: unknown; product_id: string }, qty: number, productCosts: ProductCosts): number | null {
    if (row.cost !== null && row.cost !== undefined) return Number(row.cost);
    const unit = row.unit_cost !== null && row.unit_cost !== undefined ? Number(row.unit_cost) : (productCosts.get(row.product_id) ?? null);
    return unit === null ? null : Math.round(qty * unit * 100) / 100;
}
