"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X, Upload } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import HelpTip from "@/components/dashboard/HelpTip";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { noticeModal } from "@/components/ConfirmModal";
import { apiCall, readFileAsBase64 } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import { addDaysStr, dateFiltersFromQuery, moneyStr, pad2, presetRange, todayStr, writeDateFiltersToQuery } from "@/lib/kpiUtils";

/**
 * Profit tab — per kiosk, per week, in this column order:
 *   Sales | COGS | Waste | Damage | Staff Food | Fixed Costs | Misc Costs | Gross Profit | Labour | EBITDA Profit
 * Sales, Fixed Costs and Misc Costs are typed in (click a cell); COGS, waste, damage and staff food are pulled
 * from data already captured elsewhere in the app; Labour comes from the weekly labour report submitted in the card
 * at the top. Gross Profit = Sales - all costs to its left; EBITDA = Gross Profit - Labour (arithmetic lives in the
 * backend's profit-calc.ts, so this page only displays it).
 */
export default function ProfitPage() {
    const initial = dateFiltersFromQuery("last30");
    const [filters, setFilters] = useState({ kioskId: initial.kioskId, startDate: initial.startDate, endDate: initial.endDate });
    const [activePreset, setActivePreset] = useState(initial.preset);

    useEffect(() => {
        writeDateFiltersToQuery({ kioskId: filters.kioskId, startDate: filters.startDate, endDate: filters.endDate, preset: activePreset });
    }, [filters, activePreset]);

    const {
        data: res,
        isPending: loading,
        error: bootError,
        refetch,
    } = useBootstrap("bootstrap_profit_page", filters, { enabled: !!filters.startDate });

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    function applyPreset(key) {
        const { start, end } = presetRange(key);
        setActivePreset(key);
        setFilters((f) => ({ ...f, startDate: start, endDate: end }));
    }

    return (
        <>
            <PageTitle title="Dashboard — Profit" />
            <DashboardShell activeKey="profit">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Profit"
                        help="profit.page"
                        description="Gross Profit and EBITDA per kiosk, per week — sales, fixed costs and misc costs are typed in; COGS, waste, damage, staff food and labour come in automatically."
                        actions={<RefreshButton onRefetch={refetch} />}
                    >
                        <KpiFilters
                            kiosks={res?.kiosks || []}
                            filters={filters}
                            activePreset={activePreset}
                            onKioskChange={(v) => setFilters((f) => ({ ...f, kioskId: v }))}
                            onPreset={applyPreset}
                            onStartDate={(v) => {
                                setActivePreset(null);
                                setFilters((f) => ({ ...f, startDate: v }));
                            }}
                            onEndDate={(v) => {
                                setActivePreset(null);
                                setFilters((f) => ({ ...f, endDate: v }));
                            }}
                        />
                    </PageHeader>

                    {loading && (
                        <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                    )}
                    {error && <div className="text-danger-ink">{error}</div>}

                    {!loading && res && !error && (
                        <div className="flex flex-col gap-4">
                            <LabourReportCard kiosks={res.kiosks || []} onSaved={refetch} />
                            {(res.weeks || []).map((week) => (
                                <WeekBlock key={week.weekStart} week={week} onSaved={refetch} />
                            ))}
                            {!(res.weeks || []).length && <p className="text-muted">No weeks in this range.</p>}
                        </div>
                    )}
                </div>
            </DashboardShell>
        </>
    );
}

const COLUMNS = ["Kiosk", "Sales", "COGS", "Waste", "Damage", "Staff Food", "Fixed Costs", "Misc Costs", "Gross Profit", "Labour", "EBITDA Profit"];
// Column headings that need an explanation get the shared "?" Help icon (ids in lib/help/content.js).
const COLUMN_HELP = { COGS: "profit.cogs", "Gross Profit": "profit.grossProfit", Labour: "profit.labour", "EBITDA Profit": "profit.ebitda" };
const CELL = "whitespace-nowrap border-b border-line px-[0.9rem] py-2.5";
const TOTAL_CELL = "whitespace-nowrap border-t border-line px-[0.9rem] py-2.5";

