import { Injectable } from "@nestjs/common";
import { SettingsService } from "../../reference-data/settings.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, StockItem } from "@prisma/client";

/** stock_category values grouped into Food Waste's own FOOD/PACKAGING buckets
 * — see backend/forms/FormFoodWaste.js's foodWasteGroupFor_. */
@Injectable()
export class FoodWasteService {
    constructor(
        private readonly settings: SettingsService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(_kiosk: Kiosk) {
        const [foodCatsRaw, packagingCatsRaw, allItems] = await Promise.all([
            this.settings.get("FOOD_WASTE_FOOD_CATEGORIES"),
            this.settings.get("FOOD_WASTE_PACKAGING_CATEGORIES"),
            this.tableCache.getAll<StockItem>("stock_item"),
        ]);
        const foodCats = (foodCatsRaw ?? "").split(",").map((s) => s.trim());
        const packagingCats = (packagingCatsRaw ?? "").split(",").map((s) => s.trim());

        const mapped = allItems
            .filter((r) => r.active && r.food_waste_eligible)
            .map((r) => ({
                id: r.stock_item_id,
                name: r.name,
                unit: r.count_unit,
                cat: foodCats.includes(r.stock_category_id) ? "FOOD" : packagingCats.includes(r.stock_category_id) ? "PACKAGING" : "",
            }))
            .filter((r) => r.cat !== "");

        return { businessDate: toDateStr(startOfTodayUtc()), items: mapped };
    }
}
