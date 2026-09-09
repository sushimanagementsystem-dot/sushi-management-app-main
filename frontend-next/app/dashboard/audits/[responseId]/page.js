"use client";

import { useParams } from "next/navigation";
import { Printer, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import EvidencePreview from "@/components/dashboard/EvidencePreview";
import { useBootstrap } from "@/lib/queries";

const RATING_STYLE = {
    PASS: { badge: "bg-success-bg text-success-ink", Icon: CheckCircle2 },
    ATTENTION: { badge: "bg-warn-bg text-warn-ink", Icon: AlertTriangle },
    ACTION_REQUIRED: { badge: "bg-danger-bg text-danger-ink", Icon: XCircle },
};

/**
 * Final Audit Result — the "clear score, final result, photos, applicable
 * corrections" view the request asked for, reachable by audit_response_id
 * regardless of the Action Inbox's own open/resolved state. Deliberately
 * doesn't list every question answered (that full breakdown stays in the
 * Action Inbox's own review UI, where it belongs during review) — this
 * page is print/PDF-shaped: score, photos, corrections, nothing else, per
 * the explicit "no useless task lists" ask. The Print button uses the
 * browser's own print-to-PDF (every browser's print dialog can save as
 * PDF) rather than adding a PDF-generation dependency — DashboardShell and
 * globals.css already carry the print CSS (sidebar/chrome hidden, full
 * content visible) this page relies on.
 */
export default function AuditResultPage() {
    const params = useParams();
    const responseId = params.responseId;

    const { data: res, isPending: loading, error: bootError } = useBootstrap("bootstrap_audit_result", responseId ? { auditResponseId: responseId } : null);
    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    return (
        <>
            <PageTitle title="Dashboard — Audit Result" />
            <DashboardShell activeKey="inbox">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Audit Result"
                        description={res ? `${res.kioskName} — ${res.auditDate}` : ""}
                        actions={
                            <button
                                type="button"
                                onClick={() => window.print()}
                                className="no-print flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[0.78rem] font-medium text-ink hover:border-accent/40 hover:text-accent"
                            >
                                <Printer size={13} strokeWidth={2.25} />
                                Print / Save as PDF
                            </button>
                        }
                    />

                    {loading && (
                        <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                    )}
                    {error && <div className="text-danger-ink">{error}</div>}

                    {!loading && res && !error && <AuditResultBody res={res} />}
                </div>
            </DashboardShell>
        </>
    );
}

function AuditResultBody({ res }) {
    if (res.reviewStatus !== "FULLY_REVIEWED") {
        return (
            <SectionCard title="Not finalized yet" className="mb-0">
                <p className="flex items-center gap-2 text-muted">
                    <Clock size={16} strokeWidth={2.25} />
                    This audit is still being reviewed ({res.reviewStatus}) — the final score and result appear here once every question has been decided.
                </p>
            </SectionCard>
        );
    }

    const ratingStyle = RATING_STYLE[res.finalRating] || RATING_STYLE.ACTION_REQUIRED;
    const RatingIcon = ratingStyle.Icon;

    return (
        <>
            <SectionCard title="Result" className="mb-5">
                <div className="flex flex-wrap items-center gap-5">
                    <div>
                        <div className="text-4xl font-bold tabular-nums tracking-[-0.02em] text-ink">{res.finalScore}%</div>
                        <div className="text-[0.8rem] text-muted">Final score</div>
                    </div>
                    <span className={"inline-flex items-center gap-2 rounded-full px-[0.8rem] py-[0.35rem] text-[0.95rem] font-bold " + ratingStyle.badge}>
                        <RatingIcon size={16} strokeWidth={2.5} />
                        {res.finalRating}
                    </span>
                </div>
            </SectionCard>

            {res.corrections.length > 0 && (
                <SectionCard title="Applicable corrections" description="Every item confirmed as a failure, and what it needs before it's closed." className="mb-5">
                    <div className="flex flex-col gap-2.5">
                        {res.corrections.map((c, i) => (
                            <CorrectionCard key={i} c={c} />
                        ))}
                    </div>
                </SectionCard>
            )}

            <SectionCard title="Photos" className="mb-0">
                {!res.photos.length ? (
                    <p className="py-4 text-center text-[0.9rem] text-muted">No evidence photos were attached to this audit.</p>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
                        {res.photos.map((p) => (
                            <div key={p.auditAnswerId}>
                                <EvidencePreview url={p.url} className="mb-1" />
                                <div className="text-[0.8rem] font-medium text-ink">{p.questionText}</div>
                                <div className="text-[0.72rem] text-muted">
                                    {p.sectionName}
                                    {p.outcome ? " — " + p.outcome : ""}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </SectionCard>
        </>
    );
}

function CorrectionCard({ c }) {
    const closed = c.status === "RESOLVED" || !!c.closedAt;
    return (
        <div className={"rounded-card border-l-[3px] bg-card p-[0.9rem_1.1rem] shadow-elevate-1 " + (closed ? "border-l-success-ink" : "border-l-danger-ink")}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <span
                    className={
                        "inline-flex items-center gap-1.5 rounded-full px-[0.55rem] py-[0.1rem] text-[0.72rem] font-semibold uppercase tracking-[0.03em] " +
                        (closed ? "bg-success-bg text-success-ink" : "bg-danger-bg text-danger-ink")
                    }
                >
                    {closed ? "Resolved" : "Open"}
                </span>
                {c.critical && <span className="text-[0.72rem] font-semibold uppercase tracking-[0.03em] text-danger-ink">Critical</span>}
            </div>
            <div className="mb-1 text-[0.95rem] font-semibold leading-snug text-ink">{c.questionText}</div>
            <div className="text-[0.78rem] text-muted">{c.sectionName}</div>
            {c.ownerNote && <p className="mt-1.5 text-[0.85rem] text-ink">{c.ownerNote}</p>}
            <div className="mt-2 border-t border-line pt-2 text-[0.78rem] text-muted">
                {closed ? "Closed " + (c.closedAt || "") : "Deadline " + (c.deadline || "—")}
            </div>
        </div>
    );
}
