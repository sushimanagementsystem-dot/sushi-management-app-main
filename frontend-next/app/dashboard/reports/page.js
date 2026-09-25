"use client";

import { useEffect, useState } from "react";
import { Scale, Trash2, Factory, Package, TrendingUp, AlertOctagon, UtensilsCrossed, LineChart } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import PillButton from "@/components/dashboard/PillButton";
import DashSelect from "@/components/dashboard/DashSelect";
import RefreshButton from "@/components/dashboard/RefreshButton";
import ReportExportButtons from "@/components/dashboard/ReportExportButtons";
import { Sparkline } from "@/components/dashboard/KpiTile";
import { useBootstrap } from "@/lib/queries";
import { KPI_PRESETS, dateFiltersFromQuery, presetRange, moneyStr, qtyStr, writeDateFiltersToQuery } from "@/lib/kpiUtils";

const REPORT_TYPES = [
    { key: "comparison", label: "Store Comparison", Icon: Scale },
    { key: "waste", label: "Waste", Icon: Trash2 },
    { key: "production", label: "Production", Icon: Factory },
    { key: "usage", label: "Product Usage", Icon: Package },
    { key: "profit", label: "Profit", Icon: TrendingUp },
    { key: "variance", label: "Stock Variance", Icon: AlertOctagon },
    { key: "staff-food", label: "Staff Food", Icon: UtensilsCrossed },
    { key: "trends", label: "Trends", Icon: LineChart },
];

/**
 * Reports — one hub for every report topic the request listed (waste,
 * production, store comparison, product usage, profit, stock variance,
 * staff food, trends), each with a period picker, CSV export, and an
 * on-demand "email this report" button. Every report type here reuses an
 * existing bootstrap action from its own dedicated page (Kiosk Comparison,
 * Stock Usage, Profit, Stock Variances, Staff Food) — this isn't a second,
 * separately-computed source of truth, just a report-shaped view over the
 * same numbers. Production and Trends are the two topics nothing else
 * already served, so those get their own small backend action.
 */
export default function ReportsPage() {
    const initial = dateFiltersFromQuery("last7");
    const [filters, setFilters] = useState({ startDate: initial.startDate, endDate: initial.endDate });
    const [activePreset, setActivePreset] = useState(initial.preset);
    const [reportKey, setReportKey] = useState("comparison");

    useEffect(() => {
        writeDateFiltersToQuery({ startDate: filters.startDate, endDate: filters.endDate, preset: activePreset });
    }, [filters, activePreset]);

    function applyPreset(key) {
        const { start, end } = presetRange(key);
        setActivePreset(key);
        setFilters({ startDate: start, endDate: end });
    }

    return (
        <>
            <PageTitle title="Dashboard — Reports" />
            <DashboardShell activeKey="reports">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Reports"
                        help="reports.page"
                        description="Every report in one place — daily, weekly, or monthly, downloadable as CSV, emailable on demand."
                    >
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            {KPI_PRESETS.map((p) => (
                                <PillButton key={p.key} active={activePreset === p.key} onClick={() => applyPreset(p.key)}>
                                    {p.label}
                                </PillButton>
                            ))}
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(e) => {
                                    setActivePreset(null);
                                    setFilters((f) => ({ ...f, startDate: e.target.value }));
                                }}
                                className="w-auto py-1 px-2 text-[0.72rem]"
                            />
                            <span className="text-[0.72rem] text-muted">to</span>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(e) => {
                                    setActivePreset(null);
                                    setFilters((f) => ({ ...f, endDate: e.target.value }));
                                }}
                                className="w-auto py-1 px-2 text-[0.72rem]"
                            />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {REPORT_TYPES.map((r) => (
                                <PillButton key={r.key} active={reportKey === r.key} onClick={() => setReportKey(r.key)} icon={r.Icon}>
                                    {r.label}
                                </PillButton>
                            ))}
                        </div>
                    </PageHeader>

                    <ReportBody reportKey={reportKey} filters={filters} />
                </div>
            </DashboardShell>
        </>
    );
}

