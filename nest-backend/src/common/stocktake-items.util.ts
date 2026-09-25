/**
 * Which stock items are on the Weekly Stocktake. The one definition, used by the stocktake form, its processor and
 * the Product Prices page, so they can never disagree about what "a Stock Take item" is: every active stock item
 * except those in the Food Waste "(per 100g)" tracking category — those are only ever wasted, never counted.
 */
export function stocktakeCategoryIds(categories: { value: string; label: string }[]): Set<string> {
    return new Set(categories.filter((c) => !c.label.toLowerCase().includes("per 100g")).map((c) => c.value));
}

export function stocktakeItems<T extends { active: boolean; stock_category_id: string }>(items: T[], categories: { value: string; label: string }[]): T[] {
    const ids = stocktakeCategoryIds(categories);
    return items.filter((i) => i.active && ids.has(i.stock_category_id));
}

/** The active Stock Take items, read straight from the database (for services that query Prisma rather than the table cache). */
export async function loadStocktakeItems(prisma: {
    enumOption: { findMany: (args: never) => Promise<{ value: string; label: string }[]> };
    stockItem: { findMany: (args: never) => Promise<import("@prisma/client").StockItem[]> };
}) {
    const categories = await prisma.enumOption.findMany({ where: { enum_type: "stock_category" } } as never);
    const ids = [...stocktakeCategoryIds(categories)];
    return prisma.stockItem.findMany({ where: { active: true, stock_category_id: { in: ids } } } as never);
}
