"use client";

import { useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, Clock, Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
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
    const [expandedId, setExpandedId] = useState(null);
    const [note, setNote] = useState("");
    const [photo, setPhoto] = useState(null);
    const [formError, setFormError] = useState("");
    const [justSubmittedId, setJustSubmittedId] = useState(null);
    const clientKey = useRef(makeClientKey());

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
        refetch,
    } = useBootstrap("bootstrap_audit_correction", token && { token }, { enabled: !!token });

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
                client_key: clientKey.current,
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
