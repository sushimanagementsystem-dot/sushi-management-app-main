"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Store, ClipboardX, TrendingUp } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import RefreshButton from "@/components/dashboard/RefreshButton";
import DashSelect from "@/components/dashboard/DashSelect";
import { useBootstrap } from "@/lib/queries";

// Keys match the backend's DATE_RANGE_KEYS. "This week" is the default because
// it is what this page always showed: this week's stock variances, and today's
// missing tasks / waste alerts.
const DATE_RANGES = [
    { key: "today", label: "Today", empty: "today" },
    { key: "yesterday", label: "Yesterday", empty: "yesterday" },
    { key: "week", label: "This week", empty: "this week" },
    { key: "all", label: "All time", empty: "on record" },
];

const CATEGORY_ICON = {
    MISSING_TASK: ClipboardX,
    STOCK_VARIANCE: AlertOctagon,
    WASTE_HIGH: TrendingUp,
    DAMAGE_HIGH: TrendingUp,
};

const PAGE_SIZE = 15;

/** "Today" / "Yesterday" / a short date — same day-label convention the
 * All Submissions page uses, so a date reads the same way everywhere on
 * the dashboard. Missing tasks and rate outliers are dated to the day
 * they were evaluated as of; a stock variance keeps its own stocktake
 * date, which is exactly what this label surfaces. */
function formatIssueDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00Z");
    const today = new Date();
    const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    if (dateStr === todayStr) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") + "-" + String(yesterday.getDate()).padStart(2, "0");
    if (dateStr === yesterdayStr) return "Yesterday";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Issues — the "what's wrong right now, across every kiosk" digest: open
 * the dashboard and see kiosk + problem in one glance instead of checking
 * Task Completion, Stock Variances, and Kiosk Comparison separately to
 * notice the same three things. Every row is computed by bootstrap_issues
 * from the same underlying services (missing daily tasks, stock variances,
 * and waste/damage rates clearly above a kiosk's own usual level) —
 * nothing here is a second, independently-tracked signal, so an issue
 * closing itself out (task submitted, variance resolved) just means it
 * stops appearing on the next refresh. The date dropdown picks the range:
 * variances inside it, and the missing-task / waste checks as of its last day.
 */
export default function IssuesPage() {
    // limit grows 15 at a time on "Load more" — the backend does the
    // actual slicing (bootstrap_issues computes the full list, sorted,
    // then returns only issues[0..limit)), so a fresh page load only ever
    // ships the 15 rows actually shown instead of every issue that
    // exists, and that only grows as more issues accumulate.
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [range, setRange] = useState("week");
    // placeholderData keeps the current page's rows on screen while the
    // next (bigger) page loads, instead of the whole list flashing back
    // to a spinner on every "Load more" click — isPending below still
    // only reflects the true first load.
    const {
        data: res,
        isPending: loading,
        error: bootError,
        refetch,
    } = useBootstrap("bootstrap_issues", { limit, range }, { placeholderData: (prev) => prev });
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    async function handleRefresh() {
        setLimit(PAGE_SIZE); // back to page one on refresh, not wherever "Load more" had gotten to
        return refetch();
    }

    return (
        <>
            <PageTitle title="Dashboard — Issues" />
            <DashboardShell activeKey="issues">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Issues"
                        help="issues.page"
                        description="Every kiosk's pending problems in one place — what's wrong, which kiosk, and what needs attention."
                        actions={<RefreshButton onRefetch={handleRefresh} />}
                    />

                    {loading && (
                        <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                    )}
                    {error && <div className="text-danger-ink">{error}</div>}

                    {!loading && res && !error && (
                        <IssuesList
                            res={res}
                            range={range}
                            onRangeChange={(next) => {
                                setLimit(PAGE_SIZE); // a different range is a different list, so back to page one
                                setRange(next);
                            }}
                            onLoadMore={() => setLimit((l) => l + PAGE_SIZE)}
                        />
                    )}
                </div>
            </DashboardShell>
        </>
    );
}

function IssuesList({ res, range, onRangeChange, onLoadMore }) {
    // Already sorted most-urgent-first by the backend (severity desc, then
    // kiosk name), and already paginated server-side to `limit` rows.
    const issues = res.issues || [];
    const counts = res.counts || { high: 0, warn: 0, total: 0 };
    const hasMore = !!res.hasMore;

    return (
        <>
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
                <DashSelect value={range} onChange={(e) => onRangeChange(e.target.value)} aria-label="Date range">
                    {DATE_RANGES.map((r) => (
                        <option key={r.key} value={r.key}>
                            {r.label}
                        </option>
                    ))}
                </DashSelect>
                <div
                    className={
                        "flex items-center gap-2 rounded-full px-[0.65rem] py-[0.2rem] text-[0.78rem] font-semibold " +
                        (counts.total > 0 ? "bg-danger-bg text-danger-ink" : "bg-success-bg text-success-ink")
                    }
                >
                    {counts.total > 0 ? <AlertOctagon size={13} strokeWidth={2.25} /> : <CheckCircle2 size={13} strokeWidth={2.25} />}
                    {counts.total} issue{counts.total === 1 ? "" : "s"}
                </div>
                {counts.total > 0 && (
                    <span className="text-[0.78rem] text-muted">
                        {counts.high} need{counts.high === 1 ? "s" : ""} attention, {counts.warn} worth a look
                    </span>
                )}
            </div>

            <SectionCard title="Open issues" className="mb-0">
                {!issues.length ? (
                    <p className="py-6 text-center text-[0.9rem] text-muted">
                        No issues {DATE_RANGES.find((r) => r.key === range)?.empty}: every kiosk is up to date on tasks, stock counts, and waste rates.
                    </p>
                ) : (
                    <>
                        <div className="flex flex-col gap-2.5">
                            {issues.map((issue) => (
                                <IssueCard key={issue.id} issue={issue} />
                            ))}
                        </div>
                        {hasMore && (
                            <div className="mt-3.5 flex flex-col items-center gap-1">
                                <button
                                    type="button"
                                    onClick={onLoadMore}
                                    className="rounded-lg border border-line bg-card px-4 py-1.5 text-[0.8rem] font-semibold text-ink hover:border-accent/40 hover:text-accent"
                                >
                                    Load more
                                </button>
                                <span className="text-[0.72rem] text-muted">
                                    Showing {issues.length} of {counts.total}
                                </span>
                            </div>
                        )}
                    </>
                )}
            </SectionCard>
        </>
    );
}

function IssueCard({ issue }) {
    const high = issue.severity === "high";
    const Icon = CATEGORY_ICON[issue.category] || AlertTriangle;
    return (
        <div
            className={
                "rounded-card border-l-[3px] bg-card p-[0.9rem_1.1rem] shadow-elevate-1 " + (high ? "border-l-danger-ink" : "border-l-warn-ink")
            }
        >
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <span
                    className={
                        "inline-flex items-center gap-1.5 rounded-full px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold uppercase tracking-[0.03em] " +
                        (high ? "bg-danger-bg text-danger-ink" : "bg-warn-bg text-warn-ink")
                    }
                >
                    <Icon size={12} strokeWidth={2.5} />
                    {high ? "Needs attention" : "Worth a look"}
                </span>
                {issue.date && <span className="whitespace-nowrap text-[0.75rem] text-muted">{formatIssueDate(issue.date)}</span>}
            </div>

            <div className="mb-1.5 text-[0.95rem] font-semibold leading-snug text-ink">{issue.title}</div>

            <div className="flex items-center gap-1 border-t border-line pt-2 text-[0.78rem] text-muted">
                <Store size={12} strokeWidth={2} className="flex-shrink-0" />
                {issue.kioskName}
            </div>
        </div>
    );
}
