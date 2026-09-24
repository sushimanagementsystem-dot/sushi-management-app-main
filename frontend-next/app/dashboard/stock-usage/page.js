"use client";

import { useState } from "react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import { useBootstrap } from "@/lib/queries";
import { qtyStr } from "@/lib/kpiUtils";
import RefreshButton from "@/components/dashboard/RefreshButton";
import DashSelect from "@/components/dashboard/DashSelect";

export default function StockUsagePage() {
    const [selection, setSelection] = useState({ kioskId: "", openingId: "", closingId: "" });

    const {
        data: res,
        isPending: loading,
        error: bootError,
        refetch,
    } = useBootstrap(
        "bootstrap_stock_usage",
        {
            kioskId: selection.kioskId,
            openingStocktakeHeaderId: selection.openingId,
            closingStocktakeHeaderId: selection.closingId,
        },
        { enabled: true },
    );

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const kiosks = res?.ok ? res.kiosks || [] : [];
    const hasStocktakePickers = res?.ok && res.completeStocktakes && res.completeStocktakes.length >= 2;

    function findStocktakeIdByDate(date) {
        const match = (res?.completeStocktakes || []).find((s) => s.date === date);
        return match ? match.id : "";
    }

    return (
        <>
            <PageTitle title="Dashboard — Stock Usage View" />
            <DashboardShell activeKey="stock-usage">
                {/* One scroll region for the whole page — PageHeader is sticky
                    inside it, not a static sibling above a separately
                    scrolling content box. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <PageHeader
                    title="Stock Usage View"
                    description="Compare two stocktakes for one kiosk to see actual ingredient usage between them."
                    actions={<RefreshButton onRefetch={refetch} />}
                >
                <div className="flex flex-wrap items-center gap-1.5">
                    <DashSelect
                        value={selection.kioskId}
                        onChange={(e) => setSelection({ kioskId: e.target.value, openingId: "", closingId: "" })}
                    >
                        <option value="">Choose a kiosk…</option>
                        {kiosks.map((k) => (
                            <option key={k.id} value={k.id}>
                                {k.name}
                            </option>
                        ))}
                    </DashSelect>
                    {hasStocktakePickers && (
                        <>
                            <span className="text-[0.72rem] text-muted">Opening:</span>
                            <DashSelect
                                value={selection.openingId || (res.openingDate ? findStocktakeIdByDate(res.openingDate) : "")}
                                onChange={(e) => setSelection((s) => ({ ...s, openingId: e.target.value }))}
                            >
                                {res.completeStocktakes.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.date}
                                    </option>
                                ))}
                            </DashSelect>
                            <span className="text-[0.72rem] text-muted">Closing:</span>
                            <DashSelect
                                value={selection.closingId || (res.closingDate ? findStocktakeIdByDate(res.closingDate) : "")}
                                onChange={(e) => setSelection((s) => ({ ...s, closingId: e.target.value }))}
                            >
                                {res.completeStocktakes.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.date}
                                    </option>
                                ))}
                            </DashSelect>
                        </>
                    )}
                </div>
                </PageHeader>

                {loading && (
                    <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                )}
                {error && <div className="text-danger-ink">{error}</div>}

                {!loading && res?.ok && (
                    <>
                        {!res.available ? (
                            <div className="max-w-[32rem] text-muted">
                                {res.kioskId ? res.reason || "Not available." : "Choose a kiosk to see its stock usage."}
                            </div>
                        ) : (
                            <SectionCard
                                title="Stock movement"
                                description={`Comparing stocktake on ${res.openingDate} to stocktake on ${res.closingDate}.`}
                                className="mb-0"
                            >
                                <div className="overflow-hidden rounded-lg border border-line">
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse bg-card text-[0.85rem]">
                                            <thead>
                                                <tr>
                                                    {["Stock Item", "Opening", "Deliveries In", "Transfers In", "Transfers Out", "Closing", "Actual Usage"].map(
                                                        (c) => (
                                                            <th
                                                                key={c}
                                                                className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted"
                                                            >
                                                                {c}
                                                            </th>
                                                        ),
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(res.lines || []).map((line) => (
                                                    <tr key={line.stockItemId} className="transition-colors duration-100 hover:bg-panel/70">
                                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 font-medium text-ink">
                                                            {line.name} <span className="font-normal text-muted">({line.unit})</span>
                                                        </td>
                                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{qtyStr(line.opening)}</td>
                                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{qtyStr(line.deliveriesIn)}</td>
                                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{qtyStr(line.transfersIn)}</td>
                                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{qtyStr(line.transfersOut)}</td>
                                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">{qtyStr(line.closing)}</td>
                                                        <td className="whitespace-nowrap border-b border-line bg-accent/[0.06] px-[0.9rem] py-2.5 font-semibold text-ink">
                                                            {qtyStr(line.actualUsage)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </SectionCard>
                        )}
                    </>
                )}
                </div>
            </DashboardShell>
        </>
    );
}