function formatWeekLabel(weekStart, weekEnd) {
    const fmt = (s) => {
        const [, m, d] = s.split("-");
        return `${d}/${m}`;
    };
    return `Week of ${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

function sumRows(rows, key) {
    return rows.reduce((sum, r) => sum + (r[key] || 0), 0);
}

const hoursStr = (h) => (Number.isInteger(h) ? String(h) : h.toFixed(2)) + " h";
const round2 = (n) => Math.round(n * 100) / 100;

function WeekBlock({ week, onSaved }) {
    const rows = week.kiosks || [];
    const showTotal = rows.length > 1;
    const withSales = rows.filter((r) => r.salesAmount !== null);
    const round2 = (n) => Math.round(n * 100) / 100;
    // Same rule as a kiosk row: a total only exists once the sales it depends on do.
    const totalGross = withSales.length ? round2(sumRows(withSales, "salesAmount") - sumRows(withSales, "totalCosts")) : null;
    const withEbitda = rows.filter((r) => r.ebitda !== null);
    const totalEbitda = withEbitda.length ? round2(sumRows(withEbitda, "ebitda")) : null;
    const withLabour = rows.filter((r) => r.labourCost !== null);

    return (
        <SectionCard title={formatWeekLabel(week.weekStart, week.weekEnd)} className="mb-0">
            <div className="overflow-hidden rounded-lg border border-line">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse bg-card text-[0.85rem]">
                        <thead>
                            <tr>
                                {COLUMNS.map((c) => (
                                    <th
                                        key={c}
                                        className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted"
                                    >
                                        {c}
                                        {COLUMN_HELP[c] && <HelpTip id={COLUMN_HELP[c]} />}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <KioskWeekRow key={r.kioskId} row={r} weekStart={week.weekStart} onSaved={onSaved} />
                            ))}
                            {showTotal && (
                                <tr className="bg-panel/60 font-semibold text-ink">
                                    <td className={TOTAL_CELL}>Total</td>
                                    <td className={TOTAL_CELL}>{withSales.length ? moneyStr(sumRows(withSales, "salesAmount")) : "—"}</td>
                                    <td className={TOTAL_CELL}>{moneyStr(sumRows(rows, "cogs"))}</td>
                                    <td className={TOTAL_CELL}>{moneyStr(sumRows(rows, "wasteCost"))}</td>
                                    <td className={TOTAL_CELL}>{moneyStr(sumRows(rows, "damageCost"))}</td>
                                    <td className={TOTAL_CELL}>{moneyStr(sumRows(rows, "staffFoodCost"))}</td>
                                    <td className={TOTAL_CELL}>{moneyStr(sumRows(rows, "fixedCosts"))}</td>
                                    <td className={TOTAL_CELL}>{moneyStr(sumRows(rows, "miscCosts"))}</td>
                                    <ProfitCell value={totalGross} bold />
                                    <td className={TOTAL_CELL}>{withLabour.length ? moneyStr(sumRows(withLabour, "labourCost")) : "—"}</td>
                                    <ProfitCell value={totalEbitda} bold />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </SectionCard>
    );
}

/** Gross Profit / EBITDA figure: green when positive, red when a loss, a dash when it can't be worked out yet. */
function ProfitCell({ value, bold }) {
    if (value === null) {
        return <td className={TOTAL_CELL + " text-muted"}>—</td>;
    }
    const positive = value >= 0;
    return (
        <td className={TOTAL_CELL + " tabular-nums " + (bold ? "font-semibold " : "font-medium ") + (positive ? "text-success-ink" : "text-danger-ink")}>
            {moneyStr(value)}
        </td>
    );
}

function KioskWeekRow({ row, weekStart, onSaved }) {
    return (
        <tr className="transition-colors duration-100 hover:bg-panel/70">
            <td className={CELL + " font-medium text-ink"}>{row.kioskName}</td>
            <SalesCell row={row} weekStart={weekStart} onSaved={onSaved} />
            <td className={CELL}>{moneyStr(row.cogs)}</td>
            <td className={CELL}>{moneyStr(row.wasteCost)}</td>
            <td className={CELL}>{moneyStr(row.damageCost)}</td>
            <td className={CELL}>{moneyStr(row.staffFoodCost)}</td>
            <CostCell row={row} weekStart={weekStart} field="fixedCosts" label="Fixed Costs" onSaved={onSaved} />
            <CostCell row={row} weekStart={weekStart} field="miscCosts" label="Misc Costs" onSaved={onSaved} />
            <ProfitCell value={row.grossProfit} />
            <LabourCell row={row} />
            <ProfitCell value={row.ebitda} />
        </tr>
    );
}

/** What the labour report put in for this kiosk-week — the euro amount deducted for EBITDA, and the hours behind it. */
function LabourCell({ row }) {
    if (row.labourHours === null) {
        return <td className={CELL + " text-muted"}>No report</td>;
    }
    return (
        <td className={CELL + " tabular-nums"}>
            {row.labourCost !== null ? moneyStr(row.labourCost) : <span className="text-muted">rate not set</span>}
            <div className="text-[0.68rem] font-normal text-muted">{hoursStr(row.labourHours)}</div>
        </td>
    );
}

/**
 * A click-to-edit euro amount for one kiosk × week. `onSave(number)` returns the mutation's promise-like result; the
 * cell closes on success and shows the server's message on failure. Empty values read "Enter …" so it is obvious
 * which weeks still need typing in.
 */
function EditableAmountCell({ value, emptyLabel, title, onSave, saving }) {
    const [editing, setEditing] = useState(false);
    const [amount, setAmount] = useState("");
    const [saveError, setSaveError] = useState("");

    function startEdit() {
        setAmount(value !== null && value !== undefined ? String(value) : "");
        setSaveError("");
        setEditing(true);
    }

    async function save() {
        const num = Number(amount);
        if (amount.trim() === "" || Number.isNaN(num) || num < 0) {
            setSaveError("Enter a valid amount.");
            return;
        }
        setSaveError("");
        const out = await onSave(num);
        if (out && out.ok === false) {
            setSaveError(out.error || "Save failed.");
            return;
        }
        setEditing(false);
    }

    if (editing) {
        return (
            <td className="border-b border-line px-[0.9rem] py-2">
                <div className="flex min-w-[11rem] items-center gap-1.5">
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        autoFocus
                        placeholder="0.00"
                        className="w-24 py-1.5 text-[0.85rem]"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") save();
                            if (e.key === "Escape") setEditing(false);
                        }}
                    />
                    <button
                        type="button"
                        disabled={saving}
                        onClick={save}
                        title="Save"
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-none bg-accent p-0 text-accent-ink disabled:opacity-50"
                    >
                        <Check size={14} strokeWidth={2.5} />
                    </button>
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => setEditing(false)}
                        title="Cancel"
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-none bg-line p-0 text-muted disabled:opacity-50"
                    >
                        <X size={14} strokeWidth={2.5} />
                    </button>
                </div>
                {saveError && <div className="mt-1 text-[0.75rem] text-danger-ink">{saveError}</div>}
            </td>
        );
    }

    return (
        <td className={"group " + CELL}>
            <button
                type="button"
                onClick={startEdit}
                title={title}
                className="flex items-center gap-1.5 rounded-lg border-none bg-transparent p-0 text-left text-[0.85rem] text-ink hover:text-accent"
            >
                {value !== null && value !== undefined ? <span className="tabular-nums">{moneyStr(value)}</span> : <span className="text-muted">{emptyLabel}</span>}
                <Pencil size={12} strokeWidth={2} className="flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
        </td>
    );
}

/** Sales for one kiosk × week. Upserts via save_weekly_sales — re-saving a week is just a correction. */
function SalesCell({ row, weekStart, onSaved }) {
    const mutation = useApiMutation("save_weekly_sales");
    return (
        <EditableAmountCell
            value={row.salesAmount}
            emptyLabel="Enter sales"
            title={row.salesAmount !== null ? "Edit this week's sales" : "Enter this week's sales"}
            saving={mutation.isPending}
            onSave={async (num) => {
                const out = await mutation.mutateAsync({ kioskId: row.kioskId, weekOf: weekStart, salesAmount: num, note: row.salesNote || undefined }).catch(() => ({ ok: false, error: "Save failed." }));
                if (out.ok !== false) onSaved();
                return out;
            }}
        />
    );
}

/** Fixed Costs / Misc Costs for one kiosk × week (typed in; saving one leaves the other alone). */
function CostCell({ row, weekStart, field, label, onSaved }) {
    const mutation = useApiMutation("save_weekly_costs");
    const value = row[field];
    return (
        <EditableAmountCell
            value={value}
            emptyLabel="Enter cost"
            title={value !== null ? `Edit this week's ${label.toLowerCase()}` : `Enter this week's ${label.toLowerCase()}`}
            saving={mutation.isPending}
            onSave={async (num) => {
                const out = await mutation.mutateAsync({ kioskId: row.kioskId, weekOf: weekStart, [field]: num }).catch(() => ({ ok: false, error: "Save failed." }));
                if (out.ok !== false) onSaved();
                return out;
            }}
        />
    );
}

// --- Weekly labour report -------------------------------------------------------------------------------------------

function mondayOfStr(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
    return addDaysStr(dateStr, -dow);
}

function lastMonday() {
    return addDaysStr(mondayOfStr(todayStr()), -7);
}

/**
 * The payroll export has no date column of its own (see the "Week starting" field below), but its filename usually
 * carries the pay period, e.g. "Payroll Hours 09-14-2026 to 09-20-2026.xlsx". This is only a safety check against
 * picking the wrong week by mistake — a filename that doesn't match this shape is simply skipped, not an error.
 */
function weekFromFilename(name) {
    const m = name.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s*(?:to|[-–])\s*\d{1,2}[-/]\d{1,2}[-/]\d{4}/i);
    if (!m) return null;
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return mondayOfStr(`${y}-${pad2(mo)}-${pad2(d)}`);
}

const DEFAULT_MANUAL_RATE = "14.15";

/**
 * Submit the weekly labour report: pick the payroll export the kiosk operator already downloads from their punch-in
 * system for payroll (one row per employee per pay line, not a dashboard-specific template), check what the system
 * read out of it, then submit. Each kiosk's hours and cost land in that week's Labour column above.
 *
 * The payroll export only covers staff who are tied to one or more kiosks in the punch-in system — a salaried
 * employee who isn't (e.g. someone who splits their week across kiosks with no fixed pattern) comes through as
 * "unassigned" instead of being guessed at. The Manual Hours section below the preview is how the owner attributes
 * that person's pay to the kiosks they actually covered that week, at a flat rate, so every kiosk's Labour figure —
 * and the EBITDA built on it — stays fair even for staff the payroll file itself can't place.
 *
 * Nothing is saved until "Submit" — the preview is only a read of the file.
 */
function LabourReportCard({ kiosks, onSaved }) {
    const fileInput = useRef(null);
    const [weekOf, setWeekOf] = useState(lastMonday());
    const [file, setFile] = useState(null); // { name, base64 }
    const [preview, setPreview] = useState(null); // { rows, errors, notes, unassigned }
    const [manualHours, setManualHours] = useState({}); // kioskId -> string
    const [manualRate, setManualRate] = useState(DEFAULT_MANUAL_RATE);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState("");

    // Re-read the file whenever the week changes — the payroll export has no date column of its own, so every row
    // in it is read as whichever week is picked here, and the preview must always match what Submit would save.
    useEffect(() => {
        if (!file) return;
        let cancelled = false;
        setBusy(true);
        apiCall("preview_labour_report", { fileBase64: file.base64, fileName: file.name, weekOf })
            .catch(() => ({ ok: false, error: "Could not reach the server — try again." }))
            .then((out) => {
                if (cancelled) return;
                setBusy(false);
                setPreview(out.ok === false ? { rows: [], errors: [out.error || "Could not read the file."], notes: [], unassigned: [] } : { rows: out.rows || [], errors: out.errors || [], notes: out.notes || [], unassigned: out.unassigned || [] });
            });
        return () => {
            cancelled = true;
        };
    }, [file, weekOf]);

    async function onFile(e) {
        const chosen = e.target.files?.[0];
        e.target.value = "";
        if (!chosen) return;
        setDone("");
        setPreview(null);
        setFile({ name: chosen.name, base64: await readFileAsBase64(chosen) });
    }

    const rate = Number(manualRate);
    const validRate = manualRate.trim() !== "" && Number.isFinite(rate) && rate >= 0;
    const payrollByKiosk = new Map((preview?.rows || []).map((r) => [r.kioskId, r]));
    const manualRows = kiosks
        .map((k) => {
            const hrsStr = manualHours[k.id] ?? "";
            const hrs = Number(hrsStr);
            const validHrs = hrsStr.trim() !== "" && Number.isFinite(hrs) && hrs >= 0;
            return { kioskId: k.id, kioskName: k.name, hours: validHrs ? hrs : 0, hasEntry: validHrs && hrs > 0 };
        })
        .filter((m) => m.hasEntry || payrollByKiosk.has(m.kioskId));

    function combinedRows() {
        return manualRows.map((m) => {
            const payroll = payrollByKiosk.get(m.kioskId);
            const payrollHours = payroll?.hours ?? 0;
            const payrollCost = payroll?.labourCost ?? 0;
            const manualCost = m.hasEntry && validRate ? round2(m.hours * rate) : 0;
            return { kioskId: m.kioskId, kioskName: m.kioskName, payrollHours, payrollCost, manualHours: m.hours, manualCost, totalHours: round2(payrollHours + m.hours), totalCost: round2(payrollCost + manualCost) };
        });
    }

    async function submit() {
        const rows = combinedRows()
            .filter((r) => payrollByKiosk.has(r.kioskId) || r.manualHours > 0)
            .map((r) => ({ kioskId: r.kioskId, weekStart: weekOf, hours: r.totalHours, labourCost: r.totalCost }));
        if (!rows.length) return;
        setBusy(true);
        const out = await apiCall("save_weekly_labour", { rows, fileName: file?.name }).catch(() => ({ ok: false, error: "Could not reach the server — try again." }));
        setBusy(false);
        if (out.ok === false) return noticeModal(out.error || "Could not save the labour report.", "Not submitted");
        setDone(`Submitted: ${out.saved} kiosk-week${out.saved === 1 ? "" : "s"} added to the Labour column.`);
        setFile(null);
        setPreview(null);
        setManualHours({});
        onSaved();
    }

    const hasErrors = !!preview && preview.errors.length > 0;
    const rows = preview ? combinedRows() : [];
    const hasManualEntries = rows.some((r) => r.manualHours > 0);
    // Every active kiosk, whether or not this week's payroll export or a manual entry covers it — the Manual Hours
    // table below always shows the full set so the owner can add hours for a kiosk the file happens to have nothing for.
    const manualTableRows = kiosks.map((k) => {
        const payroll = payrollByKiosk.get(k.id);
        const payrollHours = payroll?.hours ?? 0;
        const payrollCost = payroll?.labourCost ?? 0;
        const manualHrs = Number(manualHours[k.id]) || 0;
        const manualCost = manualHours[k.id]?.trim() && validRate ? round2(manualHrs * rate) : 0;
        return { kioskId: k.id, kioskName: k.name, payroll, payrollHours, payrollCost, manualHrs, manualCost, totalHours: round2(payrollHours + manualHrs), totalCost: round2(payrollCost + manualCost) };
    });
    const canSubmit = !hasErrors && !busy && (!hasManualEntries || validRate) && rows.some((r) => payrollByKiosk.has(r.kioskId) || r.manualHours > 0);
    const inputCls = "py-1.5 text-[0.85rem]";
    const filenameWeek = file ? weekFromFilename(file.name) : null;
    const weekMismatch = filenameWeek && filenameWeek !== mondayOfStr(weekOf);

    return (
        <SectionCard
            title="Weekly labour report"
            help="profit.labourReport"
            description={`Upload the payroll export (Excel or CSV) from your punch-in system — the same file used for payroll. Each kiosk's hours and pay go into the Labour column for the week starting below.`}
            className="mb-0"
        >
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="mb-[0.15rem] block text-[0.8rem] font-semibold">Week starting</label>
                    <input type="date" className={inputCls} value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
                    <div className="mt-0.5 text-[0.7rem] text-muted">The payroll export has no date column, so every row in it is read as this week.</div>
                </div>
                <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
                <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink"
                >
                    <Upload size={15} strokeWidth={2.25} />
                    {file ? "Choose a different file" : "Choose payroll export"}
                </button>
            </div>

            {done && <div className="mt-3 text-[0.85rem] font-semibold text-success-ink">{done}</div>}
            {file && <div className="mt-3 text-[0.8rem] text-muted">File: {file.name}</div>}
            {weekMismatch && (
                <div className="mt-2 rounded-card border border-line bg-danger-bg/40 px-3 py-2 text-[0.82rem] font-semibold text-danger-ink">
                    This file's name suggests the week of {filenameWeek}, but "Week starting" above is set to {mondayOfStr(weekOf)}. Double-check the date before submitting.
                </div>
            )}
            {busy && !preview && <div className="mt-2 text-[0.8rem] text-muted">Reading the file…</div>}

            {hasErrors && (
                <div className="mt-3 rounded-card border border-line bg-danger-bg/40 px-3 py-2.5 text-[0.82rem] text-danger-ink">
                    <div className="mb-1 font-semibold">Fix these in the export, then choose the file again:</div>
                    <ul className="m-0 list-disc pl-5">
                        {preview.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                        ))}
                    </ul>
                </div>
            )}

            {preview && !hasErrors && preview.notes.length > 0 && (
                <div className="mt-3 rounded-card border border-line bg-panel px-3 py-2.5 text-[0.78rem] text-muted">
                    <div className="mb-1 font-semibold text-ink">How shared pay lines were split</div>
                    <ul className="m-0 list-disc pl-5">
                        {preview.notes.map((n, i) => (
                            <li key={i}>{n}</li>
                        ))}
                    </ul>
                </div>
            )}

            {preview && !hasErrors && preview.unassigned.length > 0 && (
                <div className="mt-3 rounded-card border border-line bg-warn-bg/40 px-3 py-2.5 text-[0.82rem] text-warn-ink">
                    <div className="mb-1 font-semibold">Not linked to a kiosk in this file — add their hours below to include them:</div>
                    <ul className="m-0 list-disc pl-5">
                        {preview.unassigned.map((u, i) => (
                            <li key={i}>
                                {u.name} — {u.type} — {moneyStr(u.amount)} (this amount is their full payslip figure and is not added to any kiosk; enter their kiosk hours below instead)
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {(preview || kiosks.length > 0) && !hasErrors && (
                <div className="mt-4">
                    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                        <div className="text-[0.78rem] font-semibold uppercase tracking-[0.05em] text-muted">Manual hours — staff not on the payroll export (e.g. a salaried employee across kiosks)</div>
                        <div className="flex items-center gap-1.5">
                            <label className="text-[0.8rem] text-muted">Rate (€/h)</label>
                            <input type="number" step="0.01" min="0" className={inputCls + " w-20"} value={manualRate} onChange={(e) => setManualRate(e.target.value)} />
                        </div>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-line">
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse bg-card text-[0.85rem]">
                                <thead>
                                    <tr>
                                        {["Kiosk", "Payroll hours", "Payroll cost", "Manual hours", "Manual cost", "Total hours", "Total cost"].map((c) => (
                                            <th key={c} className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                                {c}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {manualTableRows.map((r) => (
                                        <tr key={r.kioskId}>
                                            <td className={CELL + " font-medium text-ink"}>{r.kioskName}</td>
                                            <td className={CELL + " tabular-nums text-muted"}>{r.payroll ? hoursStr(r.payrollHours) : "—"}</td>
                                            <td className={CELL + " tabular-nums text-muted"}>{r.payroll ? moneyStr(r.payrollCost) : "—"}</td>
                                            <td className={CELL}>
                                                <input
                                                    type="number"
                                                    step="0.25"
                                                    min="0"
                                                    placeholder="0"
                                                    className="w-20 rounded-md border border-line bg-canvas px-1.5 py-1 text-[0.85rem] tabular-nums"
                                                    value={manualHours[r.kioskId] ?? ""}
                                                    onChange={(e) => setManualHours((m) => ({ ...m, [r.kioskId]: e.target.value }))}
                                                />
                                            </td>
                                            <td className={CELL + " tabular-nums text-muted"}>{r.manualCost ? moneyStr(r.manualCost) : "—"}</td>
                                            <td className={CELL + " tabular-nums font-medium"}>{hoursStr(r.totalHours)}</td>
                                            <td className={CELL + " tabular-nums font-medium"}>{moneyStr(r.totalCost)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td className={TOTAL_CELL + " font-semibold text-ink"}>Total</td>
                                        <td className={TOTAL_CELL + " tabular-nums font-semibold"}>{hoursStr(sumRows(manualTableRows, "payrollHours"))}</td>
                                        <td className={TOTAL_CELL + " tabular-nums font-semibold"}>{moneyStr(sumRows(manualTableRows, "payrollCost"))}</td>
                                        <td className={TOTAL_CELL + " tabular-nums font-semibold"}>{hoursStr(sumRows(manualTableRows, "manualHrs"))}</td>
                                        <td className={TOTAL_CELL + " tabular-nums font-semibold"}>{moneyStr(sumRows(manualTableRows, "manualCost"))}</td>
                                        <td className={TOTAL_CELL + " tabular-nums font-semibold"}>{hoursStr(sumRows(manualTableRows, "totalHours"))}</td>
                                        <td className={TOTAL_CELL + " tabular-nums font-semibold"}>{moneyStr(sumRows(manualTableRows, "totalCost"))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                    {hasManualEntries && !validRate && <div className="mt-2 text-[0.78rem] text-danger-ink">Manual hours need a rate of 0 or more.</div>}
                </div>
            )}

            {(preview || rows.some((r) => r.manualHours > 0)) && !hasErrors && (
                <div className="mt-3 flex items-center gap-3">
                    <button type="button" disabled={!canSubmit} onClick={submit} className="rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink disabled:opacity-50">
                        {busy ? "Working…" : "Submit to Profit"}
                    </button>
                </div>
            )}
        </SectionCard>
    );
}
