"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import PhotoBox from "@/components/kiosk/PhotoBox";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

function makeClientKey() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

export default function AuditCorrectionsPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [actionId, setActionId] = useState("");
    const [text, setText] = useState("");
    const [photo, setPhoto] = useState(null);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const clientKey = useRef(makeClientKey());

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_audit_correction", token && { token }, { enabled: !!token });

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Correction submitted for owner review.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);
    const noActions = boot?.ok && !boot.actions.length;

    function submitCorrection() {
        setFormError("");
        if (!actionId) return setFormError("Select which action this fixes.");
        const t = text.trim();
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

    function logAnother() {
        window.location.reload();
    }

    return (
        <>
            <PageTitle title="Audit Corrections" />
            <KioskTopbar icon="🛠️" title="Audit Corrections" menuHref={menuHref} />
            <Wrap>
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        {noActions && (
                            <div className="px-4 py-8 text-center text-muted">
                                No open audit actions for this kiosk right now.
                            </div>
                        )}

                        {!loading && !noActions && boot?.ok && (
                            <div>
                                <FormNote>
                                    Fix confirmed, submitting moves it to the owner for review — it
                                    stays open until they close it.
                                </FormNote>

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                    Which action are you fixing?
                                </label>
                                <select
                                    className="mb-[0.7rem] w-full"
                                    value={actionId}
                                    onChange={(e) => setActionId(e.target.value)}
                                >
                                    <option value="">Select action…</option>
                                    {boot.actions.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.question}
                                            {a.deadline ? " — due " + a.deadline : ""}
                                        </option>
                                    ))}
                                </select>

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                    What did you fix?
                                </label>
                                <textarea
                                    placeholder="Explain what was corrected"
                                    className="mb-[0.7rem] min-h-[5rem] w-full resize-y"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                />

                                <PhotoBox
                                    value={photo}
                                    onChange={setPhoto}
                                    label="Replacement evidence photo"
                                    placeholder="Tap to take or choose a photo"
                                />
                            </div>
                        )}

                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                        {!loading && !noActions && boot?.ok && <StickyActionBar.Spacer />}
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} onLogAnother={logAnother} />}
            </Wrap>

            {!loading && !success && !noActions && boot?.ok && (
                <StickyActionBar>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0 sm:mx-auto sm:max-w-sm"
                        onClick={submitCorrection}
                    >
                        <Send size={15} strokeWidth={2.2} />
                        Submit correction
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
