"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, Clock, Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import KioskPageTransition from "@/components/kiosk/KioskPageTransition";
import Wrap from "@/components/kiosk/Wrap";
import PhotoBox from "@/components/kiosk/PhotoBox";
import { FormNote, ResultError, Spinner } from "@/components/kiosk/FormBits";

function makeClientKey() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

function isOverdue(deadline) {
    if (!deadline) return false;
    return new Date(deadline + "T23:59:59") < new Date();
}

// In-progress note/photo for whichever item is being fixed, kept in
// localStorage so navigating to the menu and back resumes where staff left
// off instead of losing what they typed — per-kiosk, not per-action, since
// only one card is ever expanded at a time on this page. Best-effort only:
// wrapped in try/catch because a private-browsing tab or a full/blocked
// storage quota must never break the form itself.
function draftKey(slug) {
    return "audit_correction_draft_" + slug;
}

function loadDraft(slug) {
    try {
        const raw = localStorage.getItem(draftKey(slug));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveDraft(slug, draft) {
    try {
        if (draft) localStorage.setItem(draftKey(slug), JSON.stringify(draft));
        else localStorage.removeItem(draftKey(slug));
    } catch {
        // best-effort — nothing to recover from here
    }
}

/**
 * A list of this kiosk's open audit fails, each fixed and submitted
 * independently — no "which action are you fixing?" dropdown. Per spec:
 * staff action/correct each item within its deadline, submitting moves it
 * to REPLACEMENT_SUBMITTED (see AuditCorrectionProcessor) where it stays
 * until the owner approves (AuditReviewService.reviewCorrection) or rejects
 * it back to OPEN for another attempt — this page just reflects whichever
 * of those two states bootstrap_audit_correction returns per action.
 */
export default function AuditCorrectionsPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [expandedId, setExpandedId] = useState(() => loadDraft(slug)?.actionId ?? null);
    const [note, setNote] = useState(() => loadDraft(slug)?.note ?? "");
    const [photo, setPhoto] = useState(() => loadDraft(slug)?.photo ?? null);
    const [formError, setFormError] = useState("");
    const [justSubmittedId, setJustSubmittedId] = useState(null);

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    // Keep the draft in step with what's on screen — cleared automatically
    // the moment there's nothing to resume (collapsed, cancelled, or submitted).
    useEffect(() => {
        saveDraft(slug, expandedId ? { actionId: expandedId, note, photo } : null);
    }, [slug, expandedId, note, photo]);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
        refetch,
    } = useBootstrap("bootstrap_audit_correction", token && { token }, { enabled: !!token });

    // A resumed draft can point at an action that's no longer OPEN (owner
    // already resolved it, or it was submitted from another device since) —
    // drop it rather than show a stale form for something that's gone.
    useEffect(() => {
        if (!boot?.ok || !expandedId) return;
        if (!(boot.actions || []).some((a) => a.id === expandedId && a.status === "OPEN")) {
            setExpandedId(null);
            setNote("");
            setPhoto(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boot]);

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res, vars) => {
            if (res.ok) {
                setJustSubmittedId(vars.payload.corrective_action_id);
                setExpandedId(null);
                setNote("");
                setPhoto(null);
                kickProcessing();
                refetch();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);
    const actions = boot?.actions || [];
    const openActions = actions.filter((a) => a.status === "OPEN");
    const submittedActions = actions.filter((a) => a.status !== "OPEN");
    const noActions = boot?.ok && !actions.length;

    function startFixing(actionId) {
        setFormError("");
        setJustSubmittedId(null);
        setExpandedId(expandedId === actionId ? null : actionId);
        setNote("");
        setPhoto(null);
    }

    function submitCorrection(actionId) {
        setFormError("");
        const t = note.trim();
        if (!t) return setFormError("Explain what was fixed.");
        if (!photo) return setFormError("Replacement evidence photo is required.");

        submitMutation.mutate({
            token: token,
            formType: "AUDIT_CORRECTION",
            payload: {
                // A fresh key per correction, not one shared for the whole page visit — this page lets staff submit
                // several independent corrections (one per open audit question) without reloading, and the backend's
                // resubmit-dedup (PipelineService.clearPriorAttempts) keys off this value: sharing it across different
                // corrective_action_ids made each new submission silently wipe the previous one's saved note/photo.
                client_key: makeClientKey(),
                business_date: boot.businessDate,
                corrective_action_id: actionId,
                correction_note: t,
                photo: photo,
            },
        });
    }

    return (
        <>
            <PageTitle title="Audit Corrections" />
            <KioskTopbar icon="🛠️" title="Audit Corrections" menuHref={menuHref} />
            <KioskPageTransition>
                <Wrap className="sm:max-w-2xl">
                <FormNote>
                    Fix each item below and submit evidence — it stays &quot;awaiting approval&quot;
                    until the owner reviews and clears it in the dashboard.
                </FormNote>

                {noActions && (
                    <div className="px-4 py-8 text-center text-muted">
                        No open audit corrections for this kiosk right now.
                    </div>
                )}

                {!loading && openActions.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2.5">
                        {openActions.map((a) => (
                            <ActionCard
                                key={a.id}
                                action={a}
                                expanded={expandedId === a.id}
                                onToggle={() => startFixing(a.id)}
                                note={note}
                                onNoteChange={setNote}
                                photo={photo}
                                onPhotoChange={setPhoto}
                                onSubmit={() => submitCorrection(a.id)}
                                submitting={submitMutation.isPending && expandedId === a.id}
                                justSubmitted={justSubmittedId === a.id}
                            />
                        ))}
                    </div>
                )}

                {!loading && submittedActions.length > 0 && (
                    <div className="mt-6 flex flex-col gap-2.5">
                        <div className="mb-[0.2rem] ml-[0.1rem] text-xs font-bold uppercase tracking-[0.12em] text-muted">
                            Awaiting owner approval
                        </div>
                        {submittedActions.map((a) => (
                            <SubmittedCard key={a.id} action={a} />
                        ))}
                    </div>
                )}

                <Spinner loading={loading} />
                <ResultError>{error}</ResultError>
                </Wrap>
            </KioskPageTransition>
        </>
    );
}

function DeadlineBadge({ deadline }) {
    if (!deadline) return null;
    const overdue = isOverdue(deadline);
    return (
        <span
            className={
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.72rem] font-semibold " +
                (overdue ? "bg-danger-bg text-danger-ink" : "bg-warn-bg text-warn-ink")
            }
        >
            <Clock size={11} strokeWidth={2.4} />
            {overdue ? "Overdue — was due " + deadline : "Due " + deadline}
        </span>
    );
}

