import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk, Product } from "@prisma/client";

@Injectable()
export class MorningWasteService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(kiosk: Kiosk) {
        const businessDate = startOfTodayUtc();
        const [categories, allProducts, existingRows, submittedToday] = await Promise.all([
            this.enumOptions.getOptions("product_category"),
            this.tableCache.getAll<Product>("product"),
            this.prisma.productMovement.findMany({ where: { kiosk_id: kiosk.kiosk_id, movement_type: "EXPIRED_WASTE", movement_date: businessDate } }),
            this.prisma.submission.findFirst({
                where: { processing_key: `MORNING_WASTE|${kiosk.kiosk_id}|${toDateStr(businessDate)}`, processing_status: "PROCESSED" },
            }),
        ]);
        const categoryLabelById = new Map(categories.map((c) => [c.value, c.label]));

        const products = allProducts.filter((p) => p.active && (p.brand_id === null || p.brand_id === kiosk.brand_id));

        return {
            businessDate: toDateStr(businessDate),
            products: products.map((p) => ({ id: p.product_id, name: p.name, cat: categoryLabelById.get(p.product_category_id) ?? "Other" })),
            existingLines: existingRows.map((r) => ({ product_id: r.product_id, qty: Number(r.qty) })),
            alreadySubmitted: !!submittedToday,
            wasNoWaste: !!submittedToday && existingRows.length === 0,
        };
    }
}
