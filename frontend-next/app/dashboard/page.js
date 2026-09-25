"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LayoutDashboard, Store, Trash2, Triangle, Utensils, Wallet } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { KpiBadge, KpiFlag, KpiTile, KpiTileGrid, Sparkline, TrendBadge } from "@/components/dashboard/KpiTile";
import { useBootstrap } from "@/lib/queries";
import {
    dateFiltersFromQuery,
    emptyStatTotals,
    moneyStr,
    pluckMovement,
    presetRange,
    qtyStr,
    sumStat,
    writeDateFiltersToQuery,
} from "@/lib/kpiUtils";

// Combined rate across the selected kiosks = sum(numerator) /
// sum(planned_qty) — never an average of per-kiosk rates, which would
// misweight low-volume kiosks (spec §23.3's controlled-period reasoning
// applied to aggregation, not just filtering).
function combinedDamageWasteRates(res, kioskIds) {
    let plannedTotal = 0,
        damageQty = 0,
        wasteUnits = 0,
        wasteBase = 0;
    kioskIds.forEach((k) => {
        const r = res.damageWasteRates[k];
        if (!r) return;
        plannedTotal += r.plannedQty;
        damageQty += r.damage.qty;
        // Waste rate: units matched to their batch out of the units planned for
        // those batches — the backend's own numerator/denominator, not waste.qty
        // over plannedQty (see waste-cohort.ts).
        wasteUnits += r.waste.rateUnits;
        wasteBase += r.waste.rateBase;
    });
    return {
        plannedQty: plannedTotal,
        damageRatePer100: plannedTotal > 0 ? Math.round((damageQty / plannedTotal) * 10000) / 100 : null,
        wasteRatePct: wasteBase > 0 ? Math.round((wasteUnits / wasteBase) * 10000) / 100 : null,
    };
}

function mergeByDate(staffFoodByKiosk, kioskIds) {
    const merged = {};
    kioskIds.forEach((k) => {
        const byDate = (staffFoodByKiosk[k] || {}).byDate || {};
        Object.keys(byDate).forEach((d) => (merged[d] = (merged[d] || 0) + byDate[d]));
    });
    return merged;
}

/** Same idea as mergeByDate above, but for movementByDate's shape
 * (per kiosk -> per movement_type -> per date), which has no wrapping
 * `.byDate` key of its own since it sits alongside movementStats rather
 * than replacing it. */
function mergeMovementByDate(movementByDate, kioskIds, type) {
    const merged = {};
    kioskIds.forEach((k) => {
        const byDate = ((movementByDate || {})[k] || {})[type] || {};
        Object.keys(byDate).forEach((d) => (merged[d] = (merged[d] || 0) + byDate[d]));
    });
    return merged;
}

/** "View X →" link used in every section header's top-right corner. */
function SectionLink({ href, children }) {
    return (
        <Link
            href={href}
            className="flex items-center gap-1 text-[0.78rem] font-semibold text-accent no-underline hover:underline"
        >
            {children}
            <ArrowRight size={13} strokeWidth={2.4} />
        </Link>
    );
}