function ReportBody({ reportKey, filters }) {
    switch (reportKey) {
        case "comparison":
            return <ComparisonReport filters={filters} />;
        case "waste":
            return <WasteReport filters={filters} />;
        case "production":
            return <ProductionReport filters={filters} />;
        case "usage":
            return <UsageReport filters={filters} />;
        case "profit":
            return <ProfitReport filters={filters} />;
        case "variance":
            return <VarianceReport filters={filters} />;
        case "staff-food":
            return <StaffFoodReport filters={filters} />;
        case "trends":
            return <TrendsReport filters={filters} />;
        default:
            return null;
    }
}

// --- Shared report shell -------------------------------------------------

function ReportShell({ title, help, subtitle, loading, error, refetch, columns, rows, filename, children, note }) {
    return (
        <SectionCard
            title={title}
            help={help}
            description={subtitle}
            className="mb-0"
            actions={
                <div className="flex flex-wrap items-center gap-1.5">
                    <RefreshButton onRefetch={refetch} />
                    {!loading && !error && <ReportExportButtons filename={filename} title={title} subtitle={subtitle} columns={columns} rows={rows} />}
                </div>
            }
        >
            {loading && (
                <div className="mx-auto my-10 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
            )}
            {error && <div className="text-danger-ink">{error}</div>}
            {!loading && !error && (children ?? <ReportTable columns={columns} rows={rows} />)}
            {!loading && !error && note && <p className="mb-0 mt-3 text-[0.78rem] leading-snug text-muted">{note}</p>}
        </SectionCard>
    );
}

