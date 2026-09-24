import * as XLSX from "xlsx";
import { startOfWeekUtc, toDateStr } from "../../common/date.util.js";

export type KioskRef = { id: string; name: string };
export type LabourRow = { kioskId: string; kioskName: string; weekStart: string; hours: number; hourlyRate: number | null; labourCost: number | null };
export type ParsedLabour = { rows: LabourRow[]; errors: string[] };

const HEADERS = {
    kiosk: ["kiosk", "kiosk name", "store", "location", "site", "shop"],
    week: ["week", "week start", "week starting", "week commencing", "week of", "w/c", "wc", "week beginning"],
    hours: ["total hours", "hours", "total hrs", "hrs", "labour hours", "labor hours", "hours worked"],
    cost: ["labour cost", "labor cost", "cost", "total cost", "wages", "labour", "labor", "labour amount", "total labour"],
} as const;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The layout the dashboard hands out as a template: one row per kiosk per week. */
export const TEMPLATE_HEADER = ["Week starting", "Kiosk", "Total hours", "Labour cost (optional)"];

function findColumn(header: string[], names: readonly string[]): number {
    return header.findIndex((h) => names.includes(h.replace(/\s*\(.*\)\s*$/, "").trim()));
}

/** Excel dates arrive as Date objects (cellDates) or text such as 22/09/2026 (Irish day-first) or 2026-09-22. */
export function parseDateCell(v: unknown): Date | null {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
        const ms = Math.round((v - 25569) * 86400 * 1000); // Excel serial day number
        const d = new Date(ms);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    const s = String(v ?? "").trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (m) return new Date(Date.UTC(+m[3]! < 100 ? 2000 + +m[3]! : +m[3]!, +m[2]! - 1, +m[1]!));
    return null;
}

function parseNumber(v: unknown): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v ?? "").replace(/[€£,\s]/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function matchKiosk(cell: unknown, kiosks: KioskRef[]): KioskRef | null {
    const c = norm(cell);
    if (!c) return null;
    const exact = kiosks.find((k) => norm(k.id) === c || norm(k.name) === c);
    if (exact) return exact;
    // "Sushi Circle Limerick" / "Limerick kiosk" -> the one kiosk whose name is contained in it (or contains it).
    const partial = kiosks.filter((k) => c.includes(norm(k.name)) || norm(k.name).includes(c));
    return partial.length === 1 ? partial[0]! : null;
}

/**
 * Reads a weekly labour report (.xlsx or .csv — a Google Sheet downloads as either) into one row per kiosk per week.
 * Needs a Kiosk column and a Total hours column; Week starting and Labour cost columns are optional. With no week
 * column, every row is for `defaultWeek`. Nothing is guessed: a row that cannot be read is reported as an error with
 * its row number, and the caller decides whether to submit the good rows.
 */
export function parseLabourReport(buffer: Buffer, kiosks: KioskRef[], opts: { defaultWeek?: Date; hourlyRate?: number | null } = {}): ParsedLabour {
    const errors: string[] = [];
    let sheet: XLSX.WorkSheet | undefined;
    try {
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
        sheet = wb.Sheets[wb.SheetNames[0]!];
    } catch {
        return { rows: [], errors: ["That file could not be read. Upload an Excel (.xlsx) or CSV file."] };
    }
    if (!sheet) return { rows: [], errors: ["The file has no sheet with data in it."] };

    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    // The header is the first row that has both a kiosk and an hours column (report titles above it are skipped).
    let headerIndex = -1;
    let cols = { kiosk: -1, week: -1, hours: -1, cost: -1 };
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
        const h = (grid[i] ?? []).map(norm);
        const found = { kiosk: findColumn(h, HEADERS.kiosk), week: findColumn(h, HEADERS.week), hours: findColumn(h, HEADERS.hours), cost: findColumn(h, HEADERS.cost) };
        if (found.kiosk >= 0 && found.hours >= 0) {
            headerIndex = i;
            cols = found;
            break;
        }
    }
    if (headerIndex < 0) return { rows: [], errors: [`Couldn't find the columns. The first rows need a "Kiosk" column and a "Total hours" column (see the template).`] };

    const rows: LabourRow[] = [];
    const seen = new Set<string>();
    const rate = opts.hourlyRate ?? null;
    for (let i = headerIndex + 1; i < grid.length; i++) {
        const line = grid[i] ?? [];
        const rowNo = i + 1;
        const kioskCell = line[cols.kiosk];
        if (norm(kioskCell) === "" && norm(line[cols.hours]) === "") continue;
        if (/^(grand )?total/.test(norm(kioskCell))) continue; // a totals row in the sheet is not a kiosk

        const kiosk = matchKiosk(kioskCell, kiosks);
        if (!kiosk) {
            errors.push(`Row ${rowNo}: "${String(kioskCell).trim()}" is not one of your kiosks (${kiosks.map((k) => k.name).join(", ")}).`);
            continue;
        }
        const hours = parseNumber(line[cols.hours]);
        if (hours === null || hours < 0) {
            errors.push(`Row ${rowNo} (${kiosk.name}): total hours must be a number, 0 or more.`);
            continue;
        }
        let weekStart: Date | null = null;
        if (cols.week >= 0 && norm(line[cols.week]) !== "") {
            const d = parseDateCell(line[cols.week]);
            if (!d) {
                errors.push(`Row ${rowNo} (${kiosk.name}): "${String(line[cols.week]).trim()}" is not a date.`);
                continue;
            }
            weekStart = startOfWeekUtc(d);
        } else if (opts.defaultWeek) {
            weekStart = startOfWeekUtc(opts.defaultWeek);
        }
        if (!weekStart) {
            errors.push(`Row ${rowNo} (${kiosk.name}): no week — add a "Week starting" column or pick the week above.`);
            continue;
        }
        const key = `${kiosk.id}|${toDateStr(weekStart)}`;
        if (seen.has(key)) {
            errors.push(`Row ${rowNo}: ${kiosk.name} appears twice for the week of ${toDateStr(weekStart)}.`);
            continue;
        }
        seen.add(key);

        const costCell = cols.cost >= 0 ? parseNumber(line[cols.cost]) : null;
        if (costCell !== null && costCell < 0) {
            errors.push(`Row ${rowNo} (${kiosk.name}): labour cost can't be negative.`);
            continue;
        }
        const labourCost = costCell !== null ? Math.round(costCell * 100) / 100 : rate !== null ? Math.round(hours * rate * 100) / 100 : null;
        rows.push({ kioskId: kiosk.id, kioskName: kiosk.name, weekStart: toDateStr(weekStart), hours: Math.round(hours * 100) / 100, hourlyRate: costCell !== null ? null : rate, labourCost });
    }
    if (!rows.length && !errors.length) errors.push("The file has a header but no rows under it.");
    return { rows, errors };
}

/** A ready-to-fill sheet: the header, and one line per active kiosk for the given week with the hours left blank. */
export function buildLabourTemplate(kiosks: KioskRef[], weekStart: Date): Buffer {
    const data = [TEMPLATE_HEADER, ...kiosks.map((k) => [toDateStr(startOfWeekUtc(weekStart)), k.name, "", ""])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Labour");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

