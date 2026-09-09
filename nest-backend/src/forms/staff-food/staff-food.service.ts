import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, Product } from "@prisma/client";

/**
 * Bootstrap data for the Staff Food form — port of
 * backend/forms/FormStaffFood.js's getStaffFoodData. One product per staff
 * member per shift (owner rule): if this user already has an entry today
 * at this kiosk, the form preloads it so resubmitting edits rather than
 * duplicates (see StaffFoodProcessor's processing_key).
 */
@Injectable()
export class StaffFoodService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(kiosk: Kiosk, userId: string) {
        const businessDate = startOfTodayUtc();
        const [categories, allProducts, existing] = await Promise.all([
            this.enumOptions.getOptions("product_category"),
            this.tableCache.getAll<Product>("product"),
            this.prisma.staffFood.findFirst({ where: { kiosk_id: kiosk.kiosk_id, food_date: businessDate, user_id: userId } }),
        ]);
        const categoryLabelById = new Map(categories.map((c) => [c.value, c.label]));

        const products = allProducts.filter((p) => p.active && p.staff_food_eligible && (p.brand_id === null || p.brand_id === kiosk.brand_id));

        return {
            businessDate: toDateStr(businessDate),
            products: products.map((p) => ({
                id: p.product_id,
                name: p.name,
                cat: categoryLabelById.get(p.product_category_id) ?? "Other",
            })),
            existing: existing ? { product_id: existing.product_id } : null,
        };
    }
}
