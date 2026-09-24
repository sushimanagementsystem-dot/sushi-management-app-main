"use client";

import { useState } from "react";
import {
    Trash2,
    Snowflake,
    UtensilsCrossed,
    Scale,
    Camera,
    FileText,
    LifeBuoy,
    ArrowLeftRight,
    ClipboardList,
    ClipboardCheck,
    Wrench,
    Check,
    X,
    Store,
    CheckCircle2,
    AlertTriangle,
    LayoutGrid,
} from "lucide-react";
import { moneyStr, qtyStr } from "@/lib/kpiUtils";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import RefreshButton from "@/components/dashboard/RefreshButton";
import PillButton from "@/components/dashboard/PillButton";
import { useBootstrap } from "@/lib/queries";

// Icon + short label for every form a kiosk can submit — reuses the exact
// icons the kiosk home menu's BtnCards already use for these same forms
// (see KioskHomeContent.js), so an icon here always means the same thing
// as it does on the kiosk side.
const TASK_META = {
    MORNING_WASTE: { label: "Morning Waste", Icon: Trash2 },
    FRIDGE_COUNT: { label: "Fridge Count", Icon: Snowflake },
    STAFF_FOOD: { label: "Staff Food", Icon: UtensilsCrossed },
    FOOD_WASTE: { label: "Food Waste", Icon: Scale },
    DAMAGED_PRODUCT: { label: "Damaged Product", Icon: Camera },
    DELIVERY_INVOICE: { label: "Delivery Invoice", Icon: FileText },
    HELP_ISSUE: { label: "Help / Issue", Icon: LifeBuoy },
    MOVE_STOCK: { label: "Move Stock", Icon: ArrowLeftRight },
    WEEKLY_STOCKTAKE: { label: "Weekly Stocktake", Icon: ClipboardList },
    MONTHLY_AUDIT: { label: "Monthly Audit", Icon: ClipboardCheck },
    AUDIT_CORRECTION: { label: "Audit Correction", Icon: Wrench },
};

// The picker's "every kiosk side by side" choice — not a real kiosk id.
const ALL_KIOSKS = "__all__";

/**
 * All Kiosk Submissions — see every form a kiosk submitted, every day, for
 * one kiosk or (All kiosks) for every kiosk side by side. Daily tasks
 * (Morning Waste, Fridge Count, Staff Food) are expected every single day,
 * so a missing one is flagged (muted icon + red badge, warm-tinted cell).
 * Every other form ("as needed" ones like Damaged Product or Help/Issue,
 * and scheduled ones like Weekly Stocktake/Monthly Audit) has no fixed
 * daily cadence — those only appear on a day's row when they actually
 * happened, no "missing" stigma for the days they didn't. "Day(s) with a
 * gap" and the completion % come from the backend's `summary` (daily tasks
 * only, finished days only). No date filter — always the backend's default
 * window (the last 14 days).
 */
export default function SubmissionsMonitorPage() {
    const [kioskId, setKioskId] = useState(ALL_KIOSKS);

    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_submissions_monitor", {});

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const kiosks = res?.kiosks || [];

    return (
        <>
            <PageTitle title="Dashboard — All Kiosk Submissions" />
            <DashboardShell activeKey="submissions">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="All Kiosk Submissions"
                        description="Every form each kiosk submitted, day by day — one kiosk or all of them at once — and which daily tasks are missing."
                        actions={<RefreshButton onRefetch={refetch} />}
                    />

                    {loading && (
                        <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                    )}
                    {error && <div className="text-danger-ink">{error}</div>}

                    {!loading && res && !error && (
                        <>
                            <KioskPicker kiosks={kiosks} value={kioskId} onChange={setKioskId} range={res.startDate + " – " + res.endDate} />

                            <SubmissionsTable res={res} kioskIds={kioskId === ALL_KIOSKS ? kiosks.map((k) => k.id) : [kioskId]} />
                        </>
                    )}
                </div>
            </DashboardShell>
        </>
    );
}

/** A small pill per kiosk (only 4 of them) reads as a picker at a glance,
 * the same "filled pill = selected" language KpiFilters and Data Tables'
 * own table-switcher already use elsewhere — a native <select> here would
 * be the only plain-dropdown control on the whole dashboard for a list
 * this short. */
function KioskPicker({ kiosks, value, onChange, range }) {
    return (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <PillButton active={value === ALL_KIOSKS} onClick={() => onChange(ALL_KIOSKS)} icon={LayoutGrid}>
                All kiosks
            </PillButton>
            {kiosks.map((k) => (
                <PillButton key={k.id} active={value === k.id} onClick={() => onChange(k.id)} icon={Store}>
                    {k.name}
                </PillButton>
            ))}
            <span className="ml-1 text-[0.78rem] text-muted">{range}</span>
        </div>
    );
}

function TaskChip({ task }) {
    const meta = TASK_META[task] || { label: task, Icon: Check };
    const Icon = meta.Icon;
    return (
        <span
            key={task}
            className="flex items-center gap-1.5 rounded-full border border-line bg-card px-[0.55rem] py-[0.2rem] text-[0.76rem] text-muted"
        >
            <Icon size={12} strokeWidth={2.25} />
            {meta.label}
        </span>
    );
}

