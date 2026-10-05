/**
 * Whether a product should still be planned/counted for today's production —
 * `active` alone isn't enough: Data Tables > Product > Production Role has
 * its own owner-editable "Retired" option (separate from the active flag),
 * and an owner picking that expects the product to stop appearing in
 * today's operations immediately, the same as flipping Active off. Never
 * used for historical reporting (profit/KPI/reports) — a retired product's
 * past data must still show there.
 */
export function isProductInProduction(product: { active: boolean; production_role: string | null }): boolean {
    return product.active && product.production_role !== "RETIRED";
}
