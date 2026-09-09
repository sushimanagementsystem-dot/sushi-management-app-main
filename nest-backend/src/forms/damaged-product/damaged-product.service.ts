import { Injectable } from "@nestjs/common";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, Product } from "@prisma/client";

@Injectable()
export class DamagedProductService {
    constructor(
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(kiosk: Kiosk) {
        const [categories, allProducts] = await Promise.all([
            this.enumOptions.getOptions("product_category"),
            this.tableCache.getAll<Product>("product"),
        ]);
        const categoryLabelById = new Map(categories.map((c) => [c.value, c.label]));
        const products = allProducts.filter((p) => p.active && (p.brand_id === null || p.brand_id === kiosk.brand_id));

        return {
            businessDate: toDateStr(startOfTodayUtc()),
            products: products.map((p) => ({ id: p.product_id, name: p.name, cat: categoryLabelById.get(p.product_category_id) ?? "Other" })),
        };
    }
}
