import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { BulkDataset, ChangeSet, ColumnDef, Preview, PreviewRow, Target } from "./bulk-import.types.js";

const normHeader = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";

/** Number from an Excel cell or pasted text: 3,20 / €4.50 / 1,250.5 all read as numbers; anything else is not. */
export function parseNumber(v: unknown): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v ?? "").replace(/[€£\s]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function parseBoolean(v: unknown): boolean | null {
    if (typeof v === "boolean") return v;
    const s = String(v ?? "").trim().toLowerCase();
    if (["yes", "y", "true", "1", "active", "on"].includes(s)) return true;
    if (["no", "n", "false", "0", "inactive", "off"].includes(s)) return false;
    return null;
}

/** Parses one cell for a value column; blank means "leave as it is" and is handled by the caller. */
function parseValue(col: ColumnDef, raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
    const fmt = col.format ?? "text";
    if (fmt === "text") return { ok: true, value: String(raw).trim() };
    if (fmt === "boolean") {
        const b = parseBoolean(raw);
        return b === null ? { ok: false, message: `"${col.header}": "${String(raw).trim()}" is not Yes or No.` } : { ok: true, value: b };
    }
    const n = parseNumber(raw);
    if (n === null) return { ok: false, message: `"${col.header}": "${String(raw).trim()}" is not a number.` };
    if (fmt === "integer" && !Number.isInteger(n)) return { ok: false, message: `"${col.header}": ${n} must be a whole number.` };
    if (col.min !== undefined && n < col.min) return { ok: false, message: `"${col.header}": ${n} is below the minimum of ${col.min}.` };
    return { ok: true, value: fmt === "money" ? Math.round(n * 10000) / 10000 : fmt === "number" ? Math.round(n * 1000) / 1000 : n };
}

const same = (a: unknown, b: unknown): boolean => {
    if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
    if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 0.00005;
    return String(a).trim() === String(b).trim();
};

// ---------------------------------------------------------------- reading a file

export type FileRow = { rowNo: number; raw: Record<string, unknown> };

/** Reads the first sheet, finds the header row (within the first 15 rows) by the dataset's columns, and returns the data rows. */
export function readSheet(dataset: Pick<BulkDataset, "columns" | "detect">, buffer: Buffer): { rows: FileRow[]; fileErrors: string[]; foundValueColumns: string[] } {
    let sheet: XLSX.WorkSheet | undefined;
    try {
        const wb = XLSX.read(buffer, { type: "buffer" });
        sheet = wb.Sheets[wb.SheetNames[0]!];
    } catch {
        return { rows: [], fileErrors: ["That file could not be read. Upload the Excel (.xlsx) template you downloaded, or a CSV."], foundValueColumns: [] };
    }
    if (!sheet) return { rows: [], fileErrors: ["The file has no sheet with data in it."], foundValueColumns: [] };
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
    // Excel row number of grid[0]: a sheet whose first rows are empty starts its range further down.
    const firstRow = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r : 0;

    const matchers = dataset.columns.map((c) => ({ col: c, names: [c.header, ...(c.aliases ?? [])].map(normHeader) }));
    let headerIndex = -1;
    let colIndex: Record<string, number> = {};
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
        const cells = (grid[i] ?? []).map(normHeader);
        const found: Record<string, number> = {};
        for (const m of matchers) {
            const at = cells.findIndex((c) => c !== "" && m.names.includes(c));
            if (at >= 0) found[m.col.key] = at;
        }
        if (dataset.detect.every((k) => found[k] !== undefined)) {
            headerIndex = i;
            colIndex = found;
            break;
        }
    }
    if (headerIndex < 0) {
        const need = dataset.detect.map((k) => `"${dataset.columns.find((c) => c.key === k)!.header}"`).join(", ");
        return { rows: [], fileErrors: [`Couldn't find the columns. The header row needs ${need}. Use the template from Download Template.`], foundValueColumns: [] };
    }
    const foundValueColumns = dataset.columns.filter((c) => c.kind === "value" && colIndex[c.key] !== undefined).map((c) => c.key);
    if (!foundValueColumns.length) {
        return { rows: [], fileErrors: [`The file has none of the columns that can be updated (${dataset.columns.filter((c) => c.kind === "value").map((c) => c.header).join(", ")}).`], foundValueColumns };
    }

    const rows: FileRow[] = [];
    for (let i = headerIndex + 1; i < grid.length; i++) {
        const line = grid[i] ?? [];
        if (line.every(isBlank)) continue;
        const raw: Record<string, unknown> = {};
        for (const [key, at] of Object.entries(colIndex)) raw[key] = line[at] ?? "";
        rows.push({ rowNo: firstRow + i + 1, raw });
    }
    if (!rows.length) return { rows, fileErrors: ["The file has a header but no data rows under it."], foundValueColumns };
    return { rows, fileErrors: [], foundValueColumns };
}

// ---------------------------------------------------------------- the template

const displayOf = (v: unknown) => (v === null || v === undefined ? "" : v);

