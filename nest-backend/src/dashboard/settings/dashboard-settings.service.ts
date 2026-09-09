import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import type { Component, Product } from "@prisma/client";

/**
 * Owner-facing editor for the `setting` table — port of
 * backend/dashboard/Settings.js. The section/field layout itself lives in
 * the frontend as a hand-built (not schema-driven) page, same as the old
 * system — this only serves the raw data + reference picker lists.
 */
@Injectable()
export class DashboardSettingsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly enumOptions: EnumOptionService,
        private readonly settings: SettingsService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData() {
        const [settingRows, allComponents, allProducts, stockCategories] = await Promise.all([
            this.prisma.setting.findMany(),
            this.tableCache.getAll<Component>("component"),
            this.tableCache.getAll<Product>("product"),
            this.enumOptions.getOptions("stock_category"),
        ]);

        return {
            settings: settingRows.map((s) => ({ key: s.setting_key, value: s.value, description: s.description, label: s.label })),
            components: allComponents.filter((c) => c.active).map((c) => ({ id: c.component_id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
            products: allProducts.filter((p) => p.active).map((p) => ({ id: p.product_id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
            stockCategories: stockCategories.map((o) => ({ id: o.value, name: o.label })),
        };
    }

    /** changes: {setting_key: newValue}. Writes every key present — the
     * frontend always sends the full current set on Save, so no diffing needed. */
    async save(changes: Record<string, unknown>): Promise<void> {
        await this.prisma.$transaction(
            Object.entries(changes ?? {}).map(([key, value]) =>
                this.prisma.setting.update({ where: { setting_key: key }, data: { value: String(value) } }),
            ),
        );
        this.settings.invalidate();
    }
}
