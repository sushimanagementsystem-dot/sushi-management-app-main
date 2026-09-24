"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X, Upload, Download } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { noticeModal } from "@/components/ConfirmModal";
import { apiCall, readFileAsBase64, saveBase64File } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import { addDaysStr, dateFiltersFromQuery, moneyStr, presetRange, todayStr, writeDateFiltersToQuery } from "@/lib/kpiUtils";

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
                            <LabourReportCard lastHourlyRate={res.lastHourlyRate} onSaved={refetch} />
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

function lastMonday() {
    const today = todayStr();
    const [y, m, d] = today.split("-").map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
    return addDaysStr(today, -dow - 7);
}

/**
 * Submit the weekly labour report: pick the Excel / CSV file (a Google Sheet downloads as either), check what the
 * system read out of it, then submit. Each kiosk's hours (and cost) land in that week's Labour column above. Nothing
 * is saved until "Submit" — the preview is only a read of the file.
 */
function LabourReportCard({ lastHourlyRate, onSaved }) {
    const fileInput = useRef(null);
    const [weekOf, setWeekOf] = useState(lastMonday());
    const [rate, setRate] = useState(lastHourlyRate !== null && lastHourlyRate !== undefined ? String(lastHourlyRate) : "");
    const [file, setFile] = useState(null); // { name, base64 }
    const [preview, setPreview] = useState(null); // { rows, errors }
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState("");

    // Re-read the file whenever the week or rate changes, so the preview is always what Submit would save.
    useEffect(() => {
        if (!file) return;
        let cancelled = false;
        setBusy(true);
        apiCall("preview_labour_report", { fileBase64: file.base64, fileName: file.name, weekOf, hourlyRate: rate.trim() === "" ? undefined : Number(rate) })
            .catch(() => ({ ok: false, error: "Could not reach the server — try again." }))
            .then((out) => {
                if (cancelled) return;
                setBusy(false);
                setPreview(out.ok === false ? { rows: [], errors: [out.error || "Could not read the file."] } : { rows: out.rows || [], errors: out.errors || [] });
            });
        return () => {
            cancelled = true;
        };
    }, [file, weekOf, rate]);

    async function onFile(e) {
        const chosen = e.target.files?.[0];
        e.target.value = "";
        if (!chosen) return;
        setDone("");
        setPreview(null);
        setFile({ name: chosen.name, base64: await readFileAsBase64(chosen) });
    }

    async function downloadTemplate() {
        const out = await apiCall("labour_report_template", { weekOf }).catch(() => null);
        if (!out || out.ok === false) return noticeModal((out && out.error) || "Could not build the template.", "Template not available");
        saveBase64File(out.fileBase64, out.fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    async function submit() {
        setBusy(true);
        const out = await apiCall("save_weekly_labour", { rows: preview.rows, fileName: file.name }).catch(() => ({ ok: false, error: "Could not reach the server — try again." }));
        setBusy(false);
        if (out.ok === false) return noticeModal(out.error || "Could not save the labour report.", "Not submitted");
        setDone(`Submitted: ${out.saved} kiosk-week${out.saved === 1 ? "" : "s"} added to the Labour column.`);
        setFile(null);
        setPreview(null);
        onSaved();
    }

    const hasErrors = !!preview && preview.errors.length > 0;
    const canSubmit = !!preview && preview.rows.length > 0 && !hasErrors && !busy;
    const inputCls = "py-1.5 text-[0.85rem]";

    return (
        <SectionCard
            title="Weekly labour report"
            description="Upload the weekly labour sheet (Excel or CSV — a Google Sheet can be downloaded as either) with total hours per kiosk. Each kiosk's hours go into the Labour column for that week."
            className="mb-0"
        >
            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="mb-[0.15rem] block text-[0.8rem] font-semibold">Week starting</label>
                    <input type="date" className={inputCls} value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
                    <div className="mt-0.5 text-[0.7rem] text-muted">Used when the sheet has no "Week starting" column.</div>
                </div>
                <div>
                    <label className="mb-[0.15rem] block text-[0.8rem] font-semibold">Hourly rate (€)</label>
                    <input type="number" step="0.01" min="0" placeholder="e.g. 12.50" className={inputCls + " w-28"} value={rate} onChange={(e) => setRate(e.target.value)} />
                    <div className="mt-0.5 text-[0.7rem] text-muted">Turns hours into euros. Not needed if the sheet has a cost column.</div>
                </div>
                <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
                <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink"
                >
                    <Upload size={15} strokeWidth={2.25} />
                    {file ? "Choose a different file" : "Choose file"}
                </button>
                <button
                    type="button"
                    onClick={downloadTemplate}
                    className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink"
                >
                    <Download size={15} strokeWidth={2.25} />
                    Download template
                </button>
            </div>

            {done && <div className="mt-3 text-[0.85rem] font-semibold text-success-ink">{done}</div>}
            {file && <div className="mt-3 text-[0.8rem] text-muted">File: {file.name}</div>}
            {busy && !preview && <div className="mt-2 text-[0.8rem] text-muted">Reading the file…</div>}

            {preview && (
                <div className="mt-3">
                    {hasErrors && (
                        <div className="mb-3 rounded-card border border-line bg-danger-bg/40 px-3 py-2.5 text-[0.82rem] text-danger-ink">
                            <div className="mb-1 font-semibold">Fix these in the sheet, then choose the file again:</div>
                            <ul className="m-0 list-disc pl-5">
                                {preview.errors.map((e, i) => (
                                    <li key={i}>{e}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {preview.rows.length > 0 && (
                        <div className="overflow-hidden rounded-lg border border-line">
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse bg-card text-[0.85rem]">
                                    <thead>
                                        <tr>
                                            {["Week starting", "Kiosk", "Total hours", "Rate", "Labour cost"].map((c) => (
                                                <th key={c} className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                                    {c}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.rows.map((r) => (
                                            <tr key={r.kioskId + r.weekStart}>
                                                <td className={CELL}>{r.weekStart}</td>
                                                <td className={CELL + " font-medium text-ink"}>{r.kioskName}</td>
                                                <td className={CELL + " tabular-nums"}>{hoursStr(r.hours)}</td>
                                                <td className={CELL + " tabular-nums text-muted"}>{r.hourlyRate !== null ? moneyStr(r.hourlyRate) + "/h" : "from sheet"}</td>
                                                <td className={CELL + " tabular-nums"}>{r.labourCost !== null ? moneyStr(r.labourCost) : <span className="text-muted">no rate — hours only</span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {preview.rows.some((r) => r.labourCost === null) && (
                        <div className="mt-2 text-[0.78rem] text-muted">Rows with no rate or cost are saved as hours only; EBITDA stays blank for them until a rate or cost is added.</div>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                        <button
                            type="button"
                            disabled={!canSubmit}
                            onClick={submit}
                            className="rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink disabled:opacity-50"
                        >
                            {busy ? "Working…" : `Submit ${preview.rows.length} row${preview.rows.length === 1 ? "" : "s"} to Profit`}
                        </button>
                        {hasErrors && <span className="text-[0.78rem] text-muted">Submit is off until the sheet reads without errors.</span>}
                    </div>
                </div>
            )}
        </SectionCard>
    );
}
