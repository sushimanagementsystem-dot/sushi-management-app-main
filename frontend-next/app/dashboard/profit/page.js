"use client";

import { useEffect, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import { dateFiltersFromQuery, moneyStr, presetRange, writeDateFiltersToQuery } from "@/lib/kpiUtils";

/**
 * Profit tab — net profit per kiosk, per week. Sales are entered
 * manually (the old spec's §22 "Weekly Sales Import" was never built —
 * see nest-backend's ProfitService doc comment); every cost figure
 * (COGS, waste, damage, staff food) is pulled automatically from data
 * already captured elsewhere in the app, same as the KPI Dashboard.
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
                        description="Net profit per kiosk, per week — sales entered manually; COGS, waste, damage and staff food costs are pulled in automatically."
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

function WeekBlock({ week, onSaved }) {
    const rows = week.kiosks || [];
    const showTotal = rows.length > 1;
    const anySalesEntered = rows.some((r) => r.salesAmount !== null);
    const totalNetProfit = anySalesEntered ? sumRows(rows.filter((r) => r.salesAmount !== null), "salesAmount") - sumRows(rows, "totalCosts") : null;

    return (
        <SectionCard title={formatWeekLabel(week.weekStart, week.weekEnd)} className="mb-0">
            <div className="overflow-hidden rounded-lg border border-line">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse bg-card text-[0.85rem]">
                        <thead>
                            <tr>
                                {["Kiosk", "Sales", "COGS", "Waste", "Damage", "Staff Food", "Net Profit"].map((c) => (
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
                                    <td className="whitespace-nowrap border-t border-line px-[0.9rem] py-2.5">Total</td>
                                    <td className="whitespace-nowrap border-t border-line px-[0.9rem] py-2.5">
                                        {anySalesEntered ? moneyStr(sumRows(rows.filter((r) => r.salesAmount !== null), "salesAmount")) : "—"}
                                    </td>
                                    <td className="whitespace-nowrap border-t border-line px-[0.9rem] py-2.5">{moneyStr(sumRows(rows, "cogs"))}</td>
                                    <td className="whitespace-nowrap border-t border-line px-[0.9rem] py-2.5">{moneyStr(sumRows(rows, "wasteCost"))}</td>
                                    <td className="whitespace-nowrap border-t border-line px-[0.9rem] py-2.5">{moneyStr(sumRows(rows, "damageCost"))}</td>
                                    <td className="whitespace-nowrap border-t border-line px-[0.9rem] py-2.5">{moneyStr(sumRows(rows, "staffFoodCost"))}</td>
                                    <NetProfitCell value={totalNetProfit} bold />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </SectionCard>
    );
}

function NetProfitCell({ value, bold }) {
    if (value === null) {
        return <td className="whitespace-nowrap border-t border-line px-[0.9rem] py-2.5 text-muted">—</td>;
    }
    const positive = value >= 0;
    return (
        <td
            className={
                "whitespace-nowrap border-t border-line px-[0.9rem] py-2.5 tabular-nums " +
                (bold ? "font-semibold " : "font-medium ") +
                (positive ? "text-success-ink" : "text-danger-ink")
            }
        >
            {moneyStr(value)}
        </td>
    );
}

function KioskWeekRow({ row, weekStart, onSaved }) {
    return (
        <tr className="transition-colors duration-100 hover:bg-panel/70">
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 font-medium text-ink">{row.kioskName}</td>
            <WeeklySalesCell row={row} weekStart={weekStart} onSaved={onSaved} />
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{moneyStr(row.cogs)}</td>
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{moneyStr(row.wasteCost)}</td>
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{moneyStr(row.damageCost)}</td>
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{moneyStr(row.staffFoodCost)}</td>
            <NetProfitCell value={row.netProfit} />
        </tr>
    );
}

/** Click-to-edit sales amount for one kiosk × week. Upserts via
 * save_weekly_sales — re-saving an already-entered week is just a
 * correction (backend upserts on kiosk_id + week_start), which is exactly
 * what "manually enter previous weeks' sales" needs: today's week and any
 * past week use the same single action. */
function WeeklySalesCell({ row, weekStart, onSaved }) {
    const [editing, setEditing] = useState(false);
    const [amount, setAmount] = useState("");
    const [note, setNote] = useState("");
    const [saveError, setSaveError] = useState("");

    const saveMutation = useApiMutation("save_weekly_sales", {
        onSuccess: (out) => {
            if (!out.ok) {
                setSaveError(out.error || "Save failed.");
                return;
            }
            setEditing(false);
            onSaved();
        },
        onError: () => setSaveError("Save failed."),
    });

    function startEdit() {
        setAmount(row.salesAmount !== null ? String(row.salesAmount) : "");
        setNote(row.salesNote || "");
        setSaveError("");
        setEditing(true);
    }

    function save() {
        const num = Number(amount);
        if (amount.trim() === "" || Number.isNaN(num) || num < 0) {
            setSaveError("Enter a valid amount.");
            return;
        }
        setSaveError("");
        saveMutation.mutate({ kioskId: row.kioskId, weekOf: weekStart, salesAmount: num, note: note.trim() || undefined });
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
                        onKeyDown={(e) => e.key === "Enter" && save()}
                    />
                    <button
                        type="button"
                        disabled={saveMutation.isPending}
                        onClick={save}
                        title="Save"
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-none bg-accent text-accent-ink disabled:opacity-50"
                    >
                        <Check size={14} strokeWidth={2.5} />
                    </button>
                    <button
                        type="button"
                        disabled={saveMutation.isPending}
                        onClick={() => setEditing(false)}
                        title="Cancel"
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-none bg-line text-muted disabled:opacity-50"
                    >
                        <X size={14} strokeWidth={2.5} />
                    </button>
                </div>
                {saveError && <div className="mt-1 text-[0.75rem] text-danger-ink">{saveError}</div>}
            </td>
        );
    }

    return (
        <td className="group whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">
            <button
                type="button"
                onClick={startEdit}
                title={row.salesAmount !== null ? "Edit this week's sales" : "Enter this week's sales"}
                className="flex items-center gap-1.5 rounded-lg border-none bg-transparent p-0 text-left text-[0.85rem] text-ink hover:text-accent"
            >
                {row.salesAmount !== null ? (
                    <span className="tabular-nums">{moneyStr(row.salesAmount)}</span>
                ) : (
                    <span className="text-muted">Enter sales</span>
                )}
                <Pencil size={12} strokeWidth={2} className="flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
        </td>
    );
}
