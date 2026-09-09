"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Store, CalendarDays, TrendingDown, TrendingUp } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { useBootstrap } from "@/lib/queries";
import { dateFiltersFromQuery, presetRange, qtyStr, writeDateFiltersToQuery } from "@/lib/kpiUtils";

/**
 * Stock Variances / Missing Products Detection — surfaces the exact
 * "staff wasted it but never logged it" gap this was built for: for
 * every completed stocktake, compares what the stock ledger expects
 * (opening balance plus every logged delivery/transfer/waste/damage/
 * staff-food movement, up to that stocktake's own date) against what
 * staff actually counted. Not a new calculation — StocktakeReviewService
 * already computes this same delta to post a correcting movement when a
 * stocktake is confirmed; this is that same number, finally shown as the
 * report it was always meant to be, filtered to the same variance
 * thresholds already configurable on the Settings page.
 */
export default function StockVariancesPage() {
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
    } = useBootstrap("bootstrap_stock_variances", filters, { enabled: !!filters.startDate });

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    function applyPreset(key) {
        const { start, end } = presetRange(key);
        setActivePreset(key);
        setFilters({ startDate: start, endDate: end });
    }

    return (
        <>
            <PageTitle title="Dashboard — Stock Variances" />
            <DashboardShell activeKey="stock-variances">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Stock Variances"
                        description="Automatically detected gaps between what the stock ledger expects and what staff actually counted — usually a sign something was never logged."
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

                    {!loading && res && !error && <VarianceReport res={res} />}
                </div>
            </DashboardShell>
        </>
    );
}

function VarianceReport({ res }) {
    const variances = res.variances || [];
    const thresholds = res.thresholds;

    return (
        <>
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
                <div
                    className={
                        "flex items-center gap-2 rounded-full px-[0.65rem] py-[0.2rem] text-[0.78rem] font-semibold " +
                        (variances.length > 0 ? "bg-danger-bg text-danger-ink" : "bg-success-bg text-success-ink")
                    }
                >
                    {variances.length > 0 ? <AlertTriangle size={13} strokeWidth={2.25} /> : <CheckCircle2 size={13} strokeWidth={2.25} />}
                    {variances.length} variance{variances.length === 1 ? "" : "s"} found
                </div>
                {thresholds && (
                    <span className="text-[0.78rem] text-muted">
                        Flagged when the gap is at least {thresholds.minUnits} unit(s) and over {thresholds.pct}% of the expected quantity.
                    </span>
                )}
            </div>

            <SectionCard title="Detected variances" className="mb-0">
                {!variances.length ? (
                    <p className="py-6 text-center text-[0.9rem] text-muted">
                        No variances in this range — every completed stocktake matched what the ledger expected.
                    </p>
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {variances.map((v, i) => (
                            <VarianceCard key={i} v={v} />
                        ))}
                    </div>
                )}
            </SectionCard>
        </>
    );
}

function VarianceCard({ v }) {
    const missing = v.difference < 0; // actual < expected — stock is unaccounted-for-missing
    const Icon = missing ? TrendingDown : TrendingUp;
    return (
        <div
            className={
                "rounded-card border-l-[3px] bg-card p-[0.9rem_1.1rem] shadow-elevate-1 " + (missing ? "border-l-danger-ink" : "border-l-warn-ink")
            }
        >
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <span
                    className={
                        "inline-flex items-center gap-1.5 rounded-full px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold uppercase tracking-[0.03em] " +
                        (missing ? "bg-danger-bg text-danger-ink" : "bg-warn-bg text-warn-ink")
                    }
                >
                    <Icon size={12} strokeWidth={2.5} />
                    {missing ? "Missing" : "Surplus"}
                </span>
            </div>

            <div className="mb-1.5 text-[0.95rem] font-semibold leading-snug text-ink">
                {v.kioskName} – {v.stockItemName}: Expected {qtyStr(v.expected)}, Actual {qtyStr(v.actual)}, Difference{" "}
                {v.difference > 0 ? "+" : ""}
                {qtyStr(v.difference)} {v.unit}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[0.78rem] text-muted">
                <span className="flex items-center gap-1">
                    <Store size={12} strokeWidth={2} className="flex-shrink-0" />
                    {v.kioskName}
                </span>
                <span className="flex items-center gap-1">
                    <CalendarDays size={12} strokeWidth={2} className="flex-shrink-0" />
                    {v.date}
                </span>
            </div>
        </div>
    );
}
