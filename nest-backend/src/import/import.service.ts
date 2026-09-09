import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { TableCacheService } from "../reference-data/table-cache.service.js";
import { SettingsService } from "../reference-data/settings.service.js";
import { importExcelDatabase, type ImportTableResult } from "./excel-import.js";

/**
 * Thin NestJS wrapper around excel-import.ts's framework-agnostic
 * importExcelDatabase() — this is what the client-facing "upload your
 * own database" endpoint (see import.controller.ts) calls. Kept
 * separate from the core function so prisma/seed.ts can call the same
 * logic without needing Nest's DI container at all (it builds its own
 * PrismaClient there — see prisma/seed.ts).
 */
@Injectable()
export class ImportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly settings: SettingsService,
    ) {}

    async importFromBuffer(fileBuffer: Buffer): Promise<ImportTableResult[]> {
        const results = await importExcelDatabase(this.prisma, fileBuffer);
        // Bulk-upserts every sheet's table directly via Prisma, bypassing
        // every normal write path (DataTablesService.saveTableRow etc.)
        // that would otherwise call TableCacheService.invalidate() for
        // just the table it touched. An import can touch any number of
        // cached tables (kiosk, stock_item, product, field_schema, …) in
        // one run, so invalidating everything is the correct blunt tool
        // here — same reasoning as the dashboard's manual refresh_cache
        // action, just automatic instead of requiring the admin to
        // remember to click it after every import.
        this.tableCache.invalidateAll();
        this.settings.invalidate();
        return results;
    }
}
