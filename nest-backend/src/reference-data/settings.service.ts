import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Cached key/value settings reads — mirrors backend/core/Util.js's
 * getSetting()/getSettingNum(). Settings change rarely (owner-edited via
 * the Settings dashboard page) so an in-memory cache with explicit
 * invalidation on write is worth it; this is exactly the kind of small,
 * real behavior (caching, parsing) that earns its own service rather than
 * inlining Prisma calls in every consumer (the production-planning engine
 * reads a dozen of these per run).
 */
@Injectable()
export class SettingsService {
    private cache: Map<string, string | null> | null = null;

    constructor(private readonly prisma: PrismaService) {}

    async get(key: string): Promise<string | null> {
        const all = await this.loadAll();
        return all.get(key) ?? null;
    }

    async getNumber(key: string): Promise<number | null> {
        const raw = await this.get(key);
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isNaN(n) ? null : n;
    }

    /** Call after any write to the `setting` table (see dashboard Settings module). */
    invalidate(): void {
        this.cache = null;
    }

    private async loadAll(): Promise<Map<string, string | null>> {
        if (this.cache) return this.cache;
        const rows = await this.prisma.setting.findMany();
        this.cache = new Map(rows.map((r) => [r.setting_key, r.value]));
        return this.cache;
    }
}
