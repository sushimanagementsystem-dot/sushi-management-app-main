"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
    FileText,
    PackageX,
    LifeBuoy,
    ClipboardCheck,
    Wrench,
    ArrowLeftRight,
    ClipboardList,
    ShoppingCart,
    CircleHelp,
    Store,
    CalendarDays,
    ArrowRight,
    AlertTriangle,
} from "lucide-react";
import { apiCall } from "@/lib/api";
import { useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import RefreshButton from "@/components/dashboard/RefreshButton";
import DashSelect from "@/components/dashboard/DashSelect";
import EvidencePreview from "@/components/dashboard/EvidencePreview";
import { confirmModal, noticeModal } from "@/components/ConfirmModal";
import SearchPick from "@/components/SearchPick";

// Every category value the backend recognizes today — including ones not
// wired to any form yet. Harmless to list before its category's
// owner_action rows exist; the filter just never matches anything until
// then.
const INBOX_CATEGORIES = [
    "INVOICE_REVIEW", "DAMAGE_REVIEW", "HELP_ISSUE", "AUDIT_REVIEW",
    "AUDIT_CORRECTION_REVIEW", "TRANSFER_APPROVAL", "TRANSFER_APPLY",
    "STOCKTAKE_REVIEW", "PURCHASING_RECOMMENDATION", "OTHER",
];

// Plain-language label + icon + "what to do about it" copy per category —
// the raw enum values (TRANSFER_APPROVAL vs TRANSFER_APPLY, etc.) stay the
// actual filter/API values everywhere else; this is display-only, so an
// owner scanning the list sees "Stock Transfer — Approve or decline the
// transfer" instead of decoding an enum name themselves.
const CATEGORY_META = {
    INVOICE_REVIEW: { label: "Delivery Invoice", Icon: FileText, action: "Review and confirm the invoice lines" },
    DAMAGE_REVIEW: { label: "Damaged Product", Icon: PackageX, action: "Review the damage report" },
    HELP_ISSUE: { label: "Help / Issue", Icon: LifeBuoy, action: "Respond to this request" },
    AUDIT_REVIEW: { label: "Monthly Audit", Icon: ClipboardCheck, action: "Review the audit findings" },
    AUDIT_CORRECTION_REVIEW: { label: "Audit Correction", Icon: Wrench, action: "Review the submitted correction" },
    TRANSFER_APPROVAL: {
        label: "Stock Transfer",
        filterLabel: "Stock Transfer — Approval",
        Icon: ArrowLeftRight,
        action: "Approve or decline the transfer",
    },
    TRANSFER_APPLY: { label: "Stock Transfer", filterLabel: "Stock Transfer — Apply", Icon: ArrowLeftRight, action: "Apply the approved transfer" },
    STOCKTAKE_REVIEW: { label: "Stocktake", Icon: ClipboardList, action: "Confirm or decline the stocktake" },
    PURCHASING_RECOMMENDATION: { label: "Purchasing", Icon: ShoppingCart, action: "Review the purchasing recommendation" },
    OTHER: { label: "Other", Icon: CircleHelp, action: "Review this item" },
};
function categoryMeta(category) {
    return CATEGORY_META[category] || { label: humanize(category), Icon: CircleHelp, action: "Review this item" };
}
const INBOX_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_OWNER", "RESOLVED", "CLOSED", "NOT_PROCEEDING"];
const INBOX_PRIORITIES = ["LOW", "NORMAL", "URGENT"];

const REQUEST_STATUSES = ["NEW", "IN_PROGRESS", "WAITING_FOR_KIOSK", "WAITING_FOR_OWNER", "RESOLVED", "CLOSED", "NOT_PROCEEDING"];
const REQUEST_PRIORITIES = ["", "LOW", "NORMAL", "URGENT"];

// max-[720px]:min-h-[2.75rem] gives every button a real ~44px touch target
// on mobile (WCAG 2.5.5 / iOS HIG minimum) — the desktop padding alone
// doesn't reach that.
const DASH_BTN =
    "rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink shadow-elevate-1 hover:bg-accent/90 hover:shadow-elevate-2 active:scale-[0.97] disabled:opacity-50 max-[720px]:min-h-[2.75rem]";
const DASH_BTN_SECONDARY =
    "rounded-lg border-none bg-line px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink hover:bg-[#ddd7c8] active:scale-[0.97] disabled:opacity-50 max-[720px]:min-h-[2.75rem]";

// Below 720px the detail modal becomes a bottom sheet (full width,
// anchored to the bottom edge) instead of a small floating card — same
// pattern as DataTablesController.js's row-detail modal and
// ConfirmModal.js, applied consistently across the dashboard.
const MODAL_OVERLAY =
    "fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end";
const MODAL_BOX =
    "max-h-[calc(100vh-4rem)] w-[60rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card bg-card p-[1.4rem] shadow-elevate-3 " +
    "max-[720px]:w-full max-[720px]:max-w-full max-[720px]:max-h-[88vh] max-[720px]:rounded-b-none max-[720px]:rounded-t-[1.2rem] max-[720px]:p-[1.1rem]";
// Field-value pairs stack one per row on mobile instead of relying on
// wrap-once-too-narrow — explicit, not incidental.
const FIELD_GRID_ITEM = "mb-[0.8rem] min-w-[12rem] flex-1 max-[720px]:flex-[1_1_100%]";

function idFromPath() {
    if (typeof window === "undefined") return "";
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[2] || "";
}

const PAGE_SIZE = 25;

// When the action was created. "All time" (empty key) applies no date condition at all.
const DATE_RANGES = [
    { key: "", label: "All time" },
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "This week" },
    { key: "last7", label: "Last 7 days" },
    { key: "month", label: "This month" },
    { key: "last30", label: "Last 30 days" },
];

/** A preset -> the created_at window sent to the backend, as ISO instants. Built from the VIEWER'S
 * calendar day (local midnight), so "Today" means the owner's today, not the server's UTC day. The
 * week starts on Monday, matching every other weekly view on the dashboard. */
function rangeToWindow(key) {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const daysAgo = (n) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - n);
    switch (key) {
        case "today":
            return { createdFrom: midnight.toISOString() };
        case "yesterday":
            return { createdFrom: daysAgo(1).toISOString(), createdTo: midnight.toISOString() };
        case "week":
            return { createdFrom: daysAgo((midnight.getDay() + 6) % 7).toISOString() };
        case "last7":
            return { createdFrom: daysAgo(6).toISOString() };
        case "month":
            return { createdFrom: new Date(midnight.getFullYear(), midnight.getMonth(), 1).toISOString() };
        case "last30":
            return { createdFrom: daysAgo(29).toISOString() };
        default:
            return {};
    }
}

/** Reads status/category/priority/kiosk_id/includeClosed/page straight off
 * the current URL's query string — the source of truth for filter state on
 * mount, so a refresh (or a shared/bookmarked link) lands back where the
 * owner left it instead of resetting to "Any status" on page 1. */
function filtersFromQuery() {
    if (typeof window === "undefined") return { status: "", category: "", priority: "", kiosk_id: "", includeClosed: false, range: "" };
    const q = new URLSearchParams(window.location.search);
    return {
        range: DATE_RANGES.some((r) => r.key && r.key === q.get("range")) ? q.get("range") : "",
        status: q.get("status") || "",
        category: q.get("category") || "",
        priority: q.get("priority") || "",
        kiosk_id: q.get("kiosk_id") || "",
        includeClosed: q.get("includeClosed") === "1",
    };
}

