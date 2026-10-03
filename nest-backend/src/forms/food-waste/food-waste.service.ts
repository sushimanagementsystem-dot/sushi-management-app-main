import { Injectable } from "@nestjs/common";
import { SettingsService } from "../../reference-data/settings.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, StockItem } from "@prisma/client";

/**
 * Master item list = every active stock item with "Available for Food
 * Waste" on — that flag is the one deliberate gate (see
 * col.stock_item.food_waste_eligible's help text), so nothing else should
 * narrow the list further. This used to also require stock_category_id to
 * be in the Weekly Stocktake category set (stocktakeCategoryIds), which
 * silently hid every item in the "Food Waste (per 100g)" tracking-only
 * category — the one category that exists FOR this form, since its label
 * contains "per 100g" and stocktakeCategoryIds excludes anything worded
 * that way. Found live: Tuna/Salmon/Surimi/etc (the per-100g tracking
 * items from an earlier pass) were never selectable here at all. The only
 * grouping left is the two buckets Food Waste itself cares about —
 * everything not explicitly PACKAGING is FOOD, so a category never silently
 * disappears from the list just because a setting wasn't kept up to date.
 */
@Injectable()
export class FoodWasteService {
    constructor(
        private readonly settings: SettingsService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(_kiosk: Kiosk) {
        const [packagingCatsRaw, allItems] = await Promise.all([
            this.settings.get("FOOD_WASTE_PACKAGING_CATEGORIES"),
            this.tableCache.getAll<StockItem>("stock_item"),
        ]);
        const packagingCats = (packagingCatsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

        const mapped = allItems
            // ambient_duplicate_of set = a "Kiosk (ambient product only)" stocktake-only duplicate row (same physical
            // stock as its real counterpart, counted separately just for stocktake accuracy) — Evan: these "should
            // not be issued in any other sheet". Excluded here even though it's otherwise eligible.
            .filter((r) => r.active && r.food_waste_eligible && !r.ambient_duplicate_of)
            .map((r) => ({
                id: r.stock_item_id,
                name: r.name,
                unit: r.count_unit,
                cat: packagingCats.includes(r.stock_category_id) ? "PACKAGING" : "FOOD",
                measurementType: r.measurement_type === "COUNT" ? "COUNT" : "WEIGHT_G",
            }));

        return { businessDate: toDateStr(startOfTodayUtc()), items: mapped };
    }
}
