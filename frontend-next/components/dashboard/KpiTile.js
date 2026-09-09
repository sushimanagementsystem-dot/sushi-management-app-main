import { addDaysStr, moneyStr } from "@/lib/kpiUtils";

/** Ported from dashboard.css's .kpi-tile / .kpi-tile-label / .kpi-tile-value
 * / .kpi-tile-sub / .kpi-tile-flag rules — shared by Overview, Kiosk
 * Comparison, and Stock Usage View. */
export function KpiTile({ label, value, subLines, children, unavailable }) {
    return (
        <div
            className={
                "group relative overflow-hidden rounded-card border bg-card p-4 shadow-elevate-1 transition-all duration-200 " +
                (unavailable
                    ? "border-dashed border-line bg-transparent shadow-none"
                    : "border-line hover:-translate-y-[3px] hover:border-accent/25 hover:shadow-elevate-3")
            }
        >
            {/* Accent top bar — hidden at rest, slides in on hover. A
                purely decorative "this card is alive" cue rather than
                relying on shadow depth alone to read as interactive. */}
            {!unavailable && (
                <span className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-accent transition-transform duration-200 group-hover:scale-x-100" />
            )}
            <div className="mb-[0.4rem] text-[0.8rem] font-semibold tracking-[0.01em] text-muted">{label}</div>
            <div
                className={
                    unavailable
                        ? "text-[0.95rem] font-semibold text-muted"
                        : "text-2xl font-bold leading-tight tracking-[-0.01em] tabular-nums"
                }
            >
                {value}
            </div>
            {(subLines || []).filter(Boolean).map((line, i) => (
                <div key={i} className="mt-[0.3rem] text-[0.8rem] text-muted">
                    {line}
                </div>
            ))}
            {children}
        </div>
    );
}

export function KpiTileGrid({ children }) {
    return <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-[0.8rem]">{children}</div>;
}

export function KpiSectionLabel({ children }) {
    return (
        <div className="mb-2 mt-6 text-xs font-bold uppercase tracking-[0.06em] text-muted first:mt-0">
            {children}
        </div>
    );
}

export function KpiFlag({ children }) {
    return (
        <div className="mt-[0.4rem] inline-block rounded-full bg-warn-bg px-[0.5rem] py-[0.1rem] text-[0.75rem] font-semibold text-warn-ink">
            {children}
        </div>
    );
}

const BADGE_COLORS = {
    fresh: "bg-success-bg text-success-ink",
    stale: "bg-warn-bg text-warn-ink",
    missing: "bg-danger-bg text-danger-ink",
};

export function KpiBadge({ status }) {
    const cls = BADGE_COLORS[String(status).toLowerCase()] || "bg-line text-ink";
    return (
        <span className={"inline-block rounded-full px-[0.55rem] py-[0.15rem] text-[0.75rem] font-bold " + cls}>
            {status}
        </span>
    );
}

/** Lightweight CSS-only sparkline — no charting library loaded for a single
 * trend strip; matches dashboard.css's "defer Chart.js until a tile
 * actually needs it" decision. */
export function Sparkline({ byDate, startDate, endDate }) {
    const dates = [];
    let d = startDate;
    while (d <= endDate) {
        dates.push(d);
        d = addDaysStr(d, 1);
    }
    const values = dates.map((dt) => byDate[dt] || 0);
    const max = Math.max(1, ...values);
    return (
        <div className="mt-2 flex h-[2.2rem] items-end gap-[2px]">
            {values.map((v, i) => (
                <div
                    key={i}
                    title={dates[i] + ": " + moneyStr(v)}
                    className="min-h-[2px] flex-1 rounded-t-[2px] bg-teal"
                    style={{ height: Math.max(2, Math.round((v / max) * 100)) + "%" }}
                />
            ))}
        </div>
    );
}