function pageFromQuery() {
    if (typeof window === "undefined") return 1;
    const n = Number(new URLSearchParams(window.location.search).get("page"));
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Mirrors filters+page into the URL (replaceState — this is filter/page
 * state, not a new navigable location) so they survive a refresh. Leaves
 * the path (including an open card's /:id segment) untouched. */
function writeFiltersToQuery(filters, page) {
    const q = new URLSearchParams();
    if (filters.status) q.set("status", filters.status);
    if (filters.category) q.set("category", filters.category);
    if (filters.priority) q.set("priority", filters.priority);
    if (filters.kiosk_id) q.set("kiosk_id", filters.kiosk_id);
    if (filters.includeClosed) q.set("includeClosed", "1");
    if (filters.range) q.set("range", filters.range);
    if (page > 1) q.set("page", String(page));
    const qs = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
}

/** Runs a list of no-arg task functions (each returning Promise<{ok,
 * error}>) one after another, stopping at the first failure. Used to batch
 * several apiCalls behind one Save click without them racing each other. */
function runSequential(tasks) {
    let p = Promise.resolve({ ok: true });
    tasks.forEach((task) => {
        p = p.then((prev) => (prev && prev.ok === false ? prev : task()));
    });
    return p;
}

// DrivePreview -> shared EvidencePreview (components/dashboard/EvidencePreview.js).
// Kept as a local alias since every call site in this file already says
// DrivePreview and there's no value in a mechanical rename pass.
const DrivePreview = EvidencePreview;

export default function InboxPage() {
    return (
        <>
            <PageTitle title="Dashboard — Action Inbox" />
            <DashboardShell activeKey="inbox">
                <InboxBody />
            </DashboardShell>
        </>
    );
}

function InboxBody() {
    const queryClient = useQueryClient();
    const [filters, setFilters] = useState(filtersFromQuery);
    const [page, setPage] = useState(pageFromQuery);
    const [activeId, setActiveId] = useState(null);

    // Filtering, sorting, and pagination all happen server-side now (see
    // ActionInboxService.bootstrap) — this call's params ARE the query,
    // not a client-side post-filter, so changing any of them must produce
    // a new React Query key to actually refetch.
    const bootstrapParams = useMemo(
        () => ({
            status: filters.status || undefined,
            category: filters.category || undefined,
            priority: filters.priority || undefined,
            kioskId: filters.kiosk_id || undefined,
            includeClosed: filters.includeClosed || undefined,
            ...rangeToWindow(filters.range),
            page,
            pageSize: PAGE_SIZE,
        }),
        [filters, page],
    );
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_action_inbox", bootstrapParams);

    // Keep the URL's query string in lockstep with filters/page — a
    // refresh (or a shared link) reopens exactly this view instead of
    // resetting to "Any status", page 1.
    useEffect(() => {
        writeFiltersToQuery(filters, page);
    }, [filters, page]);

    useEffect(() => {
        const initial = idFromPath();
        if (initial) setActiveId(initial);
        function onPop() {
            setActiveId(idFromPath() || null);
        }
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    const usersById = useMemo(() => {
        const m = {};
        (res?.users || []).forEach((u) => (m[u.id] = u));
        return m;
    }, [res]);

    function changeFilters(updater) {
        setFilters(updater);
        setPage(1);
    }

    const totalRows = res?.ok ? res.totalRows ?? 0 : 0;
    const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

    function openCard(id) {
        setActiveId(id);
        window.history.pushState(null, "", "/dashboard/inbox/" + id + window.location.search);
    }

    function closeModal() {
        setActiveId(null);
        window.history.replaceState(null, "", "/dashboard/inbox" + window.location.search);
        refetch();
    }

    function refreshAfterAction(ownerActionId) {
        refetch();
        if (ownerActionId) queryClient.invalidateQueries({ queryKey: ["get_action_detail", { ownerActionId }] });
    }

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <PageHeader
                title="Action Inbox"
                description="Transfers, invoice reviews, audit findings and requests waiting on you."
                actions={
                    <>
                        <DraftOrdersButton onDone={refetch} />
                        <RefreshButton onRefetch={refetch} />
                    </>
                }
            >
                <InboxFilters kiosks={res?.ok ? res.kiosks || [] : []} filters={filters} onChange={changeFilters} />
                <CountsRow counts={res?.ok ? res.counts : null} />
            </PageHeader>

            {loading && (
                <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
            )}
            {error && <div className="text-danger-ink">{error}</div>}

            {!loading && res?.ok && (
                <SectionCard title="Open actions" className="mb-0">
                    <CardList rows={res.rows || []} onOpen={openCard} />
                    {totalRows > PAGE_SIZE && (
                        <div className="mt-3">
                            <Pager page={page} pageCount={pageCount} total={totalRows} pageSize={PAGE_SIZE} onChange={setPage} />
                        </div>
                    )}
                </SectionCard>
            )}

            {activeId && (
                <DetailModal
                    ownerActionId={activeId}
                    kiosks={res?.ok ? res.kiosks || [] : []}
                    stockItems={res?.ok ? res.stockItems || [] : []}
                    usersById={usersById}
                    onClose={closeModal}
                    onChanged={refreshAfterAction}
                />
            )}
        </div>
    );
}

/** Runs the ordering scan now: builds each supplier's order from the latest stocktakes and par levels and emails it to the owner to review. */
function DraftOrdersButton({ onDone }) {
    const [busy, setBusy] = useState(false);
    async function run() {
        const ok = await confirmModal("Draft the supplier orders now? Each order is built from the latest confirmed stocktakes and the par levels, and emailed to you to review. Nothing is sent to a supplier.", "Draft orders");
        if (!ok) return;
        setBusy(true);
        try {
            const res = await apiCall("run_purchasing_scan", {});
            if (!res?.ok) throw new Error(res?.error || "Could not draft the orders.");
            const failed = res.emailFailed ? ` ${res.emailFailed} could not be emailed: see the purchasing card for the reason.` : "";
            const skipped = res.skipped ? ` ${res.skipped} supplier(s) already had an open order from the last day.` : "";
            await noticeModal(res.created ? `${res.emailed} order email(s) sent to you.${failed}${skipped}` : `Nothing to order right now.${skipped}`, "Orders drafted");
            onDone();
        } catch (e) {
            await noticeModal(e.message || "Could not draft the orders.", "Orders");
        } finally {
            setBusy(false);
        }
    }
    return (
        <button type="button" onClick={run} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[0.78rem] font-semibold text-ink hover:border-accent/40 disabled:opacity-60">
            <ShoppingCart size={15} strokeWidth={2.25} />
            {busy ? "Drafting…" : "Draft orders"}
        </button>
    );
}

function InboxFilters({ kiosks, filters, onChange }) {
    return (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <DashSelect value={filters.range} onChange={(e) => onChange((f) => ({ ...f, range: e.target.value }))}>
                {DATE_RANGES.map((r) => (
                    <option key={r.key} value={r.key}>
                        {r.label}
                    </option>
                ))}
            </DashSelect>
            <DashSelect value={filters.status} onChange={(e) => onChange((f) => ({ ...f, status: e.target.value }))}>
                <option value="">Any status</option>
                {INBOX_STATUSES.map((s) => (
                    <option key={s} value={s}>
                        {s}
                    </option>
                ))}
            </DashSelect>
            <DashSelect value={filters.category} onChange={(e) => onChange((f) => ({ ...f, category: e.target.value }))}>
                <option value="">Any category</option>
                {INBOX_CATEGORIES.map((c) => {
                    const meta = categoryMeta(c);
                    return (
                        <option key={c} value={c}>
                            {meta.filterLabel || meta.label}
                        </option>
                    );
                })}
            </DashSelect>
            <DashSelect value={filters.priority} onChange={(e) => onChange((f) => ({ ...f, priority: e.target.value }))}>
                <option value="">Any priority</option>
                {INBOX_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                        {p}
                    </option>
                ))}
            </DashSelect>
            <DashSelect value={filters.kiosk_id} onChange={(e) => onChange((f) => ({ ...f, kiosk_id: e.target.value }))}>
                <option value="">Any kiosk</option>
                {kiosks.map((k) => (
                    <option key={k.id} value={k.id}>
                        {k.name}
                    </option>
                ))}
            </DashSelect>
            <label className="flex items-center gap-[0.3rem] text-[0.78rem] text-muted">
                <input
                    type="checkbox"
                    checked={filters.includeClosed}
                    onChange={(e) => onChange((f) => ({ ...f, includeClosed: e.target.checked }))}
                />
                Show closed
            </label>
        </div>
    );
}

/** Display-only formatting — turns SCREAMING_SNAKE enum values into "Title
 * Case" for readability. Every filter/apiCall payload still uses the raw
 * enum string; this never touches those, only what's rendered. */
function humanize(value) {
    return String(value || "")
        .toLowerCase()
        .split("_")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ");
}

/** created_at/due_date arrive as ISO timestamps from the API — shown raw
 * that reads as "18:2026-08-17T07:28:13.000Z", not "clean." This is
 * display-only; every filter/apiCall payload still uses the raw ISO
 * string. Rendered client-side only (data always arrives via useBootstrap,
 * never present in the server-rendered shell), so there's no SSR/client
 * locale mismatch risk. */
function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const OPEN_ISH_STATUSES = new Set(["OPEN", "IN_PROGRESS", "WAITING_FOR_OWNER"]);

function isOverdue(row) {
    if (!row.due_date || !OPEN_ISH_STATUSES.has(row.status)) return false;
    return new Date(row.due_date).getTime() < Date.now();
}

/** Urgent count leads the row, in its own high-contrast pill, ahead of the
 * neutral per-status counts — "which of these numbers means trouble" is
 * exactly what shouldn't require reading every chip. */
function CountsRow({ counts }) {
    if (!counts) return null;
    const byStatus = counts.byStatus || {};
    const keys = Object.keys(byStatus);
    const urgentOpen = counts.urgentOpen || 0;
    if (!keys.length && !urgentOpen) return null;
    return (
        <div className="mb-4 flex flex-wrap items-center gap-[0.4rem]">
            {urgentOpen > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-[0.65rem] py-[0.2rem] text-[0.78rem] font-semibold text-danger-ink">
                    <AlertTriangle size={13} strokeWidth={2.25} />
                    {urgentOpen} urgent — needs attention
                </span>
            )}
            {keys.map((s) => (
                <span key={s} className="rounded-full border border-line bg-card px-[0.65rem] py-[0.2rem] text-[0.78rem] text-muted">
                    {humanize(s)} <span className="font-semibold text-ink">{byStatus[s]}</span>
                </span>
            ))}
        </div>
    );
}

