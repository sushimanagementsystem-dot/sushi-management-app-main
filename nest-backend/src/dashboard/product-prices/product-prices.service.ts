import { Injectable } from "@nestjs/common";
import type { StockItem } from "@prisma/client";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { stocktakeItems } from "../../common/stocktake-items.util.js";

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
}