export default function DashboardOverviewPage() {
    const initial = dateFiltersFromQuery("last7");
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
    } = useBootstrap("bootstrap_kpi_dashboard", filters, { enabled: !!filters.startDate });

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    function applyPreset(key) {
        const { start, end } = presetRange(key);
        setActivePreset(key);
        setFilters((f) => ({ ...f, startDate: start, endDate: end }));
    }

    const kioskIds = res?.ok ? (filters.kioskId ? [filters.kioskId] : res.kiosks.map((k) => k.id)) : [];

    return (
        <>
            <PageTitle title="Dashboard — Overview" />
            <DashboardShell activeKey="overview">
                {/* This one div is the page's whole scroll region — PageHeader
                    (sticky) is its first child, not a sibling outside it, so
                    the header pins to the top of THIS scroll instead of just
                    sitting statically above a separately-scrolling content
                    box. Nothing below has its own independent scrollbar. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="KPI Dashboard"
                        help="overview.page"
                        description="Waste, damage, stocktake, deliveries and owner actions across your kiosks."
                        icon={LayoutDashboard}
                        actions={<RefreshButton onRefetch={refetch} />}
                    >
                        <KpiFilters
                            kiosks={res?.ok ? res.kiosks : []}
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

                    {!loading && res?.ok && (
                        <>
                            <SectionCard
                                title="Waste, Damage & Staff Food"
                                actions={<SectionLink href="/dashboard/reports">View detailed report</SectionLink>}
                            >
                                <CoreTiles res={res} kioskIds={kioskIds} />
                            </SectionCard>

                            <SectionCard
                                title="Stocktake Status"
                                help="kpi.stocktakeStatus"
                                actions={<SectionLink href="/dashboard/kiosk-comparison">View all kiosks</SectionLink>}
                            >
                                <StocktakeTiles res={res} kioskIds={kioskIds} />
                            </SectionCard>

                            <SectionCard
                                title="Delivery / Invoice Review Queue"
                                help="kpi.deliveries"
                                actions={<SectionLink href="/dashboard/inbox">View all</SectionLink>}
                            >
                                <DeliveryTiles res={res} kioskIds={kioskIds} />
                            </SectionCard>

                            <SectionCard
                                title="Owner Actions"
                                help="kpi.ownerActions"
                                className="mb-0"
                                actions={<SectionLink href="/dashboard/inbox">View all actions</SectionLink>}
                            >
                                <ActionTiles res={res} />
                            </SectionCard>
                        </>
                    )}
                </div>
            </DashboardShell>
        </>
    );
}

function ValueWithTrend({ children, current, previous }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-0.5">
            {children}
            <TrendBadge current={current} previous={previous} />
        </span>
    );
}

function CoreTiles({ res, kioskIds }) {
    const waste = sumStat(pluckMovement(res.movementStats, kioskIds, "EXPIRED_WASTE"), kioskIds);
    const damage = sumStat(pluckMovement(res.movementStats, kioskIds, "DAMAGE"), kioskIds);
    const staffFoodTotals = {};
    kioskIds.forEach((k) => (staffFoodTotals[k] = (res.staffFood[k] || {}).total || emptyStatTotals()));
    const staffFood = sumStat(staffFoodTotals, kioskIds);
    const rates = combinedDamageWasteRates(res, kioskIds);

    // Same-shape totals from the equivalent previous period (see
    // kpi.service.ts's previousRange) — only feeds each tile's TrendBadge,
    // never shown as its own number.
    const previousWaste = sumStat(pluckMovement(res.previousMovementStats || {}, kioskIds, "EXPIRED_WASTE"), kioskIds);
    const previousDamage = sumStat(pluckMovement(res.previousMovementStats || {}, kioskIds, "DAMAGE"), kioskIds);
    const previousStaffFoodTotals = {};
    kioskIds.forEach((k) => (previousStaffFoodTotals[k] = ((res.previousMovementStats || {})[k] || {}).STAFF_FOOD || emptyStatTotals()));
    const previousStaffFood = sumStat(previousStaffFoodTotals, kioskIds);

    return (
        <KpiTileGrid>
            <KpiTile
                icon={Trash2}
                iconClassName="bg-chip-rose-bg text-chip-rose-ink"
                label="Expired / Waste (Finished Product)"
                help="kpi.waste"
                value={
                    <ValueWithTrend current={waste.cost} previous={previousWaste.cost}>
                        {moneyStr(waste.cost)}
                    </ValueWithTrend>
                }
                subLines={[
                    qtyStr(waste.qty) + " units logged",
                    rates.wasteRatePct === null
                        ? "Rate not available (no planned production for this period)"
                        : rates.wasteRatePct + "% of planned production",
                    waste.uncostedCount > 0 ? waste.uncostedCount + " item(s) uncosted" : "",
                ]}
            >
                <Sparkline byDate={mergeMovementByDate(res.movementByDate, kioskIds, "EXPIRED_WASTE")} startDate={res.startDate} endDate={res.endDate} />
            </KpiTile>
            <KpiTile
                icon={Triangle}
                iconClassName="bg-chip-orange-bg text-chip-orange-ink"
                label="Damage"
                help="kpi.damage"
                value={
                    <ValueWithTrend current={damage.cost} previous={previousDamage.cost}>
                        {moneyStr(damage.cost)}
                    </ValueWithTrend>
                }
                subLines={[
                    qtyStr(damage.qty) + " units logged",
                    rates.damageRatePer100 === null
                        ? "Rate not available (no planned production for this period)"
                        : rates.damageRatePer100 + " per 100 planned units",
                    damage.uncostedCount > 0 ? damage.uncostedCount + " item(s) uncosted" : "",
                ]}
            >
                <Sparkline byDate={mergeMovementByDate(res.movementByDate, kioskIds, "DAMAGE")} startDate={res.startDate} endDate={res.endDate} />
            </KpiTile>
            <KpiTile
                icon={Utensils}
                iconClassName="bg-chip-amber-bg text-chip-amber-ink"
                label="Staff Food"
                help="kpi.staffFood"
                value={
                    <ValueWithTrend current={staffFood.cost} previous={previousStaffFood.cost}>
                        {moneyStr(staffFood.cost)}
                    </ValueWithTrend>
                }
                subLines={[qtyStr(staffFood.qty) + " units logged", staffFood.uncostedCount > 0 ? staffFood.uncostedCount + " item(s) uncosted" : ""]}
            >
                <Sparkline byDate={mergeByDate(res.staffFood, kioskIds)} startDate={res.startDate} endDate={res.endDate} />
            </KpiTile>
            <KpiTile
                icon={Wallet}
                iconClassName="bg-chip-indigo-bg text-chip-indigo-ink"
                label="Total Cost (Waste + Damage + Staff Food)"
                help="kpi.totalCost"
                value={
                    <ValueWithTrend
                        current={waste.cost + damage.cost + staffFood.cost}
                        previous={previousWaste.cost + previousDamage.cost + previousStaffFood.cost}
                    >
                        {moneyStr(waste.cost + damage.cost + staffFood.cost)}
                    </ValueWithTrend>
                }
                subLines={[
                    qtyStr(waste.qty + damage.qty + staffFood.qty) + " units logged",
                    waste.uncostedCount + damage.uncostedCount + staffFood.uncostedCount > 0
                        ? waste.uncostedCount + damage.uncostedCount + staffFood.uncostedCount + " item(s) uncosted"
                        : "",
                ]}
            >
                <CostBreakdownBar waste={waste.cost} damage={damage.cost} staffFood={staffFood.cost} />
            </KpiTile>
        </KpiTileGrid>
    );
}

/** What the Total Cost tile shows instead of a sparkline — a sparkline of
 * a sum just re-traces whichever of the three lines happens to be
 * biggest (in practice, usually identical to the Waste tile's own line,
 * which read as "this card is just a copy of the first one" when Damage/
 * Staff Food are €0 for the period, as they often are). A composition bar
 * says something a trend-over-time chart can't: not just the total, but
 * which of the three is actually driving it — still true even when only
 * one category has any cost this period. */
function CostBreakdownBar({ waste, damage, staffFood }) {
    const total = waste + damage + staffFood;
    if (total <= 0) return null;
    const segments = [
        { key: "waste", label: "Waste", value: waste, barClass: "bg-chip-rose-ink", dotClass: "bg-chip-rose-ink" },
        { key: "damage", label: "Damage", value: damage, barClass: "bg-chip-orange-ink", dotClass: "bg-chip-orange-ink" },
        { key: "staffFood", label: "Staff Food", value: staffFood, barClass: "bg-chip-amber-ink", dotClass: "bg-chip-amber-ink" },
    ].filter((s) => s.value > 0);

    return (
        <div className="mt-2.5">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-panel">
                {segments.map((s) => (
                    <div key={s.key} className={s.barClass} style={{ width: (s.value / total) * 100 + "%" }} title={s.label + ": " + moneyStr(s.value)} />
                ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {segments.map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1 text-[0.72rem] text-muted">
                        <span className={"h-1.5 w-1.5 flex-shrink-0 rounded-full " + s.dotClass} />
                        {s.label} {moneyStr(s.value)}
                    </span>
                ))}
            </div>
        </div>
    );
}

function StocktakeTiles({ res, kioskIds }) {
    const nameById = {};
    res.kiosks.forEach((k) => (nameById[k.id] = k.name));

    return (
        <KpiTileGrid>
            {kioskIds.map((kioskId) => {
                const s = res.stocktakeStatus[kioskId];
                if (!s) return null;
                return (
                    <KpiTile
                        key={kioskId}
                        icon={Store}
                        iconClassName="bg-chip-sky-bg text-chip-sky-ink"
                        label={nameById[kioskId] || kioskId}
                        value={<KpiBadge status={s.status} />}
                        subLines={[
                            s.lastCompleteDate
                                ? "Last complete: " + s.lastCompleteDate + " (" + s.ageDays + " day" + (s.ageDays === 1 ? "" : "s") + " ago)"
                                : "No complete stocktake on record",
                        ]}
                    >
                        {s.hasRecentIncomplete && <KpiFlag>Incomplete stocktake since</KpiFlag>}
                    </KpiTile>
                );
            })}
        </KpiTileGrid>
    );
}

function DeliveryTiles({ res, kioskIds }) {
    const totals = { submitted: 0, inReview: 0, reviewed: 0, aiPending: 0, aiFailed: 0, unmappedLines: 0, approvedValue: 0 };
    kioskIds.forEach((k) => {
        const d = res.deliveryInvoice[k];
        if (!d) return;
        Object.keys(totals).forEach((key) => (totals[key] += d[key] || 0));
    });

    return (
        <KpiTileGrid>
            <KpiTile
                label="Deliveries Submitted"
                value={String(totals.submitted)}
                subLines={[totals.inReview + " in review", totals.reviewed + " reviewed"]}
            />
            <KpiTile label="AI Extraction" help="kpi.aiExtraction" value={totals.aiPending + " pending"} subLines={[totals.aiFailed + " failed — needs manual entry"]} />
            <KpiTile
                label="Unmapped Invoice Lines"
                help="kpi.unmappedLines"
                value={String(totals.unmappedLines)}
                subLines={[totals.unmappedLines > 0 ? "Needs a stock item picked before confirming" : "All lines mapped"]}
            />
            <KpiTile label="Approved Invoice Value" help="kpi.approvedValue" value={moneyStr(totals.approvedValue)} subLines={["For the selected period"]} />
        </KpiTileGrid>
    );
}

function ActionTiles({ res }) {
    const counts = res.ownerActionCounts || { byStatus: {}, byCategory: {} };
    const openStatuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_OWNER"];
    const openTotal = openStatuses.reduce((sum, s) => sum + (counts.byStatus[s] || 0), 0);

    return (
        <KpiTileGrid>
            <KpiTile
                label="Open Owner Actions"
                value={String(openTotal)}
                subLines={[
                    "OPEN: " + (counts.byStatus.OPEN || 0),
                    "IN PROGRESS: " + (counts.byStatus.IN_PROGRESS || 0),
                    "WAITING FOR OWNER: " + (counts.byStatus.WAITING_FOR_OWNER || 0),
                ]}
            />
            <KpiTile
                label="All Owner Actions by Category (all-time)"
                value=""
                subLines={Object.keys(counts.byCategory || {})
                    .sort()
                    .map((cat) => cat.replace(/_/g, " ") + ": " + counts.byCategory[cat])}
            />
        </KpiTileGrid>
    );
}
