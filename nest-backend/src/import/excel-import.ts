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
    const wb = XLSX.read(fileBuffer, { cellDates: true, type: "buffer" });
    const results: ImportTableResult[] = [];

    for (const table of IMPORT_ORDER) {
        const sheet = wb.Sheets[table.sheet];
        if (!sheet) {
            results.push({
                sheet: table.sheet,
                rows: 0,
                upserted: 0,
                errors: [{ row: -1, message: "Sheet not found in workbook" }],
            });
            continue;
        }

        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: null,
            raw: true,
        });
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

        results.push(result);
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
        data[key] = value;
    }
    return data;
}