export function buildTemplate<Ctx>(dataset: BulkDataset<Ctx>, ctx: Ctx): Buffer {
    const header = dataset.columns.map((c) => c.header);
    const targets = dataset.targets(ctx);
    const rows = targets.map((t) => dataset.columns.map((c) => (c.kind === "value" ? displayOf(t.current[c.key]) : (t.label[c.key] ?? ""))));
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = dataset.columns.map((c) => ({ wch: c.width ?? Math.max(10, c.header.length + 2) }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 } as never;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, dataset.sheetName);
    const help = XLSX.utils.aoa_to_sheet([
        [dataset.label],
        [],
        ...dataset.instructions.map((l) => [l]),
        [],
        ["Columns you can change: " + dataset.columns.filter((c) => c.kind === "value").map((c) => c.header).join(", ")],
        ["Nothing is saved when you upload: you will see a preview of every change first and press Apply Changes to save."],
    ]);
    help["!cols"] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, help, "How to use");
    for (const extra of dataset.referenceSheets?.(ctx) ?? []) {
        const s = XLSX.utils.aoa_to_sheet(extra.rows);
        s["!cols"] = (extra.rows[0] ?? []).map(() => ({ wch: 32 }));
        XLSX.utils.book_append_sheet(wb, s, extra.name);
    }
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ---------------------------------------------------------------- validate + preview

export function runBulk<Ctx>(dataset: BulkDataset<Ctx>, ctx: Ctx, buffer: Buffer): { preview: Preview; changes: ChangeSet[] } {
    const labelColumns = dataset.columns.filter((c) => c.kind !== "value").map((c) => ({ key: c.key, header: c.header }));
    const valueColumns = dataset.columns.filter((c) => c.kind === "value").map((c) => ({ key: c.key, header: c.header }));
    const empty = (fileErrors: string[]): { preview: Preview; changes: ChangeSet[] } => ({
        preview: { dataset: dataset.id, label: dataset.label, labelColumns, valueColumns, rows: [], summary: { fileRows: 0, changed: 0, new: 0, unchanged: 0, invalid: 0, unmatched: 0, duplicate: 0, notInFile: 0 }, fileErrors, canApply: false, token: "" },
        changes: [],
    });

    const { rows: fileRows, fileErrors, foundValueColumns } = readSheet(dataset, buffer);
    if (fileErrors.length) return empty(fileErrors);

    const targets = new Map<string, Target>(dataset.targets(ctx).map((t) => [t.ref, t]));
    const valueCols = dataset.columns.filter((c) => c.kind === "value" && foundValueColumns.includes(c.key));
    const seen = new Map<string, number>();
    const touched = new Set<string>();
    const out: PreviewRow[] = [];
    const changes: ChangeSet[] = [];

    for (const { rowNo, raw } of fileRows) {
        const row = (status: PreviewRow["status"], message: string | undefined, label: Record<string, string>, ch: PreviewRow["changes"] = []): void => void out.push({ rowNo, status, message, label, changes: ch });
        const shown = Object.fromEntries(dataset.columns.filter((c) => c.kind !== "value").map((c) => [c.key, String(raw[c.key] ?? "").trim()]));

        const missing = dataset.columns.find((c) => c.required && isBlank(raw[c.key]));
        if (missing) {
            row("invalid", `Missing value: "${missing.header}" is empty.`, shown);
            continue;
        }
        const res = dataset.resolve(raw, ctx);
        if ("error" in res) {
            row(res.unmatched ? "unmatched" : "invalid", res.error, shown);
            continue;
        }
        const target = res.create ?? targets.get(res.ref);
        if (!target) {
            row("unmatched", "This row does not match anything in the system.", shown);
            continue;
        }
        const label = { ...shown, ...target.label };
        if (seen.has(target.ref)) {
            row("duplicate", `Listed twice: the same record is already on row ${seen.get(target.ref)}. Keep one of them.`, label);
            continue;
        }
        seen.set(target.ref, rowNo);
        touched.add(target.ref);

        const values: Record<string, unknown> = {};
        const shownChanges: PreviewRow["changes"] = [];
        let bad: string | null = null;
        let provided = 0;
        for (const col of valueCols) {
            if (isBlank(raw[col.key])) continue; // blank = leave as it is
            provided++;
            const parsed = parseValue(col, raw[col.key]);
            if (!parsed.ok) {
                bad = parsed.message;
                break;
            }
            if (!same(parsed.value, target.current[col.key])) {
                values[col.key] = parsed.value;
                shownChanges.push({ key: col.key, header: col.header, from: target.current[col.key] ?? null, to: parsed.value });
            }
        }
        if (bad) {
            row("invalid", bad, label);
            continue;
        }
        const merged = { ...target.current, ...values };
        if (shownChanges.length) {
            const problem = dataset.check?.(merged, target) ?? null;
            if (problem) {
                row("invalid", problem, label, shownChanges);
                continue;
            }
        }
        if (!shownChanges.length) {
            row("unchanged", provided === 0 ? "No values filled in for this row." : undefined, label);
            continue;
        }
        const status = target.exists ? "changed" : "new";
        row(status, undefined, label, shownChanges);
        changes.push({ ref: target.ref, exists: target.exists, values, merged, label });
    }

    const count = (s: PreviewRow["status"]) => out.filter((r) => r.status === s).length;
    const summary = {
        fileRows: out.length,
        changed: count("changed"),
        new: count("new"),
        unchanged: count("unchanged"),
        invalid: count("invalid"),
        unmatched: count("unmatched"),
        duplicate: count("duplicate"),
        notInFile: [...targets.keys()].filter((r) => !touched.has(r)).length,
    };
    const problems = summary.invalid + summary.unmatched + summary.duplicate;
    const token = createHash("sha256").update(JSON.stringify(changes.map((c) => [c.ref, c.exists, c.values]))).digest("hex");
    return {
        preview: { dataset: dataset.id, label: dataset.label, labelColumns, valueColumns, rows: out, summary, fileErrors: [], canApply: problems === 0 && changes.length > 0, token },
        changes,
    };
}