/** Priority/overdue are the two signals worth a real color badge — they
 * need to jump out at a glance. NORMAL priority (the majority case) is
 * left unbadged so the list doesn't turn into a wall of colored chips. */
function PriorityBadge({ priority }) {
    const p = (priority || "NORMAL").toUpperCase();
    if (p === "URGENT") {
        return (
            <span className="inline-flex items-center rounded-full bg-danger-bg px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold uppercase tracking-[0.03em] text-danger-ink">
                Urgent
            </span>
        );
    }
    if (p === "LOW") {
        return <span className="text-[0.72rem] font-medium uppercase tracking-[0.03em] text-muted">Low</span>;
    }
    return null;
}

function OverdueBadge() {
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold uppercase tracking-[0.03em] text-warn-ink">
            <AlertTriangle size={11} strokeWidth={2.5} />
            Overdue
        </span>
    );
}

/**
 * Each card answers, in reading order: what kind of thing is this (icon +
 * category), how urgent (badges), what happened (title), what to actually
 * do about it (action line), and where/when (kiosk + date footer) — the
 * exact set the redesign asked for, ordered by what an owner needs first
 * rather than by which fields happened to exist on the row.
 */
function CardList({ rows, onOpen }) {
    if (!rows.length) return <p className="py-6 text-center text-[0.9rem] text-muted">Nothing here — you&apos;re all caught up.</p>;
    return (
        <div className="flex flex-col gap-2.5">
            {rows.map((r) => {
                const priority = (r.priority || "NORMAL").toUpperCase();
                const overdue = isOverdue(r);
                const meta = categoryMeta(r.category);
                const CategoryIcon = meta.Icon;
                const borderClass =
                    priority === "URGENT" ? "border-l-danger-ink" : overdue ? "border-l-warn-ink" : priority === "LOW" ? "border-l-line" : "border-l-accent";
                return (
                    <div
                        key={r.owner_action_id}
                        onClick={() => onOpen(r.owner_action_id)}
                        className={
                            "group cursor-pointer rounded-card border-l-[3px] bg-card p-[0.9rem_1.1rem] shadow-elevate-1 transition-all duration-150 hover:-translate-y-px hover:shadow-elevate-2 " +
                            borderClass
                        }
                    >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                <CategoryIcon size={13} strokeWidth={2.25} className="flex-shrink-0" />
                                {meta.label}
                            </span>
                            <span className="flex flex-shrink-0 items-center gap-1.5">
                                {overdue && <OverdueBadge />}
                                <PriorityBadge priority={r.priority} />
                            </span>
                        </div>

                        <div className="mb-1.5 text-[0.95rem] font-semibold leading-snug text-ink">{r.title || ""}</div>

                        <div className="mb-2 flex items-center gap-1.5 text-[0.82rem] font-medium text-accent">
                            <ArrowRight size={13} strokeWidth={2.25} className="flex-shrink-0" />
                            {meta.action}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[0.78rem] text-muted">
                            <span className="flex items-center gap-1">
                                <Store size={12} strokeWidth={2} className="flex-shrink-0" />
                                {r.kioskName || "—"}
                            </span>
                            <span className="flex items-center gap-1">
                                <CalendarDays size={12} strokeWidth={2} className="flex-shrink-0" />
                                {formatDate(r.created_at)}
                            </span>
                            <span className="ml-auto">{humanize(r.status)}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function Pager({ page, pageCount, total, pageSize, onChange }) {
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    return (
        <div className="mt-3 flex items-center justify-center gap-3 text-[0.85rem] text-muted">
            <button type="button" disabled={page <= 1} className={DASH_BTN_SECONDARY} onClick={() => onChange(page - 1)}>
                Prev
            </button>
            <span>
                {from}–{to} of {total}
            </span>
            <button type="button" disabled={page >= pageCount} className={DASH_BTN_SECONDARY} onClick={() => onChange(page + 1)}>
                Next
            </button>
        </div>
    );
}

// --- Detail modal ------------------------------------------------------

function DetailModal({ ownerActionId, kiosks, stockItems, usersById, onClose, onChanged }) {
    // Self-sufficient — get_action_detail returns the action's own fields
    // plus activity/category detail in one call, so this never needs the
    // row to already be present in whatever page/filter the list last
    // loaded (with real server-side pagination it very often won't be:
    // this is the only reliable way to open a deep link, or a card just
    // acted on, regardless of its position in the list).
    const { data: detail, isPending: loading, error: detailError } = useBootstrap(
        "get_action_detail",
        ownerActionId ? { ownerActionId } : null,
    );

    useEffect(() => {
        if (detail && detail.ok === false) {
            noticeModal(detail.error || "Failed to load action.");
            onClose();
        } else if (detailError) {
            noticeModal("Failed to load action.");
            onClose();
        }
    }, [detail, detailError]); // eslint-disable-line react-hooks/exhaustive-deps

    if (loading || !detail || detail.ok === false) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,24,30,0.45)]">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
            </div>
        );
    }

    const row = detail;

    function changed() {
        onChanged(ownerActionId);
    }

    return (
        <div className={MODAL_OVERLAY}>
            <div className={MODAL_BOX}>
                <h3 className="mb-4 text-lg font-bold tracking-[-0.01em]">
                    {row.category} — {row.kioskName || ""}
                </h3>

                <TriageEditor row={row} ownerActionId={ownerActionId} onSaved={changed} />

                <div className="mt-6">
                    <CategorySection row={row} kiosks={kiosks} stockItems={stockItems} onChanged={changed} />
                </div>

                {(row.activity || []).length > 0 && (
                    <div className="mt-6">
                        <h4 className="mb-[0.6rem] font-semibold">History</h4>
                        {row.activity.map((a, i) => (
                            <div key={i} className="border-b border-line py-[0.2rem] text-[0.8rem] text-muted">
                                {a.changed_at} — {resolveChangedBy(usersById, a.changed_by)}: {a.field_changed} &quot;{String(a.old_value)}&quot; →
                                &quot;{String(a.new_value)}&quot;{a.note ? " (" + a.note + ")" : ""}
                            </div>
                        ))}
                    </div>
                )}

                <button type="button" className={DASH_BTN + " mt-4"} onClick={onClose}>
                    Close
                </button>
            </div>
        </div>
    );
}

// user_id -> name resolution for activity_log's changed_by (a user_id
// reference, never a plain name; see database_schema.md).
function resolveChangedBy(usersById, changedBy) {
    if (changedBy === "system") return "System";
    const u = usersById[changedBy];
    return u ? u.name : changedBy;
}

// --- Shared field builders / read-only view grid ------------------------

function ViewFields({ pairs }) {
    return (
        <div className="flex flex-wrap gap-x-6 gap-y-[0.2rem]">
            {pairs.map(([label, value]) => (
                <div key={label} className={FIELD_GRID_ITEM}>
                    <label className="mb-[0.25rem] block text-[0.85rem] text-muted">{label}</label>
                    <div>{value || "—"}</div>
                </div>
            ))}
        </div>
    );
}

function FieldSelect({ label, value, options, onChange }) {
    return (
        <div className={FIELD_GRID_ITEM}>
            <label className="mb-[0.25rem] block text-[0.85rem] text-muted">{label}</label>
            <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
                {options.map((o) => (
                    <option key={o} value={o}>
                        {o || "—"}
                    </option>
                ))}
            </select>
        </div>
    );
}

function FieldText({ label, value, onChange }) {
    return (
        <div className={FIELD_GRID_ITEM}>
            <label className="mb-[0.25rem] block text-[0.85rem] text-muted">{label}</label>
            <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </div>
    );
}

function FieldDate({ label, value, onChange }) {
    return (
        <div className={FIELD_GRID_ITEM}>
            <label className="mb-[0.25rem] block text-[0.85rem] text-muted">{label}</label>
            <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </div>
    );
}

// --- Triage editor (status/priority/assigned/note/due — every category) --

function TriageEditor({ row, ownerActionId, onSaved }) {
    const [editMode, setEditMode] = useState(false);
    const [fields, setFields] = useState(null);
    const [saving, setSaving] = useState(false);

    function startEdit() {
        setFields({
            status: row.status || "",
            priority: row.priority || "",
            assigned_to: row.assigned_to || "",
            owner_note: row.owner_note || "",
            due_date: row.due_date || "",
        });
        setEditMode(true);
    }

    function save() {
        setSaving(true);
        apiCall("update_owner_action", { ownerActionId, changes: fields })
            .then((res) => {
                setSaving(false);
                if (!res.ok) {
                    noticeModal(res.error || "Save failed.");
                    return;
                }
                setEditMode(false);
                onSaved();
            })
            .catch(() => {
                setSaving(false);
                noticeModal("Save failed.");
            });
    }

    if (!editMode) {
        return (
            <div>
                <ViewFields
                    pairs={[
                        ["Status", row.status],
                        ["Priority", row.priority],
                        ["Assigned to", row.assigned_to],
                        ["Owner note", row.owner_note],
                        ["Due date", row.due_date],
                    ]}
                />
                <button type="button" className={DASH_BTN} onClick={startEdit}>
                    Edit
                </button>
            </div>
        );
    }

    return (
        <div>
            <div className="flex flex-wrap gap-x-6">
                <FieldSelect label="Status" value={fields.status} options={INBOX_STATUSES} onChange={(v) => setFields((f) => ({ ...f, status: v }))} />
                <FieldSelect
                    label="Priority"
                    value={fields.priority}
                    options={INBOX_PRIORITIES}
                    onChange={(v) => setFields((f) => ({ ...f, priority: v }))}
                />
                <FieldText label="Assigned to" value={fields.assigned_to} onChange={(v) => setFields((f) => ({ ...f, assigned_to: v }))} />
                <FieldText label="Owner note" value={fields.owner_note} onChange={(v) => setFields((f) => ({ ...f, owner_note: v }))} />
                <FieldDate label="Due date" value={fields.due_date} onChange={(v) => setFields((f) => ({ ...f, due_date: v }))} />
            </div>
            <div className="mt-2 flex justify-end gap-[0.6rem]">
                <button type="button" disabled={saving} className={DASH_BTN_SECONDARY} onClick={() => setEditMode(false)}>
                    Cancel
                </button>
                <button type="button" disabled={saving} className={DASH_BTN} onClick={save}>
                    Save
                </button>
            </div>
        </div>
    );
}

// --- Category-specific sections ------------------------------------------

function CategorySection({ row, kiosks, stockItems, onChanged }) {
    switch (row.category) {
        case "HELP_ISSUE":
            return <HelpIssueSection row={row} onChanged={onChanged} />;
        case "STOCKTAKE_REVIEW":
            return <StocktakeSection row={row} stockItems={stockItems} onChanged={onChanged} />;
        case "TRANSFER_APPROVAL":
        case "TRANSFER_APPLY":
            return <TransferSection row={row} kiosks={kiosks} onChanged={onChanged} />;
        case "INVOICE_REVIEW":
            return <InvoiceSection row={row} stockItems={stockItems} onChanged={onChanged} />;
        case "AUDIT_REVIEW":
            return <AuditReviewSection row={row} onChanged={onChanged} />;
        case "AUDIT_CORRECTION_REVIEW":
            return <AuditCorrectionSection row={row} onChanged={onChanged} />;
        case "DAMAGE_REVIEW":
            return <DamageSection row={row} onChanged={onChanged} />;
        case "PURCHASING_RECOMMENDATION":
            return <PurchasingRecommendationSection row={row} onChanged={onChanged} />;
        default:
            return <p className="text-muted">No category-specific detail yet for this type.</p>;
    }
}

function kioskName(kiosks, kioskId) {
    const k = kiosks.find((k) => k.id === kioskId);
    return k ? k.name : kioskId || "—";
}

function stockItemName(stockItems, stockItemId) {
    const it = stockItems.find((i) => i.id === stockItemId);
    return it ? it.name : stockItemId || "—";
}

function KioskPicker({ kiosks, value, onChange }) {
    return (
        <SearchPick
            value={value ? kioskName(kiosks, value) : ""}
            placeholder="Kiosk…"
            getItems={(q) => kiosks.filter((k) => k.name.toLowerCase().includes(q)).map((k) => ({ id: k.id, label: k.name }))}
            onSelect={(item) => onChange(item.id)}
        />
    );
}

function StockItemPicker({ stockItems, value, onChange }) {
    return (
        <SearchPick
            value={value ? stockItemName(stockItems, value) : ""}
            placeholder="Stock item…"
            getItems={(q) => stockItems.filter((it) => it.name.toLowerCase().includes(q)).map((it) => ({ id: it.id, label: it.name }))}
            onSelect={(item) => onChange(item.id)}
        />
    );
}

function RequestTableWrap({ children }) {
    return <div className="max-h-[18rem] overflow-x-auto overflow-y-auto">{children}</div>;
}

const TH = "sticky top-0 border-b border-line bg-card px-2 py-[0.3rem] text-left font-semibold text-muted";
const TD = "border-b border-line px-2 py-[0.3rem] align-middle";

// --- Help / Issue ---------------------------------------------------------

function HelpIssueSection({ row, onChanged }) {
    const req = row.request;
    const [editMode, setEditMode] = useState(false);
    const [fields, setFields] = useState(null);
    const [saving, setSaving] = useState(false);

    if (!req) return <p className="text-muted">Linked request not found.</p>;

    function startEdit() {
        setFields({
            owner_status: req.owner_status || "",
            owner_priority: req.owner_priority || "",
            assigned_to: req.assigned_to || "",
            due_date: req.due_date || "",
            owner_note: req.owner_note || "",
            resolution_note: req.resolution_note || "",
        });
        setEditMode(true);
    }

    function save() {
        setSaving(true);
        apiCall("update_request", { requestId: req.request_id, changes: fields, ownerActionId: row.owner_action_id })
            .then((res) => {
                setSaving(false);
                if (!res.ok) {
                    noticeModal(res.error || "Save failed.");
                    return;
                }
                setEditMode(false);
                onChanged();
            })
            .catch(() => {
                setSaving(false);
                noticeModal("Save failed.");
            });
    }

    return (
        <div>
            <h4 className="mb-1 font-semibold">Request: {req.title}</h4>
            <p className="mb-2 text-muted">
                {req.request_type} — {req.details}
            </p>
            {req.photo_reference && <DrivePreview url={req.photo_reference} label="Photo/video" />}

            {!editMode ? (
                <div>
                    <ViewFields
                        pairs={[
                            ["Status", req.owner_status],
                            ["Priority", req.owner_priority],
                            ["Assigned to", req.assigned_to],
                            ["Due date", req.due_date],
                            ["Owner note", req.owner_note],
                            ["Resolution note", req.resolution_note],
                        ]}
                    />
                    <button type="button" className={DASH_BTN} onClick={startEdit}>
                        Edit
                    </button>
                </div>
            ) : (
                <div>
                    <div className="flex flex-wrap gap-x-6">
                        <FieldSelect
                            label="Status"
                            value={fields.owner_status}
                            options={REQUEST_STATUSES}
                            onChange={(v) => setFields((f) => ({ ...f, owner_status: v }))}
                        />
                        <FieldSelect
                            label="Priority"
                            value={fields.owner_priority}
                            options={REQUEST_PRIORITIES}
                            onChange={(v) => setFields((f) => ({ ...f, owner_priority: v }))}
                        />
                        <FieldText label="Assigned to" value={fields.assigned_to} onChange={(v) => setFields((f) => ({ ...f, assigned_to: v }))} />
                        <FieldDate label="Due date" value={fields.due_date} onChange={(v) => setFields((f) => ({ ...f, due_date: v }))} />
                        <FieldText label="Owner note" value={fields.owner_note} onChange={(v) => setFields((f) => ({ ...f, owner_note: v }))} />
                        <FieldText
                            label="Resolution note"
                            value={fields.resolution_note}
                            onChange={(v) => setFields((f) => ({ ...f, resolution_note: v }))}
                        />
                    </div>
                    <div className="mt-2 flex justify-end gap-[0.6rem]">
                        <button type="button" disabled={saving} className={DASH_BTN_SECONDARY} onClick={() => setEditMode(false)}>
                            Cancel
                        </button>
                        <button type="button" disabled={saving} className={DASH_BTN} onClick={save}>
                            Save
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// --- Stocktake Review ------------------------------------------------------

function StocktakeSection({ row, stockItems, onChanged }) {
    const header = row.stocktakeHeader;
    const [editMode, setEditMode] = useState(false);
    const [busy, setBusy] = useState(false);

    if (!header) return <p className="text-muted">Linked stocktake not found.</p>;
    const pending = header.reconciliation_status === "PENDING";

    function confirm() {
        setBusy(true);
        apiCall("confirm_stocktake", { stocktakeHeaderId: header.stocktake_header_id }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Confirm failed.", "Can't confirm yet");
            onChanged();
        });
    }
    function decline() {
        setBusy(true);
        apiCall("decline_stocktake", { stocktakeHeaderId: header.stocktake_header_id }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Decline failed.");
            onChanged();
        });
    }

    return (
        <div>
            <p className="mb-2 text-muted">
                {header.stocktake_date} — {header.completion_status} — reconciliation: {header.reconciliation_status}
            </p>

            {!editMode ? (
                <div>
                    <StocktakeLinesView lines={row.stocktakeLines || []} />
                    {pending && (
                        <button type="button" className={DASH_BTN + " mt-2"} onClick={() => setEditMode(true)}>
                            Edit
                        </button>
                    )}
                </div>
            ) : (
                <StocktakeLinesEditor
                    header={header}
                    lines={row.stocktakeLines || []}
                    stockItems={stockItems}
                    onCancel={() => setEditMode(false)}
                    onSaved={() => {
                        setEditMode(false);
                        onChanged();
                    }}
                />
            )}

            {pending && !editMode && (
                <div className="mt-3 flex justify-end gap-[0.6rem]">
                    <button type="button" disabled={busy} className={DASH_BTN_SECONDARY} onClick={decline}>
                        Decline — post nothing
                    </button>
                    <button type="button" disabled={busy} className={DASH_BTN} onClick={confirm}>
                        Confirm — post reconciliation movements
                    </button>
                </div>
            )}
        </div>
    );
}

function StocktakeLinesView({ lines }) {
    return (
        <RequestTableWrap>
            <table className="w-full border-collapse text-[0.85rem]">
                <thead>
                    <tr>
                        <th className={TH}>Stock item</th>
                        <th className={TH}>Counted qty</th>
                        <th className={TH}>Unit</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line) => (
                        <tr key={line.stocktake_line_id}>
                            <td className={TD}>{line.stockItemName || line.stock_item_id}</td>
                            <td className={TD}>{String(line.counted_qty)}</td>
                            <td className={TD}>{line.count_unit || ""}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </RequestTableWrap>
    );
}

function StocktakeLinesEditor({ header, lines, stockItems, onCancel, onSaved }) {
    const [rows, setRows] = useState(() => lines.map((l) => ({ ...l, _qty: String(l.counted_qty), _remove: false })));
    const [newItemId, setNewItemId] = useState("");
    const [newQty, setNewQty] = useState("");
    const [saving, setSaving] = useState(false);

    function updateRow(idx, patch) {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    }

    function save() {
        const tasks = [];
        rows.forEach((line) => {
            if (line._remove) {
                tasks.push(() => apiCall("delete_stocktake_line", { stocktakeLineId: line.stocktake_line_id }));
            } else if (String(line._qty) !== String(line.counted_qty)) {
                tasks.push(() =>
                    apiCall("save_stocktake_line", {
                        stocktakeHeaderId: header.stocktake_header_id,
                        isNew: false,
                        line: { stocktake_line_id: line.stocktake_line_id, stock_item_id: line.stock_item_id, counted_qty: line._qty },
                    }),
                );
            }
        });
        if (newItemId) {
            tasks.push(() =>
                apiCall("save_stocktake_line", {
                    stocktakeHeaderId: header.stocktake_header_id,
                    isNew: true,
                    line: { stock_item_id: newItemId, counted_qty: newQty },
                }),
            );
        }
        setSaving(true);
        (tasks.length ? runSequential(tasks) : Promise.resolve({ ok: true })).then((res) => {
            setSaving(false);
            if (!res || res.ok === false) {
                noticeModal((res && res.error) || "Save failed.");
                return;
            }
            onSaved();
        });
    }

    return (
        <div>
            <RequestTableWrap>
                <table className="w-full border-collapse text-[0.85rem]">
                    <thead>
                        <tr>
                            <th className={TH}>Stock item</th>
                            <th className={TH}>Counted qty</th>
                            <th className={TH}>Unit</th>
                            <th className={TH}>Remove</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((line, idx) => (
                            <tr key={line.stocktake_line_id}>
                                <td className={TD}>{line.stockItemName || line.stock_item_id}</td>
                                <td className={TD}>
                                    <input type="number" step="0.01" value={line._qty} onChange={(e) => updateRow(idx, { _qty: e.target.value })} />
                                </td>
                                <td className={TD}>{line.count_unit || ""}</td>
                                <td className={TD}>
                                    <input type="checkbox" checked={line._remove} onChange={(e) => updateRow(idx, { _remove: e.target.checked })} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </RequestTableWrap>

            <div className="mt-3 flex items-end gap-[0.6rem]">
                <div className="min-w-0 flex-1">
                    <StockItemPicker stockItems={stockItems} value={newItemId} onChange={setNewItemId} />
                </div>
                <input type="number" step="0.01" placeholder="Qty" className="w-24" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </div>

            <div className="mt-3 flex justify-end gap-[0.6rem]">
                <button type="button" disabled={saving} className={DASH_BTN_SECONDARY} onClick={onCancel}>
                    Cancel
                </button>
                <button type="button" disabled={saving} className={DASH_BTN} onClick={save}>
                    Save
                </button>
            </div>
        </div>
    );
}

// --- Transfer (Approval / Apply) -------------------------------------------

function TransferSection({ row, kiosks, onChanged }) {
    const transfers = row.transfers || [];
    const [editMode, setEditMode] = useState(false);
    if (!transfers.length) return <p className="text-muted">No linked transfers found.</p>;
    const hasPending = transfers.some((t) => t.status === "PENDING");

    return editMode ? (
        <TransferEditor
            transfers={transfers}
            kiosks={kiosks}
            onCancel={() => setEditMode(false)}
            onSaved={() => {
                setEditMode(false);
                onChanged();
            }}
        />
    ) : (
        <div>
            <TransferView transfers={transfers} kiosks={kiosks} row={row} onChanged={onChanged} />
            {hasPending && (
                <button type="button" className={DASH_BTN + " mt-3"} onClick={() => setEditMode(true)}>
                    Edit
                </button>
            )}
        </div>
    );
}

function TransferView({ transfers, kiosks, onChanged }) {
    const [applyChecked, setApplyChecked] = useState(() => {
        const m = {};
        transfers.forEach((t) => {
            if (t.status === "APPROVED") m[t.transfer_id] = true;
        });
        return m;
    });
    const [busy, setBusy] = useState(false);

    const pendingIds = transfers.filter((t) => t.status === "PENDING").map((t) => t.transfer_id);
    const approvedIds = transfers.filter((t) => t.status === "APPROVED").map((t) => t.transfer_id);
    // One mandatory photo per transfer request, shared by every line in it
    // (see stock_transfer.photo_reference) — shown once, not per row.
    const photoReference = transfers.find((t) => t.photo_reference)?.photo_reference;

    function approveAll() {
        setBusy(true);
        apiCall("approve_stock_transfers", { transferIds: pendingIds }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Approve failed.");
            onChanged();
        });
    }
    function declineAll() {
        setBusy(true);
        apiCall("decline_stock_transfers", { transferIds: pendingIds }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Decline failed.");
            onChanged();
        });
    }
    function applySelected() {
        const ids = approvedIds.filter((id) => applyChecked[id]);
        if (!ids.length) return noticeModal("Select at least one transfer to apply.");
        setBusy(true);
        apiCall("apply_stock_transfers", { transferIds: ids }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Apply failed.");
            onChanged();
        });
    }

    return (
        <div>
            {photoReference && <DrivePreview url={photoReference} label="Photo of items being transferred" />}
            <RequestTableWrap>
                <table className="w-full border-collapse text-[0.85rem]">
                    <thead>
                        <tr>
                            <th className={TH}>Item</th>
                            <th className={TH}>Qty</th>
                            <th className={TH}>Source</th>
                            <th className={TH}>Destination</th>
                            <th className={TH}>Status</th>
                            <th className={TH}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {transfers.map((t) => (
                            <tr key={t.transfer_id}>
                                <td className={TD}>{t.stockItemName || t.stock_item_id}</td>
                                <td className={TD}>
                                    {t.qty} {t.count_unit}
                                </td>
                                <td className={TD}>{kioskName(kiosks, t.source_kiosk_id)}</td>
                                <td className={TD}>{kioskName(kiosks, t.destination_kiosk_id)}</td>
                                <td className={TD}>{t.status}</td>
                                <td className={TD}>
                                    {t.status === "APPROVED" && (
                                        <input
                                            type="checkbox"
                                            checked={!!applyChecked[t.transfer_id]}
                                            onChange={(e) => setApplyChecked((m) => ({ ...m, [t.transfer_id]: e.target.checked }))}
                                        />
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </RequestTableWrap>

            {pendingIds.length > 0 && (
                <div className="mt-3 flex gap-[0.6rem]">
                    <button type="button" disabled={busy} className={DASH_BTN} onClick={approveAll}>
                        Approve all ({pendingIds.length})
                    </button>
                    <button type="button" disabled={busy} className={DASH_BTN_SECONDARY} onClick={declineAll}>
                        Decline all
                    </button>
                </div>
            )}
            {approvedIds.length > 0 && (
                <button type="button" disabled={busy} className={DASH_BTN + " mt-3"} onClick={applySelected}>
                    Apply selected — post stock movements
                </button>
            )}
        </div>
    );
}

function TransferEditor({ transfers, kiosks, onCancel, onSaved }) {
    const [edits, setEdits] = useState(() => {
        const m = {};
        transfers.forEach((t) => {
            if (t.status === "PENDING") m[t.transfer_id] = { source: t.source_kiosk_id || "", dest: t.destination_kiosk_id || "" };
        });
        return m;
    });
    const [saving, setSaving] = useState(false);

    function save() {
        const tasks = [];
        transfers.forEach((t) => {
            if (t.status !== "PENDING") return;
            const e = edits[t.transfer_id];
            if (e.source !== (t.source_kiosk_id || "") || e.dest !== (t.destination_kiosk_id || "")) {
                tasks.push(() =>
                    apiCall("update_stock_transfer", {
                        transferId: t.transfer_id,
                        changes: { source_kiosk_id: e.source, destination_kiosk_id: e.dest },
                    }),
                );
            }
        });
        setSaving(true);
        (tasks.length ? runSequential(tasks) : Promise.resolve({ ok: true })).then((res) => {
            setSaving(false);
            if (!res || res.ok === false) {
                noticeModal((res && res.error) || "Save failed.");
                return;
            }
            onSaved();
        });
    }

    return (
        <div>
            <RequestTableWrap>
                <table className="w-full border-collapse text-[0.85rem]">
                    <thead>
                        <tr>
                            <th className={TH}>Item</th>
                            <th className={TH}>Qty</th>
                            <th className={TH}>Source</th>
                            <th className={TH}>Destination</th>
                            <th className={TH}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {transfers.map((t) => (
                            <tr key={t.transfer_id}>
                                <td className={TD}>{t.stockItemName || t.stock_item_id}</td>
                                <td className={TD}>
                                    {t.qty} {t.count_unit}
                                </td>
                                {t.status === "PENDING" ? (
                                    <>
                                        <td className={TD}>
                                            <KioskPicker
                                                kiosks={kiosks}
                                                value={edits[t.transfer_id].source}
                                                onChange={(v) => setEdits((m) => ({ ...m, [t.transfer_id]: { ...m[t.transfer_id], source: v } }))}
                                            />
                                        </td>
                                        <td className={TD}>
                                            <KioskPicker
                                                kiosks={kiosks}
                                                value={edits[t.transfer_id].dest}
                                                onChange={(v) => setEdits((m) => ({ ...m, [t.transfer_id]: { ...m[t.transfer_id], dest: v } }))}
                                            />
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className={TD}>{kioskName(kiosks, t.source_kiosk_id)}</td>
                                        <td className={TD}>{kioskName(kiosks, t.destination_kiosk_id)}</td>
                                    </>
                                )}
                                <td className={TD}>{t.status}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </RequestTableWrap>

            <div className="mt-3 flex justify-end gap-[0.6rem]">
                <button type="button" disabled={saving} className={DASH_BTN_SECONDARY} onClick={onCancel}>
                    Cancel
                </button>
                <button type="button" disabled={saving} className={DASH_BTN} onClick={save}>
                    Save
                </button>
            </div>
        </div>
    );
}

// --- Delivery Invoice -------------------------------------------------------

/** What still stops a DRAFT invoice line from being confirmed — same rules the server enforces on Confirm
 * (stock item picked, quantity above 0, unit cost entered). "" when the line is fine. */
function invoiceLineProblem({ stockItemId, qty, cost }) {
    const fixes = [];
    if (!stockItemId) fixes.push("pick the stock item");
    const q = Number(qty);
    if (qty === "" || qty === null || qty === undefined || !Number.isFinite(q) || q <= 0) fixes.push("enter a quantity above 0");
    const c = Number(cost);
    if (cost === "" || cost === null || cost === undefined || !Number.isFinite(c) || c < 0) fixes.push("enter the unit cost");
    return fixes.join(", ");
}

const PROBLEM_ROW = "bg-danger-bg/40";

function InvoiceSection({ row, stockItems, onChanged }) {
    const header = row.deliveryHeader;
    const [editMode, setEditMode] = useState(false);
    // Set once Confirm has been refused: from then on the lines that still need fixing are marked in red.
    const [flagged, setFlagged] = useState(false);
    const [busy, setBusy] = useState(false);
    const [aiRunning, setAiRunning] = useState(false);
    const [aiMessage, setAiMessage] = useState("");
    if (!header) return <p className="text-muted">Linked delivery not found.</p>;
    const inReview = header.status === "IN_REVIEW";
    const files = row.deliveryFiles || [];
    // The AI's own words about why it couldn't read the invoice (plain sentence, see InvoiceAiService).
    const aiError = (files.find((f) => f.ai_status === "FAILED" && f.ai_error) || {}).ai_error || "";
    const aiNeedsRun = files.some((f) => f.ai_status !== "SUCCESS") || !(row.invoiceLines || []).length;

    // Nothing is posted until the owner says yes here: Confirm writes stock movements, so it never fires on one stray click.
    async function confirm() {
        const draft = (row.invoiceLines || []).filter((l) => l.status === "DRAFT");
        const total = draft.reduce((sum, l) => sum + (Number(l.line_total) || Number(l.qty) * Number(l.unit_cost) || 0), 0);
        const ok = await confirmModal(
            `Confirm this invoice? ${draft.length} line${draft.length === 1 ? "" : "s"}, about €${total.toFixed(2)}. This adds them to the kiosk's stock as deliveries and updates stock and costs. You can undo it afterwards from this card.`,
            "Confirm invoice",
        );
        if (!ok) return;
        setBusy(true);
        apiCall("confirm_invoice_review", { deliveryHeaderId: header.delivery_header_id }).then((res) => {
            setBusy(false);
            if (!res.ok) {
                setFlagged(true);
                return noticeModal(res.error || "Confirm failed.", "Can't confirm yet", { actionLabel: "Edit lines" }).then((goEdit) => goEdit && setEditMode(true));
            }
            onChanged();
        });
    }
    // Reads the stored photos with the AI again — the fix for invoices whose first attempt failed (e.g. while
    // the AI key was wrong). Replaces only untouched AI draft lines; anything typed or corrected is kept.
    function rerunAi() {
        setAiRunning(true);
        setAiMessage("");
        apiCall("rerun_invoice_ai", { deliveryHeaderId: header.delivery_header_id })
            .catch(() => ({ ok: false, error: "Could not reach the server — check your connection and try again." }))
            .then((res) => {
                setAiRunning(false);
                if (!res.ok) return setAiMessage(res.error || "Could not re-run AI extraction.");
                setAiMessage(res.aiOk ? (res.lineCount ? res.lineCount + " line(s) extracted — check them, then confirm." : "AI read the invoice but found no lines — enter them manually.") : res.aiError);
                onChanged();
            });
    }
    async function undoReview() {
        const ok = await confirmModal(
            "Undo this review? Any stock movements it posted are removed and the invoice goes back to 'in review', so you can fix it and confirm again.",
            "Undo review",
            true,
        );
        if (!ok) return;
        setBusy(true);
        apiCall("undo_invoice_review", { deliveryHeaderId: header.delivery_header_id }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Undo failed.", "Can't undo");
            setFlagged(false);
            onChanged();
        });
    }
    function decline() {
        setBusy(true);
        apiCall("decline_invoice_review", { deliveryHeaderId: header.delivery_header_id }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Decline failed.");
            onChanged();
        });
    }

    return (
        <div>
            <p className="mb-2 text-muted">
                {row.supplierName || ""} — {header.document_type} — {header.delivery_date} — status: {header.status}
            </p>
            {files.map((f, i) => (
                <DrivePreview key={i} url={f.file_url} label={f.file_name || "Page " + (i + 1)} />
            ))}

            {aiNeedsRun && (
                <div className="my-2 rounded-card border border-line bg-panel px-3 py-2.5 text-[0.85rem]">
                    <div className="font-semibold text-ink">{files.some((f) => f.ai_status === "FAILED")
                            ? "AI couldn't read this invoice"
                            : files.some((f) => f.ai_status !== "SUCCESS")
                              ? "AI has not read this invoice yet"
                              : "AI found no lines on this invoice"}</div>
                    {aiError && <div className="mt-0.5 text-muted">{aiError}</div>}
                    {aiMessage && <div className="mt-1 font-medium text-ink">{aiMessage}</div>}
                    {inReview && (
                        <button type="button" disabled={aiRunning || busy} className={DASH_BTN + " mt-2"} onClick={rerunAi}>
                            {aiRunning ? "Reading invoice… (can take up to a minute)" : "Re-run AI extraction"}
                        </button>
                    )}
                </div>
            )}

            {!editMode ? (
                <div>
                    <InvoiceLinesView lines={row.invoiceLines || []} showProblems={flagged} />
                    {inReview && (
                        <button type="button" className={DASH_BTN + " mt-2"} onClick={() => setEditMode(true)}>
                            Edit
                        </button>
                    )}
                </div>
            ) : (
                <InvoiceLinesEditor
                    header={header}
                    lines={row.invoiceLines || []}
                    stockItems={stockItems}
                    showProblems={flagged}
                    onCancel={() => setEditMode(false)}
                    onSaved={() => {
                        setEditMode(false);
                        onChanged();
                    }}
                />
            )}

            {header.status === "REVIEWED" && (
                <div className="mt-3 flex justify-end">
                    <button type="button" disabled={busy} className={DASH_BTN_SECONDARY} onClick={undoReview}>
                        Undo — put back in review
                    </button>
                </div>
            )}

            {inReview && !editMode && (
                <div className="mt-3 flex justify-end gap-[0.6rem]">
                    <button type="button" disabled={busy} className={DASH_BTN_SECONDARY} onClick={decline}>
                        Decline — post nothing
                    </button>
                    <button type="button" disabled={busy} className={DASH_BTN} onClick={confirm}>
                        Confirm — approve lines, post stock movements
                    </button>
                </div>
            )}
        </div>
    );
}

function InvoiceLinesView({ lines, showProblems }) {
    return (
        <RequestTableWrap>
            <table className="w-full border-collapse text-[0.85rem]">
                <thead>
                    <tr>
                        <th className={TH}>Description</th>
                        <th className={TH}>Stock item</th>
                        <th className={TH}>Qty</th>
                        <th className={TH}>Unit cost</th>
                        <th className={TH}>Source</th>
                        <th className={TH}>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line) => {
                        const problem = showProblems && line.status === "DRAFT" ? invoiceLineProblem({ stockItemId: line.stock_item_id, qty: line.qty, cost: line.unit_cost }) : "";
                        return (
                            <tr key={line.invoice_line_id} className={problem ? PROBLEM_ROW : ""}>
                                <td className={TD}>{line.description_raw || ""}</td>
                                <td className={TD}>
                                    {line.stockItemName || ""}
                                    {problem && <div className="text-[0.75rem] font-semibold text-danger-ink">Needs attention: {problem}</div>}
                                </td>
                                <td className={TD}>{String(line.qty)}</td>
                                <td className={TD}>{String(line.unit_cost)}</td>
                                <td className={TD}>{line.source}</td>
                                <td className={TD}>{line.status}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </RequestTableWrap>
    );
}

function InvoiceLinesEditor({ header, lines, stockItems, showProblems, onCancel, onSaved }) {
    const [rows, setRows] = useState(() =>
        lines.map((l) => ({
            line: l,
            _desc: l.description_raw || "",
            _stockItemId: l.stock_item_id || "",
            _qty: String(l.qty),
            _cost: String(l.unit_cost),
            _remove: false,
        })),
    );
    const [newDesc, setNewDesc] = useState("");
    const [newStockItemId, setNewStockItemId] = useState("");
    const [newQty, setNewQty] = useState("");
    const [newCost, setNewCost] = useState("");
    const [saving, setSaving] = useState(false);

    function updateRow(idx, patch) {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    }

    function save() {
        const tasks = [];
        rows.forEach((r) => {
            const line = r.line;
            if (line.status !== "DRAFT") return;
            if (r._remove) {
                tasks.push(() => apiCall("delete_invoice_line", { invoiceLineId: line.invoice_line_id }));
                return;
            }
            const changed =
                r._desc !== (line.description_raw || "") ||
                r._stockItemId !== (line.stock_item_id || "") ||
                String(r._qty) !== String(line.qty) ||
                String(r._cost) !== String(line.unit_cost);
            if (changed) {
                tasks.push(() =>
                    apiCall("save_invoice_line", {
                        deliveryHeaderId: header.delivery_header_id,
                        isNew: false,
                        line: {
                            invoice_line_id: line.invoice_line_id,
                            description_raw: r._desc,
                            stock_item_id: r._stockItemId,
                            qty: r._qty,
                            unit_cost: r._cost,
                        },
                    }),
                );
            }
        });
        if (newDesc.trim()) {
            tasks.push(() =>
                apiCall("save_invoice_line", {
                    deliveryHeaderId: header.delivery_header_id,
                    isNew: true,
                    line: { description_raw: newDesc, stock_item_id: newStockItemId, qty: newQty, unit_cost: newCost },
                }),
            );
        }
        setSaving(true);
        (tasks.length ? runSequential(tasks) : Promise.resolve({ ok: true })).then((res) => {
            setSaving(false);
            if (!res || res.ok === false) {
                noticeModal((res && res.error) || "Save failed.");
                return;
            }
            onSaved();
        });
    }

    return (
        <div>
            <RequestTableWrap>
                <table className="w-full border-collapse text-[0.85rem]">
                    <thead>
                        <tr>
                            <th className={TH}>Description</th>
                            <th className={TH}>Stock item</th>
                            <th className={TH}>Qty</th>
                            <th className={TH}>Unit cost</th>
                            <th className={TH}>Source</th>
                            <th className={TH}>Status</th>
                            <th className={TH}>Remove</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, idx) => {
                            const line = r.line;
                            if (line.status !== "DRAFT") {
                                return (
                                    <tr key={line.invoice_line_id}>
                                        <td className={TD}>{line.description_raw || ""}</td>
                                        <td className={TD}>{line.stockItemName || ""}</td>
                                        <td className={TD}>{String(line.qty)}</td>
                                        <td className={TD}>{String(line.unit_cost)}</td>
                                        <td className={TD}>{line.source}</td>
                                        <td className={TD}>{line.status}</td>
                                        <td className={TD}></td>
                                    </tr>
                                );
                            }
                            const problem = showProblems && !r._remove ? invoiceLineProblem({ stockItemId: r._stockItemId, qty: r._qty, cost: r._cost }) : "";
                            return (
                                <tr key={line.invoice_line_id} className={problem ? PROBLEM_ROW : ""}>
                                    <td className={TD}>
                                        <input type="text" value={r._desc} onChange={(e) => updateRow(idx, { _desc: e.target.value })} />
                                    </td>
                                    <td className={TD}>
                                        <StockItemPicker
                                            stockItems={stockItems}
                                            value={r._stockItemId}
                                            onChange={(v) => updateRow(idx, { _stockItemId: v })}
                                        />
                                        {problem && <div className="mt-1 text-[0.75rem] font-semibold text-danger-ink">Needs attention: {problem}</div>}
                                    </td>
                                    <td className={TD}>
                                        <input type="number" step="0.01" value={r._qty} onChange={(e) => updateRow(idx, { _qty: e.target.value })} />
                                    </td>
                                    <td className={TD}>
                                        <input type="number" step="0.01" value={r._cost} onChange={(e) => updateRow(idx, { _cost: e.target.value })} />
                                    </td>
                                    <td className={TD}>{line.source}</td>
                                    <td className={TD}>{line.status}</td>
                                    <td className={TD}>
                                        <input type="checkbox" checked={r._remove} onChange={(e) => updateRow(idx, { _remove: e.target.checked })} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </RequestTableWrap>

            <div className="mt-3 flex flex-wrap items-end gap-[0.6rem]">
                <input type="text" placeholder="New line — description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                <div className="min-w-0 flex-1">
                    <StockItemPicker stockItems={stockItems} value={newStockItemId} onChange={setNewStockItemId} />
                </div>
                <input type="number" step="0.01" placeholder="Qty" className="w-24" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
                <input
                    type="number"
                    step="0.01"
                    placeholder="Unit cost"
                    className="w-28"
                    value={newCost}
                    onChange={(e) => setNewCost(e.target.value)}
                />
            </div>

            <div className="mt-3 flex justify-end gap-[0.6rem]">
                <button type="button" disabled={saving} className={DASH_BTN_SECONDARY} onClick={onCancel}>
                    Cancel
                </button>
                <button type="button" disabled={saving} className={DASH_BTN} onClick={save}>
                    Save
                </button>
            </div>
        </div>
    );
}

// --- Monthly Audit Review ---------------------------------------------------

function AuditReviewSection({ row, onChanged }) {
    const response = row.auditResponse;
    const answers = row.auditAnswers || [];
    if (!response) return <p className="text-muted">Linked audit not found.</p>;

    const reviewedCount = answers.filter((a) => !!a.owner_decision).length;

    return (
        <div>
            <p className="mb-2 text-muted">
                {response.review_status} — {reviewedCount}/{answers.length} reviewed
                {response.review_status === "FULLY_REVIEWED" ? " — final: " + response.final_score + "% (" + response.final_rating + ")" : ""}
            </p>
            {response.review_status === "FULLY_REVIEWED" && (
                <a
                    href={"/dashboard/audits/" + response.audit_response_id}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[0.78rem] font-medium text-ink no-underline hover:border-accent/40 hover:text-accent"
                >
                    View final result — score, photos &amp; corrections
                </a>
            )}
            {answers.map((a) => (
                <AuditAnswerCard key={a.audit_answer_id} a={a} ownerActionId={row.owner_action_id} onChanged={onChanged} />
            ))}
        </div>
    );
}

function AuditAnswerCard({ a, onChanged }) {
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);

    function decide(decision) {
        setBusy(true);
        apiCall("review_audit_answer", { auditAnswerId: a.audit_answer_id, decision, note }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Save failed.");
            onChanged();
        });
    }

    return (
        <div className={"mb-[0.6rem] rounded-card border bg-card p-[0.8rem] " + (a.critical ? "border-line border-l-[3px] border-l-danger-ink" : "border-line")}>
            <div className="mb-[0.4rem] text-[0.8rem] text-muted">
                {a.sectionName}
                {a.critical ? " — CRITICAL" : ""} — staff answer: {a.staff_answer}
                {a.owner_decision ? " — owner: " + a.owner_decision : ""}
            </div>
            <div>{a.questionText}</div>
            {a.evidence_photo_reference && <DrivePreview url={a.evidence_photo_reference} label="Evidence" />}
            {a.owner_note && <p className="text-muted">Owner note: {a.owner_note}</p>}

            {!a.owner_decision && (
                <div>
                    <input
                        type="text"
                        placeholder="Note (required for fail / insufficient evidence)"
                        className="w-full"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="mt-[0.5rem] flex flex-wrap gap-[0.4rem]">
                        {a.staff_answer === "NA" ? (
                            <button type="button" disabled={busy} className={DASH_BTN} onClick={() => decide("ACCEPT")}>
                                Acknowledge (N/A)
                            </button>
                        ) : (
                            [
                                ["ACCEPT", "Accept"],
                                ["OVERRIDE_PASS", "Override -> Pass"],
                                ["OVERRIDE_FAIL", "Override -> Fail"],
                                ["EVIDENCE_INSUFFICIENT", "Evidence insufficient"],
                            ].map(([value, label]) => (
                                <button key={value} type="button" disabled={busy} className={DASH_BTN} onClick={() => decide(value)}>
                                    {label}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// --- Audit Correction Review ------------------------------------------------

function AuditCorrectionSection({ row, onChanged }) {
    const correction = row.auditCorrection;
    const [busy, setBusy] = useState(false);
    if (!correction) return <p className="text-muted">Linked correction not found.</p>;
    const ca = correction.correctiveAction;
    const pending = ca && ca.status === "REPLACEMENT_SUBMITTED";

    function review(decision) {
        setBusy(true);
        apiCall("review_audit_correction", { auditCorrectionId: correction.audit_correction_id, decision }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Save failed.");
            onChanged();
        });
    }

    return (
        <div>
            <p className="mb-2 text-muted">
                {correction.questionText || ""} — cycle {correction.correction_cycle}
                {ca ? " — deadline " + ca.deadline + " — status: " + ca.status : ""}
            </p>
            <p>{correction.correction_note || ""}</p>
            {correction.replacement_photo_reference && <DrivePreview url={correction.replacement_photo_reference} label="Replacement evidence" />}

            {pending && (
                <div className="mt-3 flex justify-end gap-[0.6rem]">
                    <button type="button" disabled={busy} className={DASH_BTN_SECONDARY} onClick={() => review("REJECT")}>
                        Reject — needs resubmission
                    </button>
                    <button type="button" disabled={busy} className={DASH_BTN} onClick={() => review("ACCEPT")}>
                        Accept — close corrective action
                    </button>
                </div>
            )}
        </div>
    );
}

// --- Damaged Product --------------------------------------------------------

function DamageSection({ row, onChanged }) {
    const m = row.damageMovement;
    const [busy, setBusy] = useState(false);
    if (!m) return <p className="text-muted">Linked damage record not found.</p>;

    function ok() {
        setBusy(true);
        apiCall("update_owner_action", { ownerActionId: row.owner_action_id, changes: { status: "RESOLVED" } }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Save failed.");
            onChanged();
        });
    }

    const canResolve = row.status !== "RESOLVED" && row.status !== "CLOSED" && row.status !== "NOT_PROCEEDING";

    return (
        <div>
            <p>
                {m.productName} — qty {m.qty}
                {m.cost !== "" ? " — cost " + m.cost : " — uncosted"}
                {m.damage_cause ? " — " + m.damage_cause : ""}
            </p>
            {m.photo_reference && <DrivePreview url={m.photo_reference} label="Photo" />}
            {canResolve && (
                <button type="button" disabled={busy} className={DASH_BTN + " mt-2"} onClick={ok}>
                    OK
                </button>
            )}
        </div>
    );
}

// --- Purchasing Recommendation ----------------------------------------------

function PurchasingRecommendationSection({ row, onChanged }) {
    const batch = row.purchasingBatch;
    const [busy, setBusy] = useState(false);
    if (!batch) return <p className="text-muted">Linked purchasing batch not found.</p>;

    const lines = row.purchasingLines || [];
    const canResolve = row.status !== "RESOLVED" && row.status !== "CLOSED" && row.status !== "NOT_PROCEEDING";

    function ok() {
        setBusy(true);
        apiCall("update_owner_action", { ownerActionId: row.owner_action_id, changes: { status: "RESOLVED" } }).then((res) => {
            setBusy(false);
            if (!res.ok) return noticeModal(res.error || "Save failed.");
            onChanged();
        });
    }

    return (
        <div>
            <p className="mb-2 text-muted">
                {batch.supplier_id
                    ? (row.purchasingSupplierName || batch.supplier_id) + " — " + batch.order_output_method + " — generated " + batch.generated_at
                    : "Items missing par setup or a supplier mapping — generated " + batch.generated_at}
            </p>
            {batch.supplier_id && (
                <p className={"mb-2 " + (batch.emailed_at ? "text-muted" : "text-danger-ink")}>
                    {batch.emailed_at
                        ? "Order emailed to " + batch.emailed_to + " to review and forward."
                        : "Not emailed" + (batch.email_error ? ": " + batch.email_error : ". Use Draft orders to send it.")}
                </p>
            )}

            {!lines.length ? (
                <p className="text-muted">No line items.</p>
            ) : (
                <RequestTableWrap>
                    <table className="w-full border-collapse text-[0.85rem]">
                        <thead>
                            <tr>
                                <th className={TH}>Item</th>
                                <th className={TH}>Recommended</th>
                                <th className={TH}>Flags</th>
                                <th className={TH}>Kiosk breakdown</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line, i) => (
                                <tr key={i}>
                                    <td className={TD}>{line.stockItemName}</td>
                                    <td className={TD}>
                                        {line.recommended_packs !== "" && line.recommended_packs !== undefined
                                            ? line.recommended_packs + " pack(s) = " + line.recommended_qty + " " + line.unit
                                            : "—"}
                                    </td>
                                    <td className={TD}>{(line.flagList || []).join(", ") || "—"}</td>
                                    <td className={TD}>
                                        <ul className="m-0 pl-[1.1rem]">
                                            {(line.kioskBreakdown || []).map((kb, j) => (
                                                <li key={j} className={kb.triggered ? "font-semibold" : ""}>
                                                    {kb.kioskName}: {kb.currentStock === null ? "no data" : "stock " + kb.currentStock}
                                                    {kb.triggered ? " — short " + kb.shortfall : ""}
                                                    {kb.flag ? " (" + kb.flag + ")" : ""}
                                                </li>
                                            ))}
                                        </ul>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </RequestTableWrap>
            )}

            {canResolve && (
                <button type="button" disabled={busy} className={DASH_BTN + " mt-2"} onClick={ok}>
                    OK — reviewed
                </button>
            )}
        </div>
    );
}