function ActionCard({ action, expanded, onToggle, note, onNoteChange, photo, onPhotoChange, onSubmit, submitting, justSubmitted }) {
    if (justSubmitted) {
        return (
            <div className="flex items-center gap-2.5 rounded-card border border-success-border bg-success-bg p-3.5">
                <CheckCircle2 size={20} strokeWidth={2} className="flex-shrink-0 text-success-ink" />
                <div className="text-[0.9rem] text-success-ink">Submitted for owner review.</div>
            </div>
        );
    }

    return (
        <div className="rounded-card border border-line bg-card shadow-elevate-1">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-start gap-2.5 border-none bg-transparent p-3.5 text-left"
            >
                <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 flex-shrink-0 text-danger-ink" />
                <div className="min-w-0 flex-1">
                    <div className="text-[0.95rem] font-medium text-ink">{action.question}</div>
                    <div className="mt-1"><DeadlineBadge deadline={action.deadline} /></div>
                </div>
                <span className="flex-shrink-0 text-[0.85rem] font-semibold text-accent">
                    {expanded ? "Cancel" : "Fix this"}
                </span>
            </button>

            {expanded && (
                <div className={"border-t border-line p-3.5 pt-3 " + (submitting ? "pointer-events-none opacity-60" : "")}>
                    <label className="mb-1 ml-[0.05rem] block text-[0.8rem] text-muted">What did you fix?</label>
                    <textarea
                        placeholder="Explain what was corrected"
                        className="mb-[0.7rem] min-h-[4.5rem] w-full resize-y"
                        value={note}
                        onChange={(e) => onNoteChange(e.target.value)}
                    />
                    <PhotoBox
                        value={photo}
                        onChange={onPhotoChange}
                        label="Replacement evidence photo"
                        placeholder="Tap to take or choose a photo"
                    />
                    <button
                        type="button"
                        onClick={onSubmit}
                        className="mt-1 flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0"
                    >
                        <Send size={15} strokeWidth={2.2} />
                        Submit correction
                    </button>
                </div>
            )}
        </div>
    );
}

function SubmittedCard({ action }) {
    return (
        <div className="flex items-start gap-2.5 rounded-card border border-line bg-panel/50 p-3.5">
            <Camera size={18} strokeWidth={2} className="mt-0.5 flex-shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
                <div className="text-[0.9rem] text-ink">{action.question}</div>
                <div className="mt-1 text-[0.78rem] text-muted">Evidence submitted — awaiting owner approval.</div>
            </div>
        </div>
    );
}
