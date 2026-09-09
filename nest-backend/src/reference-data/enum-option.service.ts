import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { EnumOption } from "@prisma/client";

/**
 * Cached active options for an owner-editable enum_type — mirrors
 * backend/core/Util.js's getEnumOptions(). Used by form bootstrap actions
 * (populating dropdowns) and by validation (rejecting a submitted value
 * that isn't a current active option).
 */
@Injectable()
export class EnumOptionService {
    private cache: Map<string, EnumOption[]> | null = null;

    constructor(private readonly prisma: PrismaService) {}

    async getOptions(enumType: string): Promise<EnumOption[]> {
        const all = await this.loadAll();
        return all.get(enumType) ?? [];
    }

    async isValidValue(enumType: string, value: string): Promise<boolean> {
        const options = await this.getOptions(enumType);
        return options.some((o) => o.value === value);
    }

    invalidate(): void {
        this.cache = null;
    }

    private async loadAll(): Promise<Map<string, EnumOption[]>> {
        if (this.cache) return this.cache;
        const rows = await this.prisma.enumOption.findMany({
            where: { active: true },
            orderBy: { sort_order: "asc" },
        });
        const map = new Map<string, EnumOption[]>();
        for (const row of rows) {
            if (!map.has(row.enum_type)) map.set(row.enum_type, []);
            map.get(row.enum_type)!.push(row);
        }
        this.cache = map;
        return map;
    }
}
