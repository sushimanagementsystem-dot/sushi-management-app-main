import { Injectable, NotFoundException } from "@nestjs/common";
import type { WorkBook } from "xlsx";
import { PrismaService } from "../prisma/prisma.service.js";
import { TableCacheService } from "../reference-data/table-cache.service.js";
import { SettingsService } from "../reference-data/settings.service.js";
import { IMPORT_ORDER } from "./import-config.js";
import { countSheetRows, importSingleTable, parseWorkbook, type ImportTableResult } from "./excel-import.js";

export type ImportSheetPreview = { sheet: string; rows: number; present: boolean };

const SESSION_TTL_MS = 30 * 60 * 1000; // abandoned uploads (tab closed mid-way) get reaped, not leaked forever

type Session = { wb: WorkBook; createdAt: number };

/**
 * Backs the dashboard's step-by-step Upload Data page: the workbook is
 * parsed once and held in memory under an importId, so each sheet can be
 * upserted one at a time (one HTTP round trip per table) and the page can
 * show live per-sheet progress instead of one long spinner for the whole
 * file. IMPORT_ORDER's dependency order only holds if steps are called in
 * order — nothing here re-validates that, since the only caller is the
 * page itself driving a sequential loop.
 *
 * Deliberately in-memory rather than a temp DB table: this is a single
 * admin re-running an occasional bulk sync, not a multi-instance
 * concurrent workload, so there's nothing here that needs to survive a
 * server restart or be visible across processes.
 */
@Injectable()
export class ImportSessionService {
    private readonly sessions = new Map<string, Session>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly settings: SettingsService,
    ) {}

    start(fileBuffer: Buffer): { importId: string; sheets: ImportSheetPreview[] } {
        this.reap();
        const wb = parseWorkbook(fileBuffer);
        const importId = crypto.randomUUID();
        this.sessions.set(importId, { wb, createdAt: Date.now() });

        const sheets = IMPORT_ORDER.map((table) => ({
            sheet: table.sheet,
            rows: countSheetRows(wb, table),
            present: Boolean(wb.Sheets[table.sheet]),
        }));
        return { importId, sheets };
    }

    async step(importId: string, index: number): Promise<{ result: ImportTableResult; done: boolean }> {
        const session = this.sessions.get(importId);
        if (!session) {
            throw new NotFoundException("This upload has expired or was never started — choose the file and upload again.");
        }
        const table = IMPORT_ORDER[index];
        if (!table) {
            throw new NotFoundException("No such step in this import.");
        }

        const result = await importSingleTable(this.prisma, session.wb, table);
        const done = index === IMPORT_ORDER.length - 1;
        if (done) {
            // Same blunt "invalidate everything" reasoning as the
            // single-shot import — a run can touch any number of cached
            // tables across its steps, so clear all of them once at the end
            // rather than per-step.
            this.tableCache.invalidateAll();
            this.settings.invalidate();
            this.sessions.delete(importId);
        }
        return { result, done };
    }

    private reap(): void {
        const cutoff = Date.now() - SESSION_TTL_MS;
        for (const [id, session] of this.sessions) {
            if (session.createdAt < cutoff) this.sessions.delete(id);
        }
    }
}
