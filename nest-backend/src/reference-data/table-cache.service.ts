import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { toModelName } from "../common/model-name.util.js";

type Delegate = { findMany: () => Promise<Record<string, unknown>[]> };

/**
 * Whole-table read cache for small, rarely-changing reference/config
 * tables (brand, kiosk, supplier, product, stock_item, component,
 * field_schema, table_schema, ...) — the same tables the owner edits via
 * the generic Data Tables engine (see DataTablesService) and that kiosk
 * form bootstraps read on every visit.
 *
 * Deliberately whole-table, not per-filter: these tables are small
 * (dozens to a few hundred rows), so one cached array serves every
 * caller's own in-memory .filter() instead of each distinct WHERE clause
 * needing its own cache entry — far fewer round trips to Neon, whose
 * per-query latency (~250-300ms from this environment) otherwise
 * dominates any endpoint that reads more than one table.
 *
 * Invalidation is the other half of the contract: DataTablesService is
 * the only write path for these tables (owner edits), so it calls
 * invalidate(tableName) after every save/delete — see its
 * save/delete/bulkSave methods. A cache entry is never allowed to go
 * stale silently; the moment the underlying table changes, the next read
 * re-fetches.
 */
@Injectable()
export class TableCacheService {
    private cache = new Map<string, Promise<Record<string, unknown>[]>>();

    constructor(private readonly prisma: PrismaService) {}

    async getAll<T = Record<string, unknown>>(tableName: string): Promise<T[]> {
        let pending = this.cache.get(tableName);
        if (!pending) {
            const delegate = (this.prisma as unknown as Record<string, Delegate>)[toModelName(tableName)];
            pending = delegate.findMany();
            this.cache.set(tableName, pending);
            // A failed fetch must not poison the cache for the next caller.
            pending.catch(() => this.cache.delete(tableName));
        }
        return pending as Promise<T[]>;
    }

    invalidate(tableName: string): void {
        this.cache.delete(tableName);
    }

    invalidateAll(): void {
        this.cache.clear();
    }
}
