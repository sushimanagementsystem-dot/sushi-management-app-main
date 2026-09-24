"use client";

import { useEffect, useState } from "react";
import { Check, X, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import KpiFilters from "@/components/dashboard/KpiFilters";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { KpiBadge } from "@/components/dashboard/KpiTile";
import { useBootstrap } from "@/lib/queries";
import { dateFiltersFromQuery, moneyStr, qtyStr, presetRange, todayStr, addDaysStr, writeDateFiltersToQuery } from "@/lib/kpiUtils";

const MODAL_OVERLAY =
    "fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end";
const MODAL_BOX =
    "max-h-[calc(100vh-4rem)] w-[32rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card bg-card p-[1.4rem] shadow-elevate-3 " +
    "max-[720px]:w-full max-[720px]:max-w-full max-[720px]:max-h-[88vh] max-[720px]:rounded-b-none max-[720px]:rounded-t-[1.2rem] max-[720px]:p-[1.1rem]";

// `help` is the column's plain-English definition, shown on hover and in the
// key under the table — the waste columns in particular are easy to misread.
const COLUMNS = [
    { label: "Kiosk" },
    {
        label: "Morning Waste Cost",
        help: "Cost of the expired finished products binned in the Morning Waste form during the period: units x product unit cost. A product with no unit cost yet cannot be valued (counted in the note under the figure). Does not include Food Waste.",
    },
    {
        label: "Morning Waste Rate %",
        help: "Morning-waste units divided by the units planned for the batches they came from (the production plan of the day each was made, not of the day it was binned). Waste with no plan behind it is left out.",
    },
    { label: "Food Waste", help: "Raw stock items thrown away in the Food Waste form, in grams. Costed only where the item has a cost per 100g set; not part of Morning Waste Cost." },
    { label: "Damage Cost" },
    { label: "Damage Rate /100" },
    { label: "Staff Food Cost" },
    { label: "Stocktake" },
    { label: "Deliveries" },
    { label: "Unmapped Lines" },
    { label: "Approved Value" },
    { label: "Coverage" },
];

/** Grams as g under a kilo, kg above — Food Waste is logged in grams. */
function gramsStr(g) {
    return g >= 1000 ? qtyStr(g / 1000) + " kg" : qtyStr(g) + " g";
}

export default function KioskComparisonPage() {
    const initial = dateFiltersFromQuery("last7");
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
    } = useBootstrap("bootstrap_kiosk_comparison", filters, { enabled: !!filters.startDate });

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    function applyPreset(key) {
        const { start, end } = presetRange(key);
        setActivePreset(key);
        setFilters({ startDate: start, endDate: end });
    }

    return (
        <>
            <PageTitle title="Dashboard — Kiosk Comparison" />
            <DashboardShell activeKey="kiosk-comparison">
                {/* One scroll region for the whole page — PageHeader is sticky
                    inside it, not a static sibling above a separately
                    scrolling content box. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Kiosk Comparison"
                        description="Waste, damage, stocktake and delivery metrics side by side across every kiosk."
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

                    <TaskCompletionSection />

                    {loading && (
                        <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                    )}
                    {error && <div className="text-danger-ink">{error}</div>}

                    {!loading && res?.ok && (
                        <SectionCard title="All kiosks" className="mb-0">
                            <div className="overflow-hidden rounded-lg border border-line">
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse bg-card text-[0.85rem]">
                                        <thead>
                                            <tr>
                                                {COLUMNS.map((c) => (
                                                    <th
                                                        key={c.label}
                                                        title={c.help}
                                                        className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted"
                                                    >
                                                        {c.label}
                                                        {c.help && <span className="ml-1 cursor-help normal-case text-muted/70">ⓘ</span>}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {res.kiosks.map((kiosk) => (
                                                <CompareRow key={kiosk.id} kiosk={kiosk} res={res} />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <ul className="mt-3 flex list-none flex-col gap-1 p-0 text-[0.75rem] text-muted">
                                {COLUMNS.filter((c) => c.help).map((c) => (
                                    <li key={c.label}>
                                        <span className="font-semibold text-ink">{c.label}:</span> {c.help}
                                    </li>
                                ))}
                            </ul>
                        </SectionCard>
                    )}
                </div>
            </DashboardShell>
        </>
    );
}

function Td({ children, rate }) {
    return (
        <td className={"whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 " + (rate ? "bg-accent/[0.06]" : "")}>
            {children}
        </td>
    );
}

/** The small grey line under a figure — the units/denominator it came from. */
function Sub({ children }) {
    return <div className="text-[0.68rem] font-normal text-muted">{children}</div>;
}

function CompareRow({ kiosk, res }) {
    const kioskId = kiosk.id;
    const waste = (res.movementStats[kioskId] || {}).EXPIRED_WASTE || { qty: 0, cost: 0, uncostedCount: 0 };
    const damage = (res.movementStats[kioskId] || {}).DAMAGE || { qty: 0, cost: 0, uncostedCount: 0 };
    const foodWaste = (res.foodWaste || {})[kioskId] || { qty: 0, cost: 0, count: 0, uncostedCount: 0 };
    const staffFood = (res.staffFood[kioskId] || {}).total || { cost: 0 };
    const rates = res.damageWasteRates[kioskId] || { plannedQty: 0, damage: { ratePer100: null }, waste: { ratePct: null } };
    const stocktake = res.stocktakeStatus[kioskId] || { status: "MISSING" };
    const delivery = res.deliveryInvoice[kioskId] || { submitted: 0, unmappedLines: 0, approvedValue: 0 };

    const coverageWarnings = [];
    if (rates.plannedQty === 0) coverageWarnings.push("no production data");
    if (stocktake.status === "MISSING") coverageWarnings.push("no complete stocktake");
    else if (stocktake.status === "STALE") coverageWarnings.push("stale stocktake");

    return (
        <tr className="transition-colors duration-100 hover:bg-panel/70">
            <Td>{kiosk.name}</Td>
            <Td>
                {moneyStr(waste.cost)}
                <Sub>
                    {waste.qty} unit{waste.qty === 1 ? "" : "s"}
                    {waste.uncostedCount > 0 && ` · ${waste.uncostedCount} not costed`}
                </Sub>
            </Td>
            <Td rate>
                {rates.waste.ratePct === null ? "n/a" : rates.waste.ratePct + "%"}
                {rates.waste.rateBase > 0 && <Sub>{`${qtyStr(rates.waste.rateUnits)} of ${qtyStr(rates.waste.rateBase)} planned`}</Sub>}
            </Td>
            <Td>
                {foodWaste.count === 0 ? "—" : gramsStr(foodWaste.qty)}
                {foodWaste.count > 0 && <Sub>{foodWaste.uncostedCount === foodWaste.count ? "not costed" : moneyStr(foodWaste.cost) + (foodWaste.uncostedCount ? ` · ${foodWaste.uncostedCount} not costed` : "")}</Sub>}
            </Td>
            <Td>{moneyStr(damage.cost)}</Td>
            <Td rate>{rates.damage.ratePer100 === null ? "n/a" : rates.damage.ratePer100}</Td>
            <Td>{moneyStr(staffFood.cost)}</Td>
            <Td>
                <KpiBadge status={stocktake.status} />
            </Td>
            <Td>{delivery.submitted}</Td>
            <Td>{delivery.unmappedLines}</Td>
            <Td>{moneyStr(delivery.approvedValue)}</Td>
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 text-[0.75rem] text-danger-ink">
                {coverageWarnings.length ? coverageWarnings.join("; ") : "—"}
            </td>
        </tr>
    );
}

// --- Task Completion matrix ---------------------------------------------
// The "who hasn't done what today" grid the request asked for: rows are
// tasks, columns are kiosks (transposed from the cost table above, on
// purpose — that table compares kiosks row-by-row over a date *range*;
// this compares tasks for one single day, which is what a same-day
// completion check needs). Clicking a done cell opens the actual submitted
// rows behind it, so a checkmark can be verified, not just trusted.
function TaskCompletionSection() {
    const [date, setDate] = useState(todayStr());
    const [detailCell, setDetailCell] = useState(null); // { kioskId, kioskName, taskKey, label }

    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_kiosk_task_status", { date });
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const isToday = date === todayStr();

    return (
        <SectionCard
            title="Task Completion"
            className="mb-5"
            actions={
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        title="Previous day"
                        onClick={() => setDate((d) => addDaysStr(d, -1))}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-card text-muted hover:text-ink"
                    >
                        <ChevronLeft size={14} strokeWidth={2.25} />
                    </button>
                    <div className="relative">
                        <CalendarDays size={13} strokeWidth={2.25} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="py-1.5 pl-7 pr-2 text-[0.82rem]" />
                    </div>
                    <button
                        type="button"
                        title="Next day"
                        disabled={isToday}
                        onClick={() => setDate((d) => addDaysStr(d, 1))}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-card text-muted hover:text-ink disabled:opacity-40"
                    >
                        <ChevronRight size={14} strokeWidth={2.25} />
                    </button>
                    {!isToday && (
                        <button
                            type="button"
                            onClick={() => setDate(todayStr())}
                            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[0.78rem] font-semibold text-muted hover:text-ink"
                        >
                            Today
                        </button>
                    )}
                    <RefreshButton onRefetch={refetch} />
                </div>
            }
        >
            <p className="mb-3 text-[0.8rem] text-muted">
                Instantly see which kiosk hasn&apos;t completed a task for the day. Click any mark to see the actual submitted data.
            </p>

            {loading && (
                <div className="mx-auto my-10 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
            )}
            {error && <div className="text-danger-ink">{error}</div>}

            {!loading && res?.ok !== false && res && (
                <div className="overflow-hidden rounded-lg border border-line">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse bg-card text-[0.85rem]">
                            <thead>
                                <tr>
                                    <th className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                        Task
                                    </th>
                                    {res.kiosks.map((k) => (
                                        <th
                                            key={k.id}
                                            className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-center text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted"
                                        >
                                            {k.name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {res.tasks.map((task) => (
                                    <tr key={task.key} className="transition-colors duration-100 hover:bg-panel/70">
                                        <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 font-medium text-ink">{task.label}</td>
                                        {res.kiosks.map((k) => {
                                            const done = !!res.status?.[k.id]?.[task.key];
                                            return (
                                                <td key={k.id} className="whitespace-nowrap border-b border-line px-[0.9rem] py-2 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => setDetailCell({ kioskId: k.id, kioskName: k.name, taskKey: task.key, label: task.label })}
                                                        title={`${k.name} — ${task.label}: ${done ? "view submitted data" : "not completed"}`}
                                                        className={
                                                            // grid place-items-center, not flex — a lone small SVG as the
                                                            // only flex child of a fixed-size row-direction flex box
                                                            // renders with its width crushed to ~1px in this app's Chrome
                                                            // build (height unaffected, a main-axis-only flex-basis bug);
                                                            // grid sizes the icon by its own box instead of a flex-basis
                                                            // computation, which doesn't hit it.
                                                            //
                                                            // p-0 overrides globals.css's base `button { padding: 0.7rem }`
                                                            // — left in place, that padding alone (11.2px a side) ate
                                                            // almost the entire 24px box, leaving ~1.6px for the 13px
                                                            // icon to center inside and pushing it to one corner instead.
                                                            "grid h-6 w-6 place-items-center rounded-full border-none p-0 " +
                                                            (done ? "bg-success-bg text-success-ink hover:opacity-80" : "bg-danger-bg text-danger-ink hover:opacity-80")
                                                        }
                                                    >
                                                        {done ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {detailCell && <TaskDetailModal date={date} cell={detailCell} onClose={() => setDetailCell(null)} />}
        </SectionCard>
    );
}

function TaskDetailModal({ date, cell, onClose }) {
    const { data: res, isPending: loading, error: bootError } = useBootstrap("get_kiosk_task_detail", {
        kioskId: cell.kioskId,
        date,
        taskKey: cell.taskKey,
    });
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = res?.rows || [];
    const hasCost = rows.some((r) => r.cost !== undefined);

    return (
        <div className={MODAL_OVERLAY} onClick={onClose}>
            <div className={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
                <h3 className="mb-1 text-lg font-bold tracking-[-0.01em]">
                    {cell.kioskName} — {cell.label}
                </h3>
                <p className="mb-4 text-[0.8rem] text-muted">{date}</p>

                {loading && (
                    <div className="mx-auto my-8 h-7 w-7 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                )}
                {error && <div className="text-danger-ink">{error}</div>}

                {!loading && !error && (
                    <>
                        {!rows.length ? (
                            <p className="py-6 text-center text-[0.9rem] text-muted">Not submitted for this day.</p>
                        ) : (
                            <div className="overflow-hidden rounded-lg border border-line">
                                <table className="w-full border-collapse bg-card text-[0.85rem]">
                                    <thead>
                                        <tr>
                                            <th className="whitespace-nowrap border-b border-line bg-panel px-[0.8rem] py-2 text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                                Item
                                            </th>
                                            <th className="whitespace-nowrap border-b border-line bg-panel px-[0.8rem] py-2 text-right text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                                Qty
                                            </th>
                                            {hasCost && (
                                                <th className="whitespace-nowrap border-b border-line bg-panel px-[0.8rem] py-2 text-right text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                                    Cost
                                                </th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r, i) => (
                                            <tr key={i}>
                                                <td className="whitespace-nowrap border-b border-line px-[0.8rem] py-2 text-ink">{r.name}</td>
                                                <td className="whitespace-nowrap border-b border-line px-[0.8rem] py-2 text-right tabular-nums text-ink">
                                                    {qtyStr(r.qty)}
                                                </td>
                                                {hasCost && (
                                                    <td className="whitespace-nowrap border-b border-line px-[0.8rem] py-2 text-right tabular-nums text-ink">
                                                        {r.cost === null || r.cost === undefined ? "—" : moneyStr(r.cost)}
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}

                <button
                    type="button"
                    onClick={onClose}
                    className="mt-4 rounded-lg border-none bg-line px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink"
                >
                    Close
                </button>
            </div>
        </div>
    );
}
