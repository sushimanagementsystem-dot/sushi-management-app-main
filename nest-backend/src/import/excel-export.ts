// Inverse of excel-import.ts: dumps every table in IMPORT_ORDER into one
// workbook with the exact layout the importer reads (one sheet per table,
// named after the table, header row = the table's column names in schema
// order). Downloading the workbook and uploading it again is therefore a
// no-op sync, and it can be edited in Excel and uploaded as the next version.
//
// Like excel-import.ts this is plain (no NestJS DI) so it can be called
// from a script with its own PrismaClient.

import * as XLSX from "xlsx";
import { Prisma, type PrismaClient } from "@prisma/client";
import { IMPORT_ORDER, type ImportTable } from "./import-config.js";

export type ExportSheetSummary = { sheet: string; rows: number };

export type ExportResult = {
    buffer: Buffer;
    sheets: ExportSheetSummary[];
    /** Cells that could not be written faithfully (e.g. over Excel's cell size limit). */
    warnings: string[];
};

// Excel's hard limit for one cell's text; longer strings are cut by the file format.
const MAX_CELL_CHARS = 32767;
const DATE_FORMAT = "yyyy-mm-dd hh:mm:ss";

/** Scalar column names of a Prisma model in schema order — the sheet header row. */
function columnsFor(table: ImportTable): string[] {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name.toLowerCase() === table.model.toLowerCase());
    if (!model) throw new Error(`No Prisma model for delegate "${table.model}"`);
    return model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name);
}

/** Converts a DB value into the cell value the importer's buildRowData()/Prisma accept back. */
function toCell(value: unknown, table: ImportTable, column: string): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Prisma.Decimal) return value.toNumber();
    if (typeof value === "bigint") return Number(value);
    if (table.json?.includes(column)) return JSON.stringify(value); // importer JSON.parse()s these back
    if (typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
    return value;
}

export async function exportExcelDatabase(prisma: PrismaClient): Promise<ExportResult> {
    const wb = XLSX.utils.book_new();
    const sheets: ExportSheetSummary[] = [];
    const warnings: string[] = [];

    for (const table of IMPORT_ORDER) {
        const columns = columnsFor(table);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dbRows: Record<string, unknown>[] = await (prisma as any)[table.model].findMany({ orderBy: { [columns[0]]: "asc" } });

        const rows = dbRows.map((dbRow, i) => {
            const out: Record<string, unknown> = {};
            for (const column of columns) {
                let cell = toCell(dbRow[column], table, column);
                if (typeof cell === "string" && cell.length > MAX_CELL_CHARS) {
                    warnings.push(`${table.sheet}.${column} row ${i + 2}: ${cell.length} characters, cut to Excel's ${MAX_CELL_CHARS} limit`);
                    cell = cell.slice(0, MAX_CELL_CHARS);
                }
                out[column] = cell;
            }
            return out;
        });

        // header: keeps the column row even when the table is empty
        const ws = XLSX.utils.json_to_sheet(rows, { header: columns, cellDates: true, dateNF: DATE_FORMAT });
        XLSX.utils.book_append_sheet(wb, ws, table.sheet);
        sheets.push({ sheet: table.sheet, rows: rows.length });
    }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return { buffer, sheets, warnings };
}
