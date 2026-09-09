import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, StockItem } from "@prisma/client";

@Injectable()
export class WeeklyStocktakeService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(kiosk: Kiosk) {
        const businessDate = startOfTodayUtc();

        const [categories, allItems, header] = await Promise.all([
            this.enumOptions.getOptions("stock_category"),
            this.tableCache.getAll<StockItem>("stock_item"),
            this.prisma.stocktakeHeader.findFirst({ where: { kiosk_id: kiosk.kiosk_id, stocktake_date: businessDate } }),
        ]);
        const categoryLabelById = new Map(categories.map((c) => [c.value, c.label]));
        const nonWasteCatIds = new Set(categories.filter((c) => !c.label.toLowerCase().includes("per 100g")).map((c) => c.value));

        const items = allItems.filter((r) => r.active && nonWasteCatIds.has(r.stock_category_id));

        const existingCounts: Record<string, number> = {};
        if (header) {
            const lines = await this.prisma.stocktakeLine.findMany({ where: { stocktake_header_id: header.stocktake_header_id } });
            for (const line of lines) existingCounts[line.stock_item_id] = Number(line.counted_qty);
        }

        return {
            businessDate: toDateStr(businessDate),
            items: items.map((r) => ({ id: r.stock_item_id, name: r.name, unit: r.count_unit, cat: categoryLabelById.get(r.stock_category_id) ?? "Other" })),
            existingCounts,
            alreadySubmitted: !!header,
        };
    }
}
