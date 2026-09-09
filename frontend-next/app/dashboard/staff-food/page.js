"use client";

import { useEffect, useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { useBootstrap } from "@/lib/queries";
import { dateFiltersFromQuery, moneyStr, presetRange, qtyStr, writeDateFiltersToQuery } from "@/lib/kpiUtils";

/**
 * Staff Food — kiosk-wise and date-wise breakdown of comped staff meals,
 * plus weekly and overall totals. No staff-member field anywhere (the
 * kiosk form itself never asks who's eating — see FormBits/staff-food
 * page — and this view was explicitly asked for kiosk × date, not
 * kiosk × staff member). Reads the exact same product_movement rows the
 * Profit tab already subtracts as a cost — this is a different view of
 * that same number, not a second figure to keep in sync by hand.
 */
export default function StaffFoodPage() {
    const initial = dateFiltersFromQuery("last30");
    const [filters, setFilters] = useState({ startDate: initial.startDate, endDate: initial.endDate });
    const [activePreset, setActivePreset] = useState(initial.preset);

    useEffect(() => {
        writeDateFiltersToQuery({ startDate: filters.startDate, endDate: filters.endDate, preset: activePreset });
    }, [filters, activePreset]);

    const {
        data: res,
        isPending: loading,
        error: bootError,
        refetch,
    } = useBootstrap("bootstrap_staff_food_report", filters, { enabled: !!filters.startDate });

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    function applyPreset(key) {
        const { start, end } = presetRange(key);
        setActivePreset(key);
        setFilters({ startDate: start, endDate: end });
    }

    return (
        <>
            <PageTitle title="Dashboard — Staff Food" />
            <DashboardShell activeKey="staff-food">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Staff Food"
                        description="Kiosk-wise and date-wise staff meal costs — this same figure feeds the Profit tab's net profit calculation."
                        actions={<RefreshButton onRefetch={refetch} />}
                    >
                        <KpiFilters
                            filters={filters}
                            activePreset={activePreset}
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

                    {!loading && res && !error && <StaffFoodReport res={res} />}
                </div>
            </DashboardShell>
        </>
    );
}

function OverallTotals({ res }) {
    return (
        <div className="mb-4 flex flex-wrap gap-2.5">
            <div className="flex items-center gap-3 rounded-card border border-line bg-card px-4 py-2.5 shadow-elevate-1">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal">
                    <UtensilsCrossed size={16} strokeWidth={2.25} />
                </span>
                <div>
                    <div className="text-[1.1rem] font-semibold leading-tight tabular-nums text-ink">{moneyStr(res.grandTotal.cost)}</div>
                    <div className="text-[0.72rem] text-muted">Total cost — {res.startDate} to {res.endDate}</div>
                </div>
            </div>
            <div className="flex items-center gap-3 rounded-card border border-line bg-card px-4 py-2.5 shadow-elevate-1">
                <div>
                    <div className="text-[1.1rem] font-semibold leading-tight tabular-nums text-ink">{qtyStr(res.grandTotal.qty)}</div>
                    <div className="text-[0.72rem] text-muted">Total units logged</div>
                </div>
            </div>
            {res.kioskTotals.map((k) => (
                <div key={k.kioskId} className="flex items-center gap-3 rounded-card border border-line bg-card px-4 py-2.5 shadow-elevate-1">
                    <div>
                        <div className="text-[0.95rem] font-semibold leading-tight tabular-nums text-ink">{moneyStr(k.cost)}</div>
                        <div className="text-[0.72rem] text-muted">{k.kioskName}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function KioskCostTable({ title, rows, kiosks, showTotalColumn, labelFor }) {
    return (
        <SectionCard title={title} className="mb-5">
            <div className="overflow-hidden rounded-lg border border-line">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse bg-card text-[0.85rem]">
                        <thead>
                            <tr>
                                <th className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                    {rows.dateColumnLabel}
                                </th>
                                {kiosks.map((k) => (
                                    <th
                                        key={k.id}
                                        className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted"
                                    >
                                        {k.name}
                                    </th>
                                ))}
                                {showTotalColumn && (
                                    <th className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-right text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                        Total
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.items.map((row) => {
                                const rowTotal = row.kiosks.reduce((sum, r) => sum + r.cost, 0);
                                return (
                                    <tr key={row.key} className="transition-colors duration-100 hover:bg-panel/70">
                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 font-medium text-ink">{labelFor(row)}</td>
                                        {row.kiosks.map((k) => (
                                            <td
                                                key={k.kioskId}
                                                className={
                                                    "whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 text-right tabular-nums " +
                                                    (k.cost > 0 ? "text-ink" : "text-muted")
                                                }
                                            >
                                                {moneyStr(k.cost)}
                                            </td>
                                        ))}
                                        {showTotalColumn && (
                                            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 text-right font-semibold tabular-nums text-ink">
                                                {moneyStr(rowTotal)}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                            {!rows.items.length && (
                                <tr>
                                    <td colSpan={kiosks.length + (showTotalColumn ? 2 : 1)} className="px-[0.9rem] py-6 text-center text-muted">
                                        No staff food logged in this range.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </SectionCard>
    );
}

function StaffFoodReport({ res }) {
    const kiosks = res.kiosks || [];

    if (!kiosks.length) return <p className="text-muted">No active kiosks.</p>;

    return (
        <>
            <OverallTotals res={res} />

            <KioskCostTable
                title="Weekly totals"
                rows={{
                    dateColumnLabel: "Week",
                    items: (res.weeks || []).map((w) => ({ key: w.weekStart, weekStart: w.weekStart, weekEnd: w.weekEnd, kiosks: w.kiosks })),
                }}
                kiosks={kiosks}
                showTotalColumn
                labelFor={(row) => formatWeekLabel(row.weekStart, row.weekEnd)}
            />

            <KioskCostTable
                title="Daily breakdown"
                rows={{
                    dateColumnLabel: "Date",
                    items: (res.days || []).map((d) => ({ key: d.date, date: d.date, kiosks: d.kiosks })),
                }}
                kiosks={kiosks}
                showTotalColumn
                labelFor={(row) => formatDayLabel(row.date)}
            />
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

function todayLocalStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function formatDayLabel(dateStr) {
    const todayStr = todayLocalStr();
    const yesterdayD = new Date();
    yesterdayD.setDate(yesterdayD.getDate() - 1);
    const yesterdayStr = yesterdayD.getFullYear() + "-" + String(yesterdayD.getMonth() + 1).padStart(2, "0") + "-" + String(yesterdayD.getDate()).padStart(2, "0");
    if (dateStr === todayStr) return "Today";
    if (dateStr === yesterdayStr) return "Yesterday";
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
