import { Injectable } from "@nestjs/common";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, StockItem } from "@prisma/client";

@Injectable()
export class MoveStockService {
    constructor(
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(kiosk: Kiosk) {
        const [categories, allItems, allKiosks, reasons] = await Promise.all([
            this.enumOptions.getOptions("stock_category"),
            this.tableCache.getAll<StockItem>("stock_item"),
            this.tableCache.getAll<Kiosk>("kiosk"),
            this.enumOptions.getOptions("transfer_reason"),
        ]);
        const categoryLabelById = new Map(categories.map((c) => [c.value, c.label]));

        return {
            businessDate: toDateStr(startOfTodayUtc()),
            thisKiosk: { id: kiosk.kiosk_id, name: kiosk.name },
            kiosks: allKiosks.filter((k) => k.active).map((k) => ({ id: k.kiosk_id, name: k.name })),
            items: allItems.filter((r) => r.active).map((r) => ({ id: r.stock_item_id, name: r.name, unit: r.count_unit, cat: categoryLabelById.get(r.stock_category_id) ?? "Other" })),
            reasons,
        };
    }
}
