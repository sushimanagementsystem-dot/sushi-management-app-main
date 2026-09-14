// Framework-agnostic core of the Excel import/reseed pipeline — shared
// by prisma/seed.ts (dev seeding from a local file path) and
// ImportService (the future POST /import/excel endpoint used at client
// handover, see this folder's import.service.ts / import.controller.ts).
//
// Deliberately plain (no NestJS DI) so prisma/seed.ts — which runs
// outside Nest's application context via `prisma db seed` — can call it
// with its own PrismaClient instance.

import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import { IMPORT_ORDER, type ImportTable } from "./import-config.js";

export type ImportRowError = { row: number; message: string };

export type ImportTableResult = {
    sheet: string;
    rows: number;
    upserted: number;
    errors: ImportRowError[];
};

/** Parses the uploaded workbook once — callers that need to process sheets
 * one at a time (the dashboard's step-by-step import) reuse this instead
 * of re-parsing the buffer on every step. */
export function parseWorkbook(fileBuffer: Buffer): XLSX.WorkBook {
    return XLSX.read(fileBuffer, { cellDates: true, type: "buffer" });
}

/** Row count for a sheet without upserting anything — lets the dashboard
 * show the full sheet list (and how many rows each has) before the first
 * table is actually synced. */
export function countSheetRows(wb: XLSX.WorkBook, table: ImportTable): number {
    const sheet = wb.Sheets[table.sheet];
    if (!sheet) return 0;
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true }).length;
}

/**
 * Upserts one sheet's rows into Postgres via `prisma`. Shared by the
 * whole-workbook import below and the dashboard's one-sheet-at-a-time
 * step endpoint (see ImportSessionService) — same per-row error handling
 * either way, just called once per table instead of in one big loop.
 */
export async function importSingleTable(prisma: PrismaClient, wb: XLSX.WorkBook, table: ImportTable): Promise<ImportTableResult> {
    const sheet = wb.Sheets[table.sheet];
    if (!sheet) {
        return { sheet: table.sheet, rows: 0, upserted: 0, errors: [{ row: -1, message: "Sheet not found in workbook" }] };
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
    const result: ImportTableResult = { sheet: table.sheet, rows: rows.length, upserted: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            const data = buildRowData(row, table);
            const where = table.pk(row);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (prisma as any)[table.model].upsert({ where, create: data, update: data });
            result.upserted++;
        } catch (err) {
            result.errors.push({ row: i, message: err instanceof Error ? err.message : String(err) });
        }
    }

    return result;
}

/**
 * Upserts every sheet in `fileBuffer` into Postgres via `prisma`, in
 * IMPORT_ORDER's dependency order (parents before children) so foreign
 * keys always resolve. Upsert (not create) makes this safe to re-run —
 * re-uploading the same or an updated workbook syncs existing rows
 * instead of failing on duplicate primary keys, which is exactly what
 * "client uploads their own database at handover" needs.
 *
 * A sheet missing from the workbook, or a row that fails validation
 * (missing required field, bad reference), is recorded in the result
 * and skipped — one bad row never aborts the whole import.
 */
export async function importExcelDatabase(
    prisma: PrismaClient,
    fileBuffer: Buffer,
): Promise<ImportTableResult[]> {
    const wb = parseWorkbook(fileBuffer);
    const results: ImportTableResult[] = [];
    for (const table of IMPORT_ORDER) {
        results.push(await importSingleTable(prisma, wb, table));
    }
    return results;
}

function buildRowData(row: Record<string, unknown>, table: ImportTable): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
        if (table.json?.includes(key) && typeof value === "string") {
            try {
                data[key] = JSON.parse(value);
            } catch {
                data[key] = value; // not valid JSON — store as-is rather than lose it
            }
            continue;
        }
        if (table.stringify?.includes(key) && (typeof value === "number" || typeof value === "boolean")) {
            data[key] = String(value);
            continue;
        }
        data[key] = value;
    }
    return data;
}
