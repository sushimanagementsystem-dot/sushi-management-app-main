"use client";

import { useEffect, useState } from "react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { KpiBadge, KpiFlag, KpiTile, KpiTileGrid, Sparkline } from "@/components/dashboard/KpiTile";
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
        wasteQty = 0;
    kioskIds.forEach((k) => {
        const r = res.damageWasteRates[k];
        if (!r) return;
        plannedTotal += r.plannedQty;
        damageQty += r.damage.qty;
        wasteQty += r.waste.qty;
    });
    return {
        plannedQty: plannedTotal,
        damageRatePer100: plannedTotal > 0 ? Math.round((damageQty / plannedTotal) * 10000) / 100 : null,
        wasteRatePct: plannedTotal > 0 ? Math.round((wasteQty / plannedTotal) * 10000) / 100 : null,
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
                        description="Waste, damage, stocktake, deliveries and owner actions across your kiosks."
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
                            <SectionCard title="Waste, Damage & Staff Food">
                                <CoreTiles res={res} kioskIds={kioskIds} />
                            </SectionCard>

                            <SectionCard title="Stocktake Status">
                                <StocktakeTiles res={res} kioskIds={kioskIds} />
                            </SectionCard>

                            <SectionCard title="Delivery / Invoice Review Queue">
                                <DeliveryTiles res={res} kioskIds={kioskIds} />
                            </SectionCard>

                            <SectionCard title="Owner Actions" className="mb-0">
                                <ActionTiles res={res} />
                            </SectionCard>
                        </>
                    )}
                </div>
            </DashboardShell>
        </>
    );
}

function CoreTiles({ res, kioskIds }) {
    const waste = sumStat(pluckMovement(res.movementStats, kioskIds, "EXPIRED_WASTE"), kioskIds);
    const damage = sumStat(pluckMovement(res.movementStats, kioskIds, "DAMAGE"), kioskIds);
    const staffFoodTotals = {};
    kioskIds.forEach((k) => (staffFoodTotals[k] = (res.staffFood[k] || {}).total || emptyStatTotals()));
    const staffFood = sumStat(staffFoodTotals, kioskIds);
    const rates = combinedDamageWasteRates(res, kioskIds);

    return (
        <KpiTileGrid>
            <KpiTile
                label="Expired / Waste (Finished Product)"
                value={moneyStr(waste.cost)}
                subLines={[
                    qtyStr(waste.qty) + " units logged",
                    rates.wasteRatePct === null
                        ? "Rate not available (no planned production for this period)"
                        : rates.wasteRatePct + "% of planned production",
                    waste.uncostedCount > 0 ? waste.uncostedCount + " item(s) uncosted" : "",
                ]}
            />
            <KpiTile
                label="Damage"
                value={moneyStr(damage.cost)}
                subLines={[
                    qtyStr(damage.qty) + " units logged",
                    rates.damageRatePer100 === null
                        ? "Rate not available (no planned production for this period)"
                        : rates.damageRatePer100 + " per 100 planned units",
                    damage.uncostedCount > 0 ? damage.uncostedCount + " item(s) uncosted" : "",
                ]}
            />
            <KpiTile
                label="Staff Food"
                value={moneyStr(staffFood.cost)}
                subLines={[qtyStr(staffFood.qty) + " units logged", staffFood.uncostedCount > 0 ? staffFood.uncostedCount + " item(s) uncosted" : ""]}
            >
                <Sparkline byDate={mergeByDate(res.staffFood, kioskIds)} startDate={res.startDate} endDate={res.endDate} />
            </KpiTile>
        </KpiTileGrid>
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
            <KpiTile label="AI Extraction" value={totals.aiPending + " pending"} subLines={[totals.aiFailed + " failed — needs manual entry"]} />
            <KpiTile
                label="Unmapped Invoice Lines"
                value={String(totals.unmappedLines)}
                subLines={[totals.unmappedLines > 0 ? "Needs a stock item picked before confirming" : "All lines mapped"]}
            />
            <KpiTile label="Approved Invoice Value" value={moneyStr(totals.approvedValue)} subLines={["For the selected period"]} />
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