function Legend({ dailyTasks, otherTasks }) {
    return (
        <div className="mb-4 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-ink">Daily</span>
                {dailyTasks.map((t) => (
                    <TaskChip key={t} task={t} />
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-ink">As needed / scheduled</span>
                {otherTasks.map((t) => (
                    <TaskChip key={t} task={t} />
                ))}
            </div>
        </div>
    );
}

/** Two headline numbers per kiosk — completion rate answers "is this kiosk
 * generally on top of its daily tasks," the gap count answers "how many days
 * actually need a follow-up." Both come from the backend's `summary`, which
 * counts the three DAILY tasks only, on finished days only (today is still
 * open), so the same rule holds for one kiosk or all of them. */
function SummaryStats({ res, kioskIds }) {
    const multi = kioskIds.length > 1;
    const nameOf = (id) => (res.kiosks || []).find((k) => k.id === id)?.name || id;

    return (
        <div className="mb-4 flex flex-wrap gap-3">
            {kioskIds.map((id) => {
                const s = res.summary?.[id];
                if (!s) return null;
                return (
                    <div key={id} className={multi ? "flex flex-col gap-1.5" : ""}>
                        {multi && <div className="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-ink">{nameOf(id)}</div>}
                        <div className="flex flex-wrap gap-2.5">
                            <div className="flex items-center gap-2 rounded-card border border-line bg-card px-4 py-2.5 shadow-elevate-1">
                                <CheckCircle2
                                    size={16}
                                    strokeWidth={2.25}
                                    className={s.completionPct >= 90 ? "text-success-ink" : s.completionPct >= 60 ? "text-warn-ink" : "text-danger-ink"}
                                />
                                <div>
                                    <div className="text-[1.1rem] font-semibold leading-tight tabular-nums text-ink">{s.completionPct}%</div>
                                    <div className="text-[0.72rem] text-muted">Daily tasks completed</div>
                                </div>
                            </div>
                            <div
                                className="flex items-center gap-2 rounded-card border border-line bg-card px-4 py-2.5 shadow-elevate-1"
                                title="A day counts as a gap when any of the daily tasks (Morning Waste, Fridge Count, Staff Food) was not submitted. Other forms never count, and today is left out until it is over."
                            >
                                <AlertTriangle size={16} strokeWidth={2.25} className={s.daysWithGap > 0 ? "text-warn-ink" : "text-success-ink"} />
                                <div>
                                    <div className="text-[1.1rem] font-semibold leading-tight tabular-nums text-ink">
                                        {s.daysWithGap}
                                        <span className="text-[0.72rem] font-normal text-muted"> of {s.daysCounted}</span>
                                    </div>
                                    <div className="text-[0.72rem] text-muted">Day(s) with a gap</div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function formatDayLabel(dateStr, todayStr, yesterdayStr) {
    if (dateStr === todayStr) return "Today";
    if (dateStr === yesterdayStr) return "Yesterday";
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function todayLocalStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// The two form types whose exact submitted lines are worth drilling into —
// see SubmissionsMonitorService's `detail` (who took what / which stock
// items were wasted). Every other form type stays a plain status icon;
// its full content already has its own dashboard page or review flow.
const DETAIL_TASKS = ["STAFF_FOOD", "FOOD_WASTE"];

/** Daily tasks always render (green if done, muted + red badge if not) —
 * they're expected every day, so their absence is itself the signal.
 * Everything else only renders when it actually happened that day, so a
 * quiet "as needed" day doesn't clutter the row with a wall of muted
 * icons for things nobody expected to see. Staff Food / Food Waste icons
 * become clickable buttons once they're done and detail lines exist for
 * them, opening SubmissionDetailModal instead of just showing a checkmark. */
function DayStatusCell({ status, dailyTasks, otherTasks, detail, onOpenDetail }) {
    const submittedOther = otherTasks.filter((t) => status[t]);

    const renderIcon = (t, tone) => {
        const meta = TASK_META[t] || { label: t, Icon: Check };
        const Icon = meta.Icon;
        const done = !!status[t];
        const lines = detail?.[t];
        const clickable = done && DETAIL_TASKS.includes(t) && lines?.length > 0;
        const className =
            "relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-none p-0 " +
            (done ? tone : "bg-line/50 text-muted/70") +
            (clickable ? " cursor-pointer ring-offset-1 hover:ring-2 hover:ring-accent/50" : "");
        const content = (
            <>
                <Icon size={13} strokeWidth={2.25} />
                {!done && <X size={10} strokeWidth={3} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-card text-danger-ink" />}
            </>
        );
        const title = meta.label + ": " + (done ? (clickable ? "submitted — click to see details" : "submitted") : "not submitted");
        return clickable ? (
            <button key={t} type="button" title={title} className={className} onClick={() => onOpenDetail(t, lines)}>
                {content}
            </button>
        ) : (
            <span key={t} title={title} className={className}>
                {content}
            </span>
        );
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {dailyTasks.map((t) => renderIcon(t, "bg-success-bg text-success-ink"))}
            {submittedOther.length > 0 && <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-line" aria-hidden />}
            {submittedOther.map((t) => renderIcon(t, "bg-teal-soft text-teal"))}
        </div>
    );
}

/** What was actually submitted for one Staff Food or Food Waste icon —
 * who took which product (Staff Food), or how many grams of which stock
 * item were thrown out and its cost if known (Food Waste, UNCOSTED shown
 * plainly rather than guessed — see FoodWasteProcessor). */
function SubmissionDetailModal({ dateLabel, formType, lines, onClose }) {
    const meta = TASK_META[formType] || { label: formType, Icon: Check };
    const Icon = meta.Icon;
    const isFoodWaste = formType === "FOOD_WASTE";

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end"
            onClick={onClose}
        >
            <div
                className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-card bg-card p-[1.4rem] shadow-elevate-3 max-[720px]:w-full max-[720px]:max-w-full max-[720px]:max-h-[88vh] max-[720px]:rounded-b-none max-[720px]:rounded-t-[1.2rem] max-[720px]:p-[1.1rem]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-3 flex items-center gap-2">
                    <Icon size={16} strokeWidth={2.25} className="text-ink" />
                    <h3 className="m-0 text-[1.05rem] font-bold tracking-[-0.01em] text-ink">{meta.label}</h3>
                    <span className="text-[0.85rem] text-muted">— {dateLabel}</span>
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {lines.map((ln, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2 text-[0.88rem]">
                            {isFoodWaste ? (
                                <>
                                    <span className="text-ink">{ln.item}</span>
                                    <span className="whitespace-nowrap tabular-nums text-muted">
                                        {qtyStr(ln.grams)}g{ln.cost !== null ? " · " + moneyStr(ln.cost) : " · uncosted"}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="text-ink">{ln.who}</span>
                                    <span className="text-muted">{ln.product}</span>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-4 w-full rounded-lg border-none bg-line px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink"
                >
                    Close
                </button>
            </div>
        </div>
    );
}

/** One row per day. One kiosk → a single "Submissions" column; all kiosks →
 * a column per kiosk, so a day reads left to right as "what each kiosk did". */
function SubmissionsTable({ res, kioskIds }) {
    const allTasks = res.tasks || [];
    const dailyTasks = res.dailyTasks || [];
    const otherTasks = allTasks.filter((t) => !dailyTasks.includes(t));
    const days = res.days || [];
    const todayStr = todayLocalStr();
    const yesterdayD = new Date();
    yesterdayD.setDate(yesterdayD.getDate() - 1);
    const yesterdayStr =
        yesterdayD.getFullYear() + "-" + String(yesterdayD.getMonth() + 1).padStart(2, "0") + "-" + String(yesterdayD.getDate()).padStart(2, "0");
    const multi = kioskIds.length > 1;
    const nameOf = (id) => (res.kiosks || []).find((k) => k.id === id)?.name || id;
    const [openDetail, setOpenDetail] = useState(null); // { dateLabel, formType, lines } | null

    if (!days.length) return <p className="text-muted">No days in this range.</p>;

    const thCls = "border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted";

    return (
        <>
            <SummaryStats res={res} kioskIds={kioskIds} />
            <SectionCard title={(multi ? "All kiosks" : nameOf(kioskIds[0])) + " — submissions by day"} className="mb-0">
                <Legend dailyTasks={dailyTasks} otherTasks={otherTasks} />
                <div className="overflow-hidden rounded-lg border border-line">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse bg-card text-[0.85rem]">
                            <thead>
                                <tr>
                                    <th className={"whitespace-nowrap " + thCls}>Date</th>
                                    {kioskIds.map((id) => (
                                        <th key={id} className={(multi ? "whitespace-nowrap " : "w-full ") + thCls}>
                                            {multi ? nameOf(id) : "Submissions"}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {days.map((day) => {
                                    const dateLabel = formatDayLabel(day.date, todayStr, yesterdayStr);
                                    return (
                                        <tr key={day.date} className="transition-colors duration-100 hover:bg-panel/70">
                                            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 font-medium text-ink">{dateLabel}</td>
                                            {kioskIds.map((id) => {
                                                const status = day.kiosks[id] || {};
                                                const anyMissing = dailyTasks.some((t) => !status[t]);
                                                return (
                                                    <td key={id} className={"border-b border-line px-[0.9rem] py-2.5 " + (anyMissing ? "bg-warn-bg/40" : "")}>
                                                        <DayStatusCell
                                                            status={status}
                                                            dailyTasks={dailyTasks}
                                                            otherTasks={otherTasks}
                                                            detail={day.detail?.[id]}
                                                            onOpenDetail={(formType, lines) => setOpenDetail({ dateLabel: (multi ? nameOf(id) + ", " : "") + dateLabel, formType, lines })}
                                                        />
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </SectionCard>

            {openDetail && (
                <SubmissionDetailModal
                    dateLabel={openDetail.dateLabel}
                    formType={openDetail.formType}
                    lines={openDetail.lines}
                    onClose={() => setOpenDetail(null)}
                />
            )}
        </>
    );
}
