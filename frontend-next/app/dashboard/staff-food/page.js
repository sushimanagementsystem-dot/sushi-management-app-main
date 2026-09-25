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
import PillButton from "@/components/dashboard/PillButton";
import { LayoutGrid, Store } from "lucide-react";
import { LOOKBACK_PRESETS, dateFiltersFromQuery, moneyStr, presetRange, qtyStr, writeDateFiltersToQuery } from "@/lib/kpiUtils";

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
    const initial = dateFiltersFromQuery("last30", LOOKBACK_PRESETS);
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
                        help="staffFoodReport.page"
                        description="Which products staff are taking, per kiosk, with quantity and cost — plus kiosk-wise and date-wise totals. The same cost feeds the Profit tab's net profit."
                        actions={<RefreshButton onRefetch={refetch} />}
                    >
                        <KpiFilters
                            presets={LOOKBACK_PRESETS}
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

const ALL_KIOSKS = "__all__";
const TH = "whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted";
const TD = "whitespace-nowrap border-b border-line px-[0.9rem] py-2.5";

/** A product's cost cell: the priced cost, plus a plain note for units that could not be priced. */
function CostCell({ cost, qty, uncostedQty }) {
    if (uncostedQty >= qty && qty > 0) return <span className="text-[0.75rem] text-muted">not costed</span>;
    return (
        <>
            {moneyStr(cost)}
            {uncostedQty > 0 && <div className="text-[0.68rem] font-normal text-muted">+ {qtyStr(uncostedQty)} not costed</div>}
        </>
    );
}

/**
 * What is actually being taken as staff food: per kiosk (or all kiosks side by side), every product with its quantity
 * and cost over the chosen range. Built from the same rows as the totals, so the columns add up to them.
 */
function ProductBreakdown({ res }) {
    const [kioskId, setKioskId] = useState(ALL_KIOSKS);
    const kiosks = res.kiosks || [];
    const products = res.products || { byKiosk: {}, all: [] };
    const single = kioskId !== ALL_KIOSKS;
    const rows = single ? products.byKiosk[kioskId] || [] : products.all;
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const qtyByKiosk = (productId, kId) => (products.byKiosk[kId] || []).find((r) => r.productId === productId)?.qty || 0;

    return (
        <SectionCard title="Products taken" className="mb-5">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <PillButton active={!single} onClick={() => setKioskId(ALL_KIOSKS)} icon={LayoutGrid}>
                    All kiosks
                </PillButton>
                {kiosks.map((k) => (
                    <PillButton key={k.id} active={kioskId === k.id} onClick={() => setKioskId(k.id)} icon={Store}>
                        {k.name}
                    </PillButton>
                ))}
                <span className="ml-1 text-[0.78rem] text-muted">
                    {res.startDate} to {res.endDate}
                </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse bg-card text-[0.85rem]">
                        <thead>
                            <tr>
                                <th className={TH + " text-left"}>Product</th>
                                {single ? (
                                    <>
                                        <th className={TH + " text-right"}>Units</th>
                                        <th className={TH + " text-right"}>Unit cost</th>
                                        <th className={TH + " text-right"}>Cost</th>
                                        <th className={TH + " text-right"}>Share</th>
                                        <th className={TH + " text-right"}>Last taken</th>
                                    </>
                                ) : (
                                    <>
                                        {kiosks.map((k) => (
                                            <th key={k.id} className={TH + " text-right"}>
                                                {k.name}
                                            </th>
                                        ))}
                                        <th className={TH + " text-right"}>Total units</th>
                                        <th className={TH + " text-right"}>Cost</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.productId} className="transition-colors duration-100 hover:bg-panel/70">
                                    <td className={TD + " font-medium text-ink"}>{r.name}</td>
                                    {single ? (
                                        <>
                                            <td className={TD + " text-right tabular-nums"}>{qtyStr(r.qty)}</td>
                                            <td className={TD + " text-right tabular-nums text-muted"}>{r.unitCost === null ? "not set" : moneyStr(r.unitCost)}</td>
                                            <td className={TD + " text-right tabular-nums"}>
                                                <CostCell cost={r.cost} qty={r.qty} uncostedQty={r.uncostedQty} />
                                            </td>
                                            <td className={TD + " text-right tabular-nums text-muted"}>{totalQty ? Math.round((r.qty / totalQty) * 100) + "%" : ""}</td>
                                            <td className={TD + " text-right text-muted"}>{r.lastTaken}</td>
                                        </>
                                    ) : (
                                        <>
                                            {kiosks.map((k) => {
                                                const q = qtyByKiosk(r.productId, k.id);
                                                return (
                                                    <td key={k.id} className={TD + " text-right tabular-nums " + (q ? "text-ink" : "text-muted")}>
                                                        {q ? qtyStr(q) : "–"}
                                                    </td>
                                                );
                                            })}
                                            <td className={TD + " text-right font-semibold tabular-nums text-ink"}>{qtyStr(r.qty)}</td>
                                            <td className={TD + " text-right tabular-nums"}>
                                                <CostCell cost={r.cost} qty={r.qty} uncostedQty={r.uncostedQty} />
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                            {!rows.length && (
                                <tr>
                                    <td colSpan={single ? 6 : kiosks.length + 3} className="px-[0.9rem] py-6 text-center text-muted">
                                        No staff food logged in this range.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {rows.length > 0 && (
                            <tfoot>
                                <tr>
                                    <td className={TD + " font-semibold text-ink"}>Total</td>
                                    {single ? (
                                        <>
                                            <td className={TD + " text-right font-semibold tabular-nums text-ink"}>{qtyStr(totalQty)}</td>
                                            <td className={TD}></td>
                                            <td className={TD + " text-right font-semibold tabular-nums text-ink"}>{moneyStr(totalCost)}</td>
                                            <td className={TD}></td>
                                            <td className={TD}></td>
                                        </>
                                    ) : (
                                        <>
                                            {kiosks.map((k) => (
                                                <td key={k.id} className={TD + " text-right font-semibold tabular-nums text-ink"}>
                                                    {qtyStr((products.byKiosk[k.id] || []).reduce((s, r) => s + r.qty, 0))}
                                                </td>
                                            ))}
                                            <td className={TD + " text-right font-semibold tabular-nums text-ink"}>{qtyStr(totalQty)}</td>
                                            <td className={TD + " text-right font-semibold tabular-nums text-ink"}>{moneyStr(totalCost)}</td>
                                        </>
                                    )}
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
        </SectionCard>
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

            {res.grandTotal.uncostedQty > 0 && (
                <p className="-mt-1 mb-4 text-[0.78rem] text-muted">
                    {qtyStr(res.grandTotal.uncostedQty)} unit(s) are of products that have no cost set yet, so they are counted in the units but not in the costs. Set the
                    unit cost in Product Prices and they are priced automatically.
                </p>
            )}

            <ProductBreakdown res={res} />

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
