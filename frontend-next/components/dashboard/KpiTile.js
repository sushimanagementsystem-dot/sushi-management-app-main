import { TrendingDown, TrendingUp } from "lucide-react";
import HelpTip from "./HelpTip";
import { addDaysStr, moneyStr } from "@/lib/kpiUtils";

/** Ported from dashboard.css's .kpi-tile / .kpi-tile-label / .kpi-tile-value
 * / .kpi-tile-sub / .kpi-tile-flag rules — shared by Overview, Kiosk
 * Comparison, and Stock Usage View. `icon`/`iconClassName` are optional
 * (most existing call sites pass neither) — iconClassName is a full
 * Tailwind className pair (e.g. "bg-chip-rose-bg text-chip-rose-ink", see
 * tailwind.config.js's chip tokens) so each metric can read as its own
 * color at a glance, same convention as the kiosk home menu's task icons
 * and Data Tables' Actions column. */
export function KpiTile({ label, value, subLines, children, unavailable, icon: Icon, iconClassName, help }) {
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
            {Icon && (
                <span
                    className={
                        "mb-2.5 flex h-11 w-11 items-center justify-center rounded-full " + (iconClassName || "bg-panel text-muted")
                    }
                >
                    <Icon size={22} strokeWidth={1.9} />
                </span>
            )}
            <div className="mb-[0.4rem] text-[0.8rem] font-semibold tracking-[0.01em] text-muted">
                {label}
                {help && <HelpTip id={help} />}
            </div>
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

/** "vs previous period" delta pill — deliberately neutral-toned (no red/
 * green judgment) rather than color-coding up/down as bad/good: for a
 * waste or damage figure a decrease is the desired direction, but for
 * Staff Food an increase isn't necessarily "bad" either, so picking a
 * color would be asserting a value judgment this component has no basis
 * for. `current`/`previous` are cost totals; renders nothing when there's
 * no previous-period baseline to compare against (previous === 0 and
 * current === 0 both read as flat "—0%" rather than a misleading ±∞%). */
export function TrendBadge({ current, previous }) {
    if (!previous && !current) {
        return (
            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-panel px-1.5 py-0.5 text-[0.72rem] font-semibold text-muted">
                — 0%
            </span>
        );
    }
    if (!previous) return null; // no baseline (previous period had nothing) — a % change would be meaningless
    const pct = Math.round(((current - previous) / previous) * 1000) / 10;
    const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : null;
    return (
        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-panel px-1.5 py-0.5 text-[0.72rem] font-semibold text-muted">
            {Icon && <Icon size={11} strokeWidth={2.5} />}
            {pct > 0 ? "+" : ""}
            {pct}%
        </span>
    );
}

export function KpiTileGrid({ children }) {
    return <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-[0.8rem]">{children}</div>;
}

export function KpiSectionLabel({ children, help }) {
    return (
        <div className="mb-2 mt-6 text-xs font-bold uppercase tracking-[0.06em] text-muted first:mt-0">
            {children}
            {help && <HelpTip id={help} />}
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
 * actually needs it" decision. Renders nothing when every value in range
 * is zero — a flat empty line at the bottom of an already-€0.00 tile is
 * visual weight with no signal, not a real trend to show. */
export function Sparkline({ byDate, startDate, endDate }) {
    const dates = [];
    let d = startDate;
    while (d <= endDate) {
        dates.push(d);
        d = addDaysStr(d, 1);
    }
    const values = dates.map((dt) => byDate[dt] || 0);
    if (!values.some((v) => v > 0)) return null;
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
