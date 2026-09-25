import * as XLSX from "xlsx";
import { toDateStr, startOfWeekUtc } from "../../common/date.util.js";

export type KioskRef = { id: string; name: string };
export type LabourRow = { kioskId: string; kioskName: string; weekStart: string; hours: number; hourlyRate: number | null; labourCost: number | null };
/** An employee whose payroll line couldn't be linked to a kiosk (no "Department name" on that row — e.g. a salaried
 *  employee who splits their week across kiosks with no fixed pattern). Shown to the owner so nothing is silently
 *  dropped; the Manual Hours section on the Profit page is how their pay gets attributed to the kiosks they covered. */
export type UnassignedPayrollLine = { name: string; type: string; amount: number };
export type ParsedPayroll = { rows: LabourRow[]; errors: string[]; notes: string[]; unassigned: UnassignedPayrollLine[] };

const HEADERS = {
    department: ["department name", "department", "kiosk", "kiosk name", "store", "location", "site"],
    type: ["type", "pay type", "line type"],
    employeeId: ["salary identifier", "employee id", "staff id", "id"],
    firstName: ["first name"],
    surname: ["surname", "last name"],
    hours: ["total worked hours (excl. breaks)", "total worked hours", "hours worked", "total hours", "hours"],
    salary: ["salary", "amount", "pay"],
} as const;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function findColumn(header: string[], names: readonly string[]): number {
    return header.findIndex((h) => names.includes(h.replace(/\s*\(.*\)\s*$/, "").trim()) || names.includes(h));
}

