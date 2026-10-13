/**
 * Which stock items are on the Weekly Stocktake. The one definition, used by the stocktake form, its processor and
 * the Product Prices page, so they can never disagree about what "a Stock Take item" is: every active stock item
 * except those in the Food Waste "(per 100g)" tracking category — those are only ever wasted, never counted —
 * PLUS every "Kiosk (ambient product only)" stocktake-only duplicate (ambient_duplicate_of set), active or not —
 * see stocktakeItems below for why.
 */
export function stocktakeCategoryIds(categories: { value: string; label: string }[]): Set<string> {
    return new Set(categories.filter((c) => !c.label.toLowerCase().includes("per 100g")).map((c) => c.value));
}

/**
 * Items shown on the Weekly Stocktake: every active non-waste item, plus every ambient-duplicate row even when
 * switched off. An ambient duplicate never carries its own supplier mapping or par row and never generates its
 * own purchase order (purchasing-scan.service.ts sums it into the real item's balance instead) — counting it is
 * the only thing it's for, so it must never silently drop off this list, active or not (found live: three kiosks'
 * stocktakes all landed on the same missing item the same day a duplicate's Active toggle got flipped off).
 */
export function stocktakeItems<T extends { active: boolean; stock_category_id: string; ambient_duplicate_of?: string | null }>(
    items: T[],
    categories: { value: string; label: string }[],
): T[] {
    const ids = stocktakeCategoryIds(categories);
    return items.filter((i) => (i.active && ids.has(i.stock_category_id)) || !!i.ambient_duplicate_of);
}

/**
 * The stock item catalog for everything EXCEPT the stocktake itself — invoice line matching, Move Stock, and any
 * other stock-item picker. Excludes ambient duplicates entirely (see stocktakeItems): the same physical stock they
 * duplicate is already reachable by picking the real item, so offering both there is exactly the "same product
 * twice" confusion that caused the stocktake misses above.
 */
export function catalogItems<T extends { active: boolean; stock_category_id: string; ambient_duplicate_of?: string | null }>(
    items: T[],
    categories: { value: string; label: string }[],
): T[] {
    const ids = stocktakeCategoryIds(categories);
    return items.filter((i) => i.active && ids.has(i.stock_category_id) && !i.ambient_duplicate_of);
}

type StockItemPrismaLike = {
    enumOption: { findMany: (args: never) => Promise<{ value: string; label: string }[]> };
    stockItem: { findMany: (args: never) => Promise<import("@prisma/client").StockItem[]> };
};

/** The Weekly Stocktake items, read straight from the database (for services that query Prisma rather than the
 * table cache) — see stocktakeItems for exactly what that includes. Fetches every stock item and filters in JS
 * rather than encoding the active-or-ambient-duplicate OR as a Prisma where — one filter function both this and
 * the table-cache path (stocktakeItems) share, instead of the two ever being able to drift apart. */
export async function loadStocktakeItems(prisma: StockItemPrismaLike) {
    const [categories, items] = await Promise.all([
        prisma.enumOption.findMany({ where: { enum_type: "stock_category" } } as never),
        prisma.stockItem.findMany({} as never),
    ]);
    return stocktakeItems(items, categories);
}

/** The catalog items, read straight from the database — see catalogItems for exactly what that excludes. */
export async function loadCatalogItems(prisma: StockItemPrismaLike) {
    const [categories, items] = await Promise.all([
        prisma.enumOption.findMany({ where: { enum_type: "stock_category" } } as never),
        prisma.stockItem.findMany({} as never),
    ]);
    return catalogItems(items, categories);
}
