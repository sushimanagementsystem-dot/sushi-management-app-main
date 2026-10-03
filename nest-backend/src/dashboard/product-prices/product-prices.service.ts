import { Injectable } from "@nestjs/common";
import type { StockItem } from "@prisma/client";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { stocktakeCategoryIds, stocktakeItems } from "../../common/stocktake-items.util.js";

/**
 * Product Prices → "Stock Items / Ingredients": exactly the items on the Weekly Stocktake (see stocktake-items.util.ts),
 * shown with their category and unit. Prices are one per item — the stock items are shared
 * by both brands, so there is nothing brand-specific to duplicate.
 */
@Injectable()
export class ProductPricesService {
    constructor(
        private readonly tableCache: TableCacheService,
        private readonly enumOptions: EnumOptionService,
    ) {}

    /** Every column of each Stock Take item's row (so the page can save it back as it does for any table) plus its category name. */
    async stockItemRows() {
        const [items, categories] = await Promise.all([this.tableCache.getAll<StockItem>("stock_item"), this.enumOptions.getOptions("stock_category")]);
        const label = new Map(categories.map((c) => [c.value, c.label]));
        const rows = stocktakeItems(items, categories)
            .map((i) => ({ ...i, category_label: label.get(i.stock_category_id) ?? i.stock_category_id }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.category_label.localeCompare(b.category_label));
        return { rows };
    }

    /**
     * Product Prices → "Food Waste Items (per 100g)": the deliberate
     * opposite of stockItemRows() above — active items in a "per 100g"
     * category (stocktakeCategoryIds excludes these from the Weekly
     * Stocktake set on purpose, since they're tracking-only, never
     * physically counted or ordered). Until now these had no cost-editing
     * UI anywhere: the main Stock Item list and this page's other section
     * both skip them for the same reason, so cost_per_100g sat permanently
     * blank and every Food Waste line against them came back uncosted.
     * Deliberately NOT exposed on the Stock Item Par / Supplier Items /
     * Weekly Stocktake side of the app — adding a cost here must not make
     * them orderable or par-trackable, they're not real purchasable items.
     */
    async foodWasteItemRows() {
        const [items, categories] = await Promise.all([this.tableCache.getAll<StockItem>("stock_item"), this.enumOptions.getOptions("stock_category")]);
        const stockTakeCatIds = stocktakeCategoryIds(categories);
        const label = new Map(categories.map((c) => [c.value, c.label]));
        const rows = items
            .filter((i) => i.active && !stockTakeCatIds.has(i.stock_category_id))
            .map((i) => ({ ...i, category_label: label.get(i.stock_category_id) ?? i.stock_category_id }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.category_label.localeCompare(b.category_label));
        return { rows };
    }
}
