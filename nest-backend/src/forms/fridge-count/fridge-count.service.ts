import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, Product, ProductionPar } from "@prisma/client";

@Injectable()
export class FridgeCountService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(kiosk: Kiosk) {
        const businessDate = startOfTodayUtc();

        const [pars, categories, allProducts, existingRows] = await Promise.all([
            this.tableCache.getAll<ProductionPar>("production_par"),
            this.enumOptions.getOptions("product_category"),
            this.tableCache.getAll<Product>("product"),
            this.prisma.fridgeCount.findMany({ where: { kiosk_id: kiosk.kiosk_id, business_date: businessDate } }),
        ]);
        const parProductIds = new Set(pars.filter((p) => p.kiosk_id === kiosk.kiosk_id).map((p) => p.product_id));
        const categoryLabelById = new Map(categories.map((c) => [c.value, c.label]));

        const products = allProducts.filter((p) => p.active && parProductIds.has(p.product_id));

        const existingCounts: Record<string, number> = {};
        for (const r of existingRows) existingCounts[r.product_id] = Number(r.counted_qty);

        return {
            businessDate: toDateStr(businessDate),
            products: products.map((p) => ({ id: p.product_id, name: p.name, cat: categoryLabelById.get(p.product_category_id) ?? "Other" })),
            existingCounts,
            alreadySubmitted: Object.keys(existingCounts).length > 0,
        };
    }
}
