import { Injectable } from "@nestjs/common";
import { SettingsService } from "../../reference-data/settings.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { stocktakeCategoryIds } from "../../common/stocktake-items.util.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, StockItem } from "@prisma/client";

/**
 * Master item list = exactly the Weekly Stocktake list (stocktakeCategoryIds
 * — the one shared definition, so this can never drift out of sync with
 * Stock Take the way the old per-category allow-list did). The only filter
 * beyond that is the "Available for Food Waste" toggle on Stock Item; the
 * only grouping left is the two buckets Food Waste itself cares about —
 * everything not explicitly PACKAGING is FOOD, so a category never silently
 * disappears from the list just because a setting wasn't kept up to date.
 */
@Injectable()
export class FoodWasteService {
    constructor(
        private readonly settings: SettingsService,
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(_kiosk: Kiosk) {
        const [packagingCatsRaw, allItems, categories] = await Promise.all([
            this.settings.get("FOOD_WASTE_PACKAGING_CATEGORIES"),
            this.tableCache.getAll<StockItem>("stock_item"),
            this.enumOptions.getOptions("stock_category"),
        ]);
        const packagingCats = (packagingCatsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const stockTakeCatIds = stocktakeCategoryIds(categories);

        const mapped = allItems
            .filter((r) => r.active && r.food_waste_eligible && stockTakeCatIds.has(r.stock_category_id))
            .map((r) => ({
                id: r.stock_item_id,
                name: r.name,
                unit: r.count_unit,
                cat: packagingCats.includes(r.stock_category_id) ? "PACKAGING" : "FOOD",
            }));

        return { businessDate: toDateStr(startOfTodayUtc()), items: mapped };
    }
}