function parseNumber(v: unknown): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v ?? "").replace(/[€£,\s]/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function matchKiosk(name: string, kiosks: KioskRef[]): KioskRef | null {
    const c = norm(name);
    if (!c) return null;
    const exact = kiosks.find((k) => norm(k.id) === c || norm(k.name) === c);
    if (exact) return exact;
    const partial = kiosks.filter((k) => c.includes(norm(k.name)) || norm(k.name).includes(c));
    return partial.length === 1 ? partial[0]! : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reads the payroll export the kiosk operator already downloads from their punch-in system for payroll (one row per
 * employee per pay line — "Shifts", "Meal deduction", "Weekly salary", etc. — not the dashboard's own template) and
 * turns it into one Labour row per kiosk for the given week.
 *
 *  - "Shifts" rows carry real worked hours and are the only rows counted into a kiosk's Total Hours; every row's
 *    "Salary" (however the pay line is labelled) is added to that kiosk's Labour cost, so a negative meal-deduction
 *    line correctly reduces it — the deduction is money the kiosk didn't actually pay out, and Staff Food cost is
 *    already tracked separately from stock movements, so this avoids double-counting it.
 *  - A pay line can belong to more than one kiosk at once (the punch-in system lists them comma-separated, e.g. a
 *    combined meal deduction for someone who worked two kiosks that week). That amount is split between the kiosks
 *    in proportion to the hours that same employee logged at each one on their "Shifts" rows in this file; with no
 *    hours to weigh by, it's split evenly and a note says so.
 *  - A pay line with no Department at all (a salaried employee not tied to a kiosk in the punch-in system) can't be
 *    attributed automatically — it's listed under "unassigned" instead of guessed at. The Profit page's Manual Hours
 *    section is how the owner attributes that person's pay to the kiosks they actually covered that week.
 */
export function parseLabourReport(buffer: Buffer, kiosks: KioskRef[], opts: { weekOf: Date }): ParsedPayroll {
    const errors: string[] = [];
    const notes: string[] = [];
    const unassigned: UnassignedPayrollLine[] = [];
    let sheet: XLSX.WorkSheet | undefined;
    try {
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
        sheet = wb.Sheets[wb.SheetNames[0]!];
    } catch {
        return { rows: [], errors: ["That file could not be read. Upload the payroll export as an Excel (.xlsx) or CSV file."], notes: [], unassigned: [] };
    }
    if (!sheet) return { rows: [], errors: ["The file has no sheet with data in it."], notes: [], unassigned: [] };

    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    let headerIndex = -1;
    let cols = { department: -1, type: -1, employeeId: -1, firstName: -1, surname: -1, hours: -1, salary: -1 };
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
        const h = (grid[i] ?? []).map(norm);
        const found = {
            department: findColumn(h, HEADERS.department),
            type: findColumn(h, HEADERS.type),
            employeeId: findColumn(h, HEADERS.employeeId),
            firstName: findColumn(h, HEADERS.firstName),
            surname: findColumn(h, HEADERS.surname),
            hours: findColumn(h, HEADERS.hours),
            salary: findColumn(h, HEADERS.salary),
        };
        if (found.department >= 0 && found.type >= 0 && found.hours >= 0 && found.salary >= 0) {
            headerIndex = i;
            cols = found;
            break;
        }
    }
    if (headerIndex < 0) {
        return { rows: [], errors: [`Couldn't find the columns. This needs the payroll export's own headers — "Department name", "Type", "Total worked hours (excl. breaks)" and "Salary".`], notes: [], unassigned: [] };
    }

    type Line = { rowNo: number; employeeKey: string; name: string; type: string; department: string; hours: number | null; salary: number };
    const lines: Line[] = [];
    for (let i = headerIndex + 1; i < grid.length; i++) {
        const line = grid[i] ?? [];
        const rowNo = i + 1;
        const department = String(line[cols.department] ?? "").trim();
        const type = String(line[cols.type] ?? "").trim();
        const first = cols.firstName >= 0 ? String(line[cols.firstName] ?? "").trim() : "";
        const last = cols.surname >= 0 ? String(line[cols.surname] ?? "").trim() : "";
        const name = [first, last].filter(Boolean).join(" ");
        const empId = cols.employeeId >= 0 ? String(line[cols.employeeId] ?? "").trim() : "";
        const salaryCell = line[cols.salary];
        if (department === "" && type === "" && name === "" && norm(salaryCell) === "") continue; // blank row
        if (/^(grand )?total/.test(norm(department))) continue; // a totals row in the export, not a person

        const salary = parseNumber(salaryCell);
        if (salary === null) {
            errors.push(`Row ${rowNo}${name ? ` (${name})` : ""}: "${String(salaryCell).trim()}" is not a number in the Salary column.`);
            continue;
        }
        const hours = type.toLowerCase() === "shifts" ? parseNumber(line[cols.hours]) : null;
        if (type.toLowerCase() === "shifts" && (hours === null || hours < 0)) {
            errors.push(`Row ${rowNo}${name ? ` (${name})` : ""}: total worked hours must be a number, 0 or more.`);
            continue;
        }
        const employeeKey = empId || name || `row-${rowNo}`;
        lines.push({ rowNo, employeeKey, name: name || `Row ${rowNo}`, type: type || "(no type)", department, hours, salary });
    }
    if (!lines.length && !errors.length) errors.push("The file has a header but no rows under it.");

    // Kiosk hours worked by each employee this week, from their "Shifts" rows only — the weight used to split a
    // pay line (typically a meal deduction) that's shared across more than one kiosk.
    const employeeKioskHours = new Map<string, Map<string, number>>();
    const addHours = (empKey: string, kioskId: string, hrs: number) => {
        let byKiosk = employeeKioskHours.get(empKey);
        if (!byKiosk) employeeKioskHours.set(empKey, (byKiosk = new Map()));
        byKiosk.set(kioskId, (byKiosk.get(kioskId) ?? 0) + hrs);
    };

    // kioskId -> { hours, cost }
    const totals = new Map<string, { hours: number; cost: number }>();
    const addToKiosk = (kioskId: string, hrs: number, cost: number) => {
        const t = totals.get(kioskId) ?? { hours: 0, cost: 0 };
        t.hours += hrs;
        t.cost += cost;
        totals.set(kioskId, t);
    };

    function resolveKiosks(department: string, rowNo: number, name: string): KioskRef[] | null {
        const tokens = department
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        const resolved: KioskRef[] = [];
        for (const token of tokens) {
            const k = matchKiosk(token, kiosks);
            if (!k) {
                errors.push(`Row ${rowNo} (${name}): "${token}" is not one of your kiosks (${kiosks.map((x) => x.name).join(", ")}).`);
                return null;
            }
            resolved.push(k);
        }
        return resolved;
    }

    // Pass 1 — "Shifts" rows are the only source of real hours, and of the per-kiosk weights used below.
    for (const line of lines) {
        if (line.type.toLowerCase() !== "shifts") continue;
        if (line.department === "") {
            unassigned.push({ name: line.name, type: line.type, amount: line.salary });
            continue;
        }
        const kiosks_ = resolveKiosks(line.department, line.rowNo, line.name);
        if (!kiosks_) continue;
        const hrs = line.hours ?? 0;
        if (kiosks_.length === 1) {
            addHours(line.employeeKey, kiosks_[0]!.id, hrs);
            addToKiosk(kiosks_[0]!.id, hrs, line.salary);
        } else {
            // A shift itself spanning kiosks with nothing to weigh it by yet — split evenly and say so.
            notes.push(`${line.name}: a Shifts row lists ${kiosks_.length} kiosks together (${kiosks_.map((k) => k.name).join(", ")}) — split evenly since there's nothing to weigh it by.`);
            for (const k of kiosks_) {
                addHours(line.employeeKey, k.id, hrs / kiosks_.length);
                addToKiosk(k.id, hrs / kiosks_.length, round2(line.salary / kiosks_.length));
            }
        }
    }

    // Pass 2 — every other pay line (meal deductions, weekly salaries, anything else) adds to Labour cost only;
    // it never touches Total Hours, which is real worked hours from Shifts rows alone.
    for (const line of lines) {
        if (line.type.toLowerCase() === "shifts") continue;
        if (line.department === "") {
            unassigned.push({ name: line.name, type: line.type, amount: line.salary });
            continue;
        }
        const kiosks_ = resolveKiosks(line.department, line.rowNo, line.name);
        if (!kiosks_) continue;
        if (kiosks_.length === 1) {
            addToKiosk(kiosks_[0]!.id, 0, line.salary);
            continue;
        }
        const weights = employeeKioskHours.get(line.employeeKey);
        const weighed = kiosks_.map((k) => ({ k, w: weights?.get(k.id) ?? 0 }));
        const totalWeight = weighed.reduce((s, x) => s + x.w, 0);
        if (totalWeight > 0) {
            const pct = weighed.map((x) => `${x.k.name} ${Math.round((x.w / totalWeight) * 100)}%`).join(", ");
            notes.push(`${line.name}: ${line.type} of €${Math.abs(line.salary).toFixed(2)} split between ${kiosks_.map((x) => x.name).join(" and ")} by hours worked that week (${pct}).`);
            for (const { k, w } of weighed) addToKiosk(k.id, 0, round2((line.salary * w) / totalWeight));
        } else {
            notes.push(`${line.name}: ${line.type} of €${Math.abs(line.salary).toFixed(2)} split evenly between ${kiosks_.map((x) => x.name).join(" and ")} — no Shifts hours this week to weigh it by.`);
            for (const k of kiosks_) addToKiosk(k.id, 0, round2(line.salary / kiosks_.length));
        }
    }

    const weekStart = toDateStr(startOfWeekUtc(opts.weekOf));
    const nameById = new Map(kiosks.map((k) => [k.id, k.name]));
    const rows: LabourRow[] = [...totals.entries()]
        .map(([kioskId, t]) => ({ kioskId, kioskName: nameById.get(kioskId) || kioskId, weekStart, hours: round2(t.hours), hourlyRate: null, labourCost: round2(t.cost) }))
        .sort((a, b) => a.kioskName.localeCompare(b.kioskName));

    return { rows, errors, notes, unassigned };
}