function ReportTable({ columns, rows }) {
    if (!rows.length) return <p className="py-6 text-center text-[0.9rem] text-muted">No data for this period.</p>;
    return (
        <div className="overflow-hidden rounded-lg border border-line">
            <div className="overflow-x-auto">
                <table className="w-full border-collapse bg-card text-[0.85rem]">
                    <thead>
                        <tr>
                            {columns.map((c) => (
                                <th
                                    key={c.key}
                                    className={
                                        "whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted " +
                                        (c.align === "right" ? "text-right" : "text-left")
                                    }
                                >
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i} className="transition-colors duration-100 hover:bg-panel/70">
                                {columns.map((c) => (
                                    <td
                                        key={c.key}
                                        className={
                                            "whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 " + (c.align === "right" ? "text-right tabular-nums" : "")
                                        }
                                    >
                                        {c.value(row)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const col = (key, label, value, align) => ({ key, label, value, align });

// --- Store Comparison ------------------------------------------------------

function ComparisonReport({ filters }) {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_kiosk_comparison", filters);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = res?.ok !== false && res
        ? res.kiosks.map((k) => {
              const waste = res.movementStats[k.id]?.EXPIRED_WASTE || { cost: 0 };
              const damage = res.movementStats[k.id]?.DAMAGE || { cost: 0 };
              const staffFood = res.staffFood[k.id]?.total || { cost: 0 };
              const stocktake = res.stocktakeStatus[k.id] || { status: "MISSING" };
              return { kioskName: k.name, wasteCost: waste.cost, damageCost: damage.cost, staffFoodCost: staffFood.cost, stocktakeStatus: stocktake.status };
          })
        : [];
    const columns = [
        col("kiosk", "Kiosk", (r) => r.kioskName),
        col("waste", "Waste Cost", (r) => moneyStr(r.wasteCost), "right"),
        col("damage", "Damage Cost", (r) => moneyStr(r.damageCost), "right"),
        col("staffFood", "Staff Food Cost", (r) => moneyStr(r.staffFoodCost), "right"),
        col("stocktake", "Stocktake", (r) => r.stocktakeStatus),
    ];
    return (
        <ReportShell
            title="Store Comparison"
            help="compare.page"
            subtitle={res ? `${res.startDate} – ${res.endDate}` : ""}
            loading={loading}
            error={error}
            refetch={refetch}
            columns={columns}
            rows={rows}
            filename="store-comparison.csv"
        />
    );
}

// --- Waste -----------------------------------------------------------------

function WasteReport({ filters }) {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_kiosk_comparison", filters);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = res?.ok !== false && res
        ? res.kiosks.map((k) => {
              const waste = res.movementStats[k.id]?.EXPIRED_WASTE || { qty: 0, cost: 0 };
              const rates = res.damageWasteRates[k.id]?.waste;
              return { kioskName: k.name, qty: waste.qty, cost: waste.cost, uncosted: waste.uncostedCount, ratePct: rates?.ratePct, rateUnits: rates?.rateUnits ?? 0, rateBase: rates?.rateBase ?? 0 };
          })
        : [];
    const columns = [
        col("kiosk", "Kiosk", (r) => r.kioskName),
        col("qty", "Waste Qty", (r) => qtyStr(r.qty), "right"),
        col("cost", "Waste Cost", (r) => moneyStr(r.cost) + (r.uncosted ? ` (+${r.uncosted} not costed)` : ""), "right"),
        col("rate", "Waste Rate %", (r) => (r.ratePct === null || r.ratePct === undefined ? "n/a" : r.ratePct + "%"), "right"),
        col("rateUnits", "Waste in rate", (r) => qtyStr(r.rateUnits), "right"),
        col("rateBase", "Planned (rate base)", (r) => qtyStr(r.rateBase), "right"),
    ];
    return (
        <ReportShell
            title="Waste"
            help="compare.wasteRate"
            subtitle={res ? `${res.startDate} – ${res.endDate}` : ""}
            loading={loading}
            error={error}
            refetch={refetch}
            columns={columns}
            rows={rows}
            filename="waste-report.csv"
            note={
                <>
                    <b>Waste Rate %</b> = morning-waste units ÷ units planned for the batches they came from. Waste is thrown away 2 to 5 days after a batch is made, so
                    each unit is matched to the production plan of the day it was <i>made</i>, and the base is the plan of the batches that were due to be thrown away in
                    this period ("Planned (rate base)"). "Waste in rate" is the waste that could be matched to a planned batch; waste with no plan behind it (a day with no
                    fridge count, a product that was never planned) is left out of the rate, which is why it can be lower than "Waste Qty". Waste Cost is units × product
                    unit cost; units of products with no cost yet are counted but not priced. Food Waste (raw stock in grams) is a separate thing and is not included. This
                    is the same figure Kiosk Comparison and Issues use.
                </>
            }
        />
    );
}

// --- Production --------------------------------------------------------

function ProductionReport({ filters }) {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_production_report", filters);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const kiosks = res?.kiosks || [];
    const products = res?.products || [];
    // Products down the left, one column per kiosk, so the same product reads straight across the kiosks; a Total row closes it.
    const totalRow = {
        productId: "__total__",
        productName: "Total",
        byKiosk: Object.fromEntries(kiosks.map((k) => [k.id, products.reduce((sum, p) => sum + (p.byKiosk[k.id] || 0), 0)])),
        total: products.reduce((sum, p) => sum + p.total, 0),
    };
    const rows = products.length ? [...products, totalRow] : [];
    const columns = [
        col("product", "Product", (r) => r.productName),
        ...kiosks.map((k) => col(k.id, k.name, (r) => (r.byKiosk[k.id] ? qtyStr(r.byKiosk[k.id]) : "–"), "right")),
        col("total", "Total", (r) => qtyStr(r.total), "right"),
    ];
    return (
        <ReportShell
            title="Production"
            help="reports.production"
            subtitle={res ? `Planned quantity per product, by kiosk — ${res.startDate} – ${res.endDate}` : ""}
            loading={loading}
            error={error}
            refetch={refetch}
            columns={columns}
            rows={rows}
            filename="production-report.csv"
            note="Planned production quantity from the production plan (what each kiosk was told to make), summed over the period. A dash means nothing was planned for that product at that kiosk."
        />
    );
}

// --- Product Usage -----------------------------------------------------
// Bounded by two COMPLETE stocktakes for one kiosk, not a free date range
// (bootstrap_stock_usage's own contract — see Stock Usage View) — this
// report reuses that exact action rather than reinventing the anchor.

function UsageReport({ filters }) {
    const [kioskId, setKioskId] = useState("");
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_stock_usage", { kioskId });
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const kiosks = res?.kiosks || [];
    const rows = res?.available ? res.lines || [] : [];
    const columns = [
        col("item", "Stock Item", (r) => `${r.name} (${r.unit})`),
        col("opening", "Opening", (r) => qtyStr(r.opening), "right"),
        col("deliveriesIn", "Deliveries In", (r) => qtyStr(r.deliveriesIn), "right"),
        col("transfersIn", "Transfers In", (r) => qtyStr(r.transfersIn), "right"),
        col("transfersOut", "Transfers Out", (r) => qtyStr(r.transfersOut), "right"),
        col("closing", "Closing", (r) => qtyStr(r.closing), "right"),
        col("usage", "Actual Usage", (r) => qtyStr(r.actualUsage), "right"),
    ];

    return (
        <SectionCard
            title="Product Usage"
            help="stockUsage.page"
            description={res?.available ? `Comparing stocktake on ${res.openingDate} to stocktake on ${res.closingDate}.` : "Pick a kiosk with at least two complete stocktakes."}
            className="mb-0"
            actions={
                <div className="flex flex-wrap items-center gap-1.5">
                    <DashSelect value={kioskId} onChange={(e) => setKioskId(e.target.value)}>
                        <option value="">Choose a kiosk…</option>
                        {kiosks.map((k) => (
                            <option key={k.id} value={k.id}>
                                {k.name}
                            </option>
                        ))}
                    </DashSelect>
                    <RefreshButton onRefetch={refetch} />
                    {res?.available && <ReportExportButtons filename="product-usage.csv" title="Product Usage" subtitle={`${res.openingDate} – ${res.closingDate}`} columns={columns} rows={rows} />}
                </div>
            }
        >
            {loading && (
                <div className="mx-auto my-10 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
            )}
            {error && <div className="text-danger-ink">{error}</div>}
            {!loading && !error && !res?.available && (
                <p className="py-6 text-center text-[0.9rem] text-muted">{kioskId ? res?.reason || "Not available." : "Choose a kiosk to see its product usage."}</p>
            )}
            {!loading && !error && res?.available && <ReportTable columns={columns} rows={rows} />}
        </SectionCard>
    );
}

// --- Profit --------------------------------------------------------------

function ProfitReport({ filters }) {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_profit_page", filters);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = [];
    for (const week of res?.weeks || []) {
        for (const k of week.kiosks) rows.push({ weekStart: week.weekStart, weekEnd: week.weekEnd, ...k });
    }
    const columns = [
        col("week", "Week Of", (r) => r.weekStart),
        col("kiosk", "Kiosk", (r) => r.kioskName),
        col("sales", "Sales", (r) => (r.salesAmount === null ? "—" : moneyStr(r.salesAmount)), "right"),
        col("cogs", "COGS", (r) => moneyStr(r.cogs), "right"),
        col("waste", "Waste Cost", (r) => moneyStr(r.wasteCost), "right"),
        col("damage", "Damage Cost", (r) => moneyStr(r.damageCost), "right"),
        col("staffFood", "Staff Food Cost", (r) => moneyStr(r.staffFoodCost), "right"),
        col("fixed", "Fixed Costs", (r) => (r.fixedCosts === null ? "—" : moneyStr(r.fixedCosts)), "right"),
        col("misc", "Misc Costs", (r) => (r.miscCosts === null ? "—" : moneyStr(r.miscCosts)), "right"),
        col("gross", "Gross Profit", (r) => (r.grossProfit === null ? "—" : moneyStr(r.grossProfit)), "right"),
        col("labour", "Labour", (r) => (r.labourCost === null ? (r.labourHours === null ? "—" : "rate not set") : moneyStr(r.labourCost)), "right"),
        col("ebitda", "EBITDA Profit", (r) => (r.ebitda === null ? "—" : moneyStr(r.ebitda)), "right"),
    ];
    return (
        <ReportShell
            title="Profit"
            help="profit.page"
            subtitle={res ? `${res.startDate} – ${res.endDate}, by week` : ""}
            loading={loading}
            error={error}
            refetch={refetch}
            columns={columns}
            rows={rows}
            filename="profit-report.csv"
        />
    );
}

// --- Stock Variance --------------------------------------------------------

function VarianceReport({ filters }) {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_stock_variances", filters);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = res?.variances || [];
    const columns = [
        col("kiosk", "Kiosk", (r) => r.kioskName),
        col("item", "Item", (r) => r.stockItemName),
        col("date", "Date", (r) => r.date),
        col("expected", "Expected", (r) => qtyStr(r.expected), "right"),
        col("actual", "Actual", (r) => qtyStr(r.actual), "right"),
        col("difference", "Difference", (r) => (r.difference > 0 ? "+" : "") + qtyStr(r.difference) + " " + r.unit, "right"),
    ];
    return (
        <ReportShell
            title="Stock Variance"
            help="variances.page"
            subtitle={res ? `${res.startDate} – ${res.endDate}` : ""}
            loading={loading}
            error={error}
            refetch={refetch}
            columns={columns}
            rows={rows}
            filename="stock-variance-report.csv"
        />
    );
}

// --- Staff Food ------------------------------------------------------------

function StaffFoodReport({ filters }) {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_staff_food_report", filters);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = [];
    for (const day of res?.days || []) {
        for (const k of day.kiosks) {
            if (k.qty > 0 || k.cost > 0) rows.push({ date: day.date, ...k });
        }
    }
    const columns = [
        col("date", "Date", (r) => r.date),
        col("kiosk", "Kiosk", (r) => r.kioskName),
        col("qty", "Qty", (r) => qtyStr(r.qty), "right"),
        col("cost", "Cost", (r) => moneyStr(r.cost), "right"),
    ];
    return (
        <ReportShell
            title="Staff Food"
            help="staffFoodReport.page"
            subtitle={res ? `${res.startDate} – ${res.endDate}` : ""}
            loading={loading}
            error={error}
            refetch={refetch}
            columns={columns}
            rows={rows}
            filename="staff-food-report.csv"
        />
    );
}

// --- Trends ------------------------------------------------------------

const TREND_METRICS = [
    { key: "wasteCost", label: "Waste Cost" },
    { key: "damageCost", label: "Damage Cost" },
    { key: "staffFoodCost", label: "Staff Food Cost" },
];

function TrendsReport({ filters }) {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_trends_report", filters);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = res?.days || [];
    const columns = [
        col("date", "Date", (r) => r.date),
        col("waste", "Waste Cost", (r) => moneyStr(r.wasteCost), "right"),
        col("damage", "Damage Cost", (r) => moneyStr(r.damageCost), "right"),
        col("staffFood", "Staff Food Cost", (r) => moneyStr(r.staffFoodCost), "right"),
    ];

    return (
        <ReportShell
            title="Trends"
            help="reports.trends"
            subtitle={res ? `Day by day, ${res.startDate} – ${res.endDate}` : ""}
            loading={loading}
            error={error}
            refetch={refetch}
            columns={columns}
            rows={rows}
            filename="trends-report.csv"
        >
            {res && (
                <>
                    <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                        {TREND_METRICS.map((m) => {
                            const byDate = {};
                            for (const d of rows) byDate[d.date] = d[m.key];
                            return (
                                <div key={m.key} className="rounded-card border border-line bg-card p-3.5 shadow-elevate-1">
                                    <div className="text-[0.8rem] font-semibold text-muted">{m.label}</div>
                                    <Sparkline byDate={byDate} startDate={res.startDate} endDate={res.endDate} />
                                </div>
                            );
                        })}
                    </div>
                    <ReportTable columns={columns} rows={rows} />
                </>
            )}
        </ReportShell>
    );
}
